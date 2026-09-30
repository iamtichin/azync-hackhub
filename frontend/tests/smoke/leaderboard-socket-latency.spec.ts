import { expect, test, type WebSocketRoute } from "@playwright/test";

const event = {
  id: "event",
  name: "Realtime Event",
  startDate: "2026-09-01T00:00:00Z",
  endDate: "2026-10-01T00:00:00Z",
  rules: [],
  rubric: [],
  rulesVersion: "v1",
  rubricVersion: "v1",
};
const board = (name: string) => ({
  hackathonId: "event",
  leaderboard: [
    {
      rank: 1,
      teamId: "team",
      teamName: name,
      metrics: { taskCompletionPercent: 50 },
      progress: { totalTasks: 2, completedTasks: 1 },
      ci: { status: "unknown", trustLimitations: [] },
    },
  ],
});

test("routed Socket.IO invalidation refreshes leaderboard DOM", async ({
  page,
}) => {
  let updated = false;
  let boardReads = 0;
  let socket: WebSocketRoute | undefined;
  const socketFrames: string[] = [];
  let joined!: () => void;
  const joinedRoom = new Promise<void>((resolve) => {
    joined = resolve;
  });

  // Engine.IO v4 open, Socket.IO default namespace connect, then one room join.
  // The browser never opens a network connection to localhost:3001.
  await page.routeWebSocket(/ws:\/\/localhost:3001\/socket\.io\//, (ws) => {
    socket = ws;
    socketFrames.push("route-matched");
    ws.onMessage((message) => {
      const packet = String(message);
      socketFrames.push(packet);
      if (packet.startsWith("40")) {
        ws.send('40{"sid":"fixture-namespace"}');
      } else if (packet.startsWith("42")) {
        const [name, room] = JSON.parse(packet.slice(2)) as [string, string];
        if (name === "join:leaderboard" && room === "event") joined();
      } else if (packet === "3") {
        // Engine.IO pong; this short exercise ends before the first heartbeat.
      }
    });
    ws.send(
      '0{"sid":"fixture-engine","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}',
    );
  });
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "socket-fixture"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({
        json: { id: "socket-user", name: "Socket User" },
      });
    if (path === "/hackathons/event") return route.fulfill({ json: event });
    if (
      path === "/hackathons/event/teams" ||
      path === "/hackathons/event/submissions"
    )
      return route.fulfill({ json: [] });
    if (path === "/hackathons/event/leaderboard") {
      boardReads += 1;
      return route.fulfill({
        json: board(updated ? "After Event Team" : "Before Event Team"),
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/hackathons/event");
  await expect(page.locator(".leaderboard-panel")).toContainText(
    "Before Event Team",
  );

  let joinTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      joinedRoom,
      new Promise<never>((_, reject) => {
        joinTimer = setTimeout(
          () =>
            reject(
              new Error(
                `Socket.IO join:leaderboard handshake timed out after 5 seconds; frames=${JSON.stringify(socketFrames)}`,
              ),
            ),
          5_000,
        );
      }),
    ]);
  } finally {
    if (joinTimer) clearTimeout(joinTimer);
  }
  await page.evaluate(() => {
    const state = window as typeof window & { __boardUpdateAt?: number };
    const panel = document.querySelector(".leaderboard-panel");
    if (!panel) throw new Error("Leaderboard panel is absent");
    const observer = new MutationObserver(() => {
      if (panel.textContent?.includes("After Event Team")) {
        state.__boardUpdateAt = Date.now();
        observer.disconnect();
      }
    });
    observer.observe(panel, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  updated = true;
  const emitAt = Date.now();
  socket!.send('42["leaderboard:invalidated",{"hackathonId":"event"}]');
  await expect(page.locator(".leaderboard-panel")).toContainText(
    "After Event Team",
  );
  const domAt = await page.evaluate(
    () =>
      (window as typeof window & { __boardUpdateAt?: number }).__boardUpdateAt,
  );
  expect(domAt).toBeDefined();
  expect(boardReads).toBeGreaterThanOrEqual(2);
  const elapsedMs = domAt! - emitAt;
  expect(elapsedMs).toBeGreaterThanOrEqual(0);
  console.log(
    `SOCKET_ROUTE_FIXTURE_LATENCY run=${process.env.SOCKET_EXERCISE_RUN_ID || "local"} emit_to_dom_ms=${elapsedMs} board_reads=${boardReads}`,
  );
});
