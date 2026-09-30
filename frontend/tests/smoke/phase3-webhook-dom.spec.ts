import { createHmac } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type Fixture = {
  type: "ready";
  runId: string;
  hackathonId: string;
  teamId: string;
  deliveryId: string;
  repositoryFullName: string;
  headSha: string;
  workflowRunId: string;
  token: string;
};
type Message =
  | Fixture
  | { type: "received"; ns?: string }
  | {
      type: "persisted";
      run?: { id: string; testStatus: string; headSha: string };
      delivery?: { id: string; status: string };
    }
  | { type: "error"; message: string };

test("signed HTTP workflow webhook reaches Chromium leaderboard DOM over real Socket.IO", async ({
  page,
}) => {
  test.skip(
    process.env.PHASE3_E2E !== "1",
    "Requires the isolated Phase3 E2E stack and separate frontend build",
  );
  test.setTimeout(90_000);
  const backend = resolve(__dirname, "../../../azync-hackhub-backend");
  const helper = resolve(backend, "test/support/phase3-playwright-server.cjs");
  const child = fork(helper, {
    cwd: backend,
    silent: true,
    env: {
      ...process.env,
      AZYNC_E2E_RUN_ID: process.env.AZYNC_E2E_RUN_ID || "phase3-playwright",
    },
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.stdout?.on("data", () => {});
  const messages: Message[] = [];
  child.on("message", (message) => {
    messages.push(message as Message);
  });
  async function messageOf<T extends Message["type"]>(
    type: T,
    timeout = 30_000,
  ): Promise<Extract<Message, { type: T }>> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = messages.findIndex(
        (message) => message.type === type || message.type === "error",
      );
      if (index >= 0) {
        const message = messages.splice(index, 1)[0];
        if (message.type === "error") throw new Error(message.message);
        return message as Extract<Message, { type: T }>;
      }
      if (child.exitCode !== null)
        throw new Error(
          `Fixture exited ${child.exitCode}: ${stderr.slice(-4000)}`,
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `Timed out waiting for fixture ${type}: ${stderr.slice(-4000)}`,
    );
  }
  try {
    const fixture = await messageOf("ready");
    const buildId = readFileSync(
      resolve(__dirname, "../../.next/BUILD_ID"),
      "utf8",
    ).trim();
    const websocketFrames: string[] = [];
    page.on("websocket", (socket) => {
      if (!socket.url().includes("127.0.0.1:3201/socket.io/")) return;
      socket.on("framereceived", (frame) =>
        websocketFrames.push(String(frame.payload)),
      );
    });
    let domAt: bigint | undefined;
    await page.exposeBinding("phase3DomChanged", () => {
      domAt ??= process.hrtime.bigint();
    });
    await page.addInitScript(
      (token) => sessionStorage.setItem("azync.access_token", token),
      fixture.token,
    );
    await page.goto(`/hackathons/${fixture.hackathonId}`);
    const board = page.locator(".leaderboard-panel");
    await expect(board).toContainText("Phase3 Team");
    await expect(board.locator(".leaderboard-table")).toContainText("Unknown");
    await expect
      .poll(
        () =>
          websocketFrames.some(
            (frame) =>
              frame.includes("joined:leaderboard") &&
              frame.includes(fixture.hackathonId),
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    await page.evaluate(() => {
      const panel = document.querySelector(".leaderboard-panel");
      if (!panel) throw new Error("Leaderboard panel missing");
      const observer = new MutationObserver(() => {
        if (
          panel
            .querySelector(".leaderboard-table")
            ?.textContent?.includes("Passed")
        ) {
          observer.disconnect();
          void (
            window as typeof window & { phase3DomChanged: () => Promise<void> }
          ).phase3DomChanged();
        }
      });
      observer.observe(panel, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });

    const body = JSON.stringify({
      action: "completed",
      repository: { full_name: fixture.repositoryFullName },
      workflow_run: {
        id: Number(fixture.workflowRunId),
        run_attempt: 1,
        head_sha: fixture.headSha,
        head_branch: "main",
        event: "push",
        head_repository: { full_name: fixture.repositoryFullName },
        status: "completed",
        conclusion: "success",
        updated_at: new Date().toISOString(),
      },
    });
    const signature = `sha256=${createHmac("sha256", "e2e-webhook-secret").update(body).digest("hex")}`;
    const response = await fetch("http://127.0.0.1:3201/webhooks/github", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-github-event": "workflow_run",
        "x-github-delivery": fixture.deliveryId,
        "x-hub-signature-256": signature,
      },
    });
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({
      deliveryId: fixture.deliveryId,
      duplicate: false,
      status: "processed",
      testStatus: "PASSED",
    });
    child.send("received");
    const received = await messageOf("received");
    expect(received.ns).toBeDefined();
    await expect(board.locator(".leaderboard-table")).toContainText("Passed", {
      timeout: 15_000,
    });
    await expect.poll(() => domAt !== undefined).toBe(true);
    expect(
      websocketFrames.some((frame) =>
        frame.includes("leaderboard:invalidated"),
      ),
    ).toBe(true);
    const boardResponse = await fetch(
      `http://127.0.0.1:3201/hackathons/${fixture.hackathonId}/leaderboard`,
    );
    expect(boardResponse.status).toBe(200);
    const boardJson = await boardResponse.json();
    expect(boardJson.leaderboard).toEqual([
      expect.objectContaining({
        teamId: fixture.teamId,
        ci: expect.objectContaining({
          status: "passed",
          runId: fixture.workflowRunId,
          commitSha: fixture.headSha,
        }),
      }),
    ]);
    child.send("persisted");
    const persisted = await messageOf("persisted");
    expect(persisted).toMatchObject({
      run: {
        id: fixture.workflowRunId,
        testStatus: "PASSED",
        headSha: fixture.headSha,
      },
      delivery: { id: fixture.deliveryId, status: "COMPLETED" },
    });
    const receiveToDomMs = Number(domAt! - BigInt(received.ns!)) / 1e6;
    expect(receiveToDomMs).toBeGreaterThanOrEqual(0);
    console.log(
      JSON.stringify({
        metric: "PHASE3_BACKEND_RECEIVE_TO_DOM_OBSERVER_CALLBACK",
        runId: fixture.runId,
        buildId,
        deliveryId: fixture.deliveryId,
        workflowRunId: fixture.workflowRunId,
        backendPort: 3201,
        frontendPort: 3100,
        receiveToDomMs,
        measurement:
          "same-host Node monotonic clock; DOM observer callback via Playwright binding is an upper bound",
        githubDelivery: "not measured; signed synthetic HTTP delivery only",
      }),
    );
  } finally {
    await stopChild(child);
  }
});

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.send("stop");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (child.exitCode === null) child.kill();
}
