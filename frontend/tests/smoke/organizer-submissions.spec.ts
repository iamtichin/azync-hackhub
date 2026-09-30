import { expect, test, type Page, type Route } from "@playwright/test";

const event = {
  id: "event",
  organizerId: "owner",
  name: "Ended event",
  isPublished: true,
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-01-02T00:00:00.000Z",
  rules: [],
  rubric: [],
  rulesVersion: "v1",
  rubricVersion: "v1",
  tracks: [{ id: "track", hackathonId: "event", name: "AI", isActive: true }],
};
const row = {
  id: "sub-1",
  projectName: "Project",
  createdAt: "2026-01-01T12:00:00.000Z",
  status: "confirmed",
  receivedStatus: "RECEIVED",
  aiStatus: "QUEUED",
  mintStatus: "CONFIRMED",
  team: { id: "team", name: "Team" },
  track: { id: "track", name: "AI" },
  participantBlockchainEvidenceUrl: "https://evidence.example/proof",
  transactionSignature: "signature",
};

async function fixture(
  page: Page,
  submissions: (route: Route) => Promise<void>,
  leaderboardStatus = 200,
  detail: Record<string, unknown> = {},
  winner?: (route: Route) => Promise<void>,
) {
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "fixture"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({
        json: { id: "owner", name: "Owner", githubUsername: "owner" },
      });
    if (path === "/hackathons/mine") return route.fulfill({ json: [event] });
    if (path === "/users/me/teams") return route.fulfill({ json: [] });
    if (path === "/submissions/sub-1")
      return route.fulfill({
        json: {
          ...row,
          teamId: "team",
          hackathonId: "event",
          description: "Authorized organizer detail",
          githubUrl: "https://github.com/org/project",
          demoUrl: "https://demo.example",
          walletAddress: "wallet",
          team: row.team,
          explorerUrl: "https://explorer.example",
          ...detail,
        },
      });
    if (
      path === "/hackathons/event/teams" ||
      path === "/hackathons/event/judges"
    )
      return route.fulfill({ json: [] });
    if (path === "/hackathons/event/leaderboard")
      return route.fulfill(
        leaderboardStatus === 200
          ? { json: { hackathonId: "event", leaderboard: [] } }
          : {
              status: leaderboardStatus,
              json: { message: "Leaderboard unavailable" },
            },
      );
    if (
      path === "/hackathons/event/winner" ||
      path === "/hackathons/event/winner/retry-certificate"
    ) {
      return winner
        ? winner(route)
        : route.fulfill({
            status: 500,
            json: { message: "Unexpected winner request" },
          });
    }
    if (
      path === "/hackathons/event/organizer-submissions" ||
      path === "/hackathons/event/organizer-submissions.csv"
    )
      return submissions(route);
    return route.fulfill({ json: {} });
  });
}

test("shows an initial submission loading state and ended read-only notice", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await fixture(page, async (route) => {
    await pending;
    await route.fulfill({ json: { items: [], nextCursor: null, limit: 25 } });
  });
  await page.goto("/organizer");
  await expect(page.getByText("Loading submissions…")).toBeVisible();
  await expect(
    page.getByText("This event has ended; submissions are read-only."),
  ).toBeVisible();
  release();
  await expect(
    page.getByText("No submissions match these filters."),
  ).toBeVisible();
});

test("records one human winner decision and exposes its Solana certificate", async ({
  page,
}) => {
  let award: Record<string, unknown> | null = null;
  let requestBody: unknown;
  await fixture(
    page,
    async (route) =>
      route.fulfill({
        json: {
          items: [{ ...row, isWinner: Boolean(award) }],
          nextCursor: null,
          limit: 25,
          winner: award,
        },
      }),
    200,
    {},
    async (route) => {
      requestBody = route.request().postDataJSON();
      award = {
        id: "award-1",
        hackathonId: "event",
        submissionId: "sub-1",
        status: "confirmed",
        selectedAt: "2026-01-03T00:00:00.000Z",
        recipientAddress: "wallet",
        signature: "winner-tx",
        nftAssetId: "winner-asset",
        credentialHash: "winner-hash",
        metadataUri:
          "https://proof.example/solana/winner-credentials/v1/winner-hash.json",
        network: "devnet",
        leafIndex: "7",
        explorerUrl: "https://explorer.example/winner-tx",
        verifyPath: "/solana/winner-credentials/award-1/verify",
        projectName: "Project",
        team: row.team,
      };
      return route.fulfill({ json: award });
    },
  );
  await page.goto("/organizer");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Select winner + Solana cNFT" })
    .click();
  await expect(
    page.getByRole("region", { name: "Official winner" }),
  ).toContainText("Team");
  await expect(
    page.getByRole("region", { name: "Official winner" }),
  ).toContainText("confirmed");
  await expect(
    page.getByRole("link", { name: "Winner certificate on Explorer" }),
  ).toHaveAttribute("href", "https://explorer.example/winner-tx");
  await expect(
    page.getByRole("link", { name: "Verify certificate" }),
  ).toHaveAttribute(
    "href",
    "http://localhost:3001/solana/winner-credentials/award-1/verify",
  );
  await expect(
    page.getByRole("button", { name: "Select winner + Solana cNFT" }),
  ).toHaveCount(0);
  expect(requestBody).toEqual({ submissionId: "sub-1" });
});

test("renders empty and organizer-denial errors without exposing rows", async ({
  page,
}) => {
  await fixture(page, async (route) =>
    route.fulfill({
      status: 403,
      json: { message: "Only the hackathon organizer may perform this action" },
    }),
  );
  await page.goto("/organizer");
  await expect(
    page.getByText("Only the hackathon organizer may perform this action"),
  ).toBeVisible();
  await expect(page.locator(".organizer-submission-row")).toHaveCount(0);
});

test("sends active search, track and status filters through next page and CSV download", async ({
  page,
}) => {
  const requests: string[] = [];
  await fixture(page, async (route) => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith(".csv"))
      return route.fulfill({
        headers: { "content-type": "text/csv; charset=utf-8" },
        body: "team,project\n",
      });
    return route.fulfill({
      json: {
        items: [row],
        nextCursor: url.searchParams.get("cursor") ? null : "sub-1",
        limit: 25,
      },
    });
  });
  await page.goto("/organizer");
  await page.getByLabel("Search submissions").fill("Team");
  await page.getByLabel("Filter submission track").selectOption("track");
  await page.getByLabel("Filter submission status").selectOption("confirmed");
  await expect
    .poll(() =>
      requests.some(
        (item) =>
          item.includes("search=Team") &&
          item.includes("trackId=track") &&
          item.includes("status=confirmed"),
      ),
    )
    .toBeTruthy();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect
    .poll(() =>
      requests.some(
        (item) =>
          item.includes("cursor=sub-1") &&
          item.includes("search=Team") &&
          item.includes("trackId=track") &&
          item.includes("status=confirmed"),
      ),
    )
    .toBeTruthy();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  await (await download).cancel();
  expect(
    requests.some(
      (item) =>
        item.includes(".csv") &&
        item.includes("search=Team") &&
        item.includes("trackId=track") &&
        item.includes("status=confirmed"),
    ),
  ).toBeTruthy();
});

test("links organizer rows to the authorized submission detail query surface", async ({
  page,
}) => {
  await fixture(page, async (route) =>
    route.fulfill({ json: { items: [row], nextCursor: null, limit: 25 } }),
  );
  await page.goto("/organizer");
  await expect(
    page.getByRole("link", { name: "Project", exact: true }),
  ).toHaveAttribute("href", "/submissions?submission=sub-1");
  await expect(page.getByRole("link", { name: "Proof" })).toHaveAttribute(
    "href",
    "/submissions?submission=sub-1",
  );
});

test("keeps organizer track and submission controls in readable desktop rows", async ({
  page,
}) => {
  await fixture(page, async (route) =>
    route.fulfill({
      json: { items: [row], nextCursor: null, limit: 25, winner: null },
    }),
  );
  await page.goto("/organizer");
  await expect(page.locator(".organizer-track-row")).toBeVisible();
  await expect(page.locator(".organizer-submission-row")).toBeVisible();
  const layout = await page.evaluate(() => {
    const track = document.querySelector<HTMLElement>(".organizer-track-row");
    const trackCopy = track?.querySelector<HTMLElement>("span");
    const submission = document.querySelector<HTMLElement>(
      ".organizer-submission-row",
    );
    const actions = submission?.querySelector<HTMLElement>(".row-actions");
    const edit = Array.from(
      document.querySelectorAll<HTMLElement>(".event-control-strip > button"),
    )[0];
    const remove = Array.from(
      document.querySelectorAll<HTMLElement>(".event-control-strip > button"),
    )[1];
    return {
      trackWidth: trackCopy?.getBoundingClientRect().width ?? 0,
      submissionDisplay: submission ? getComputedStyle(submission).display : "",
      separated:
        submission && actions
          ? submission.getBoundingClientRect().left <
            actions.getBoundingClientRect().left
          : false,
      controlsAligned:
        edit && remove
          ? Math.abs(
              edit.getBoundingClientRect().top -
                remove.getBoundingClientRect().top,
            ) < 2
          : false,
    };
  });
  expect(layout.trackWidth).toBeGreaterThan(300);
  expect(layout.submissionDisplay).toBe("grid");
  expect(layout.separated).toBe(true);
  expect(layout.controlsAligned).toBe(true);
});

test("opens an organizer-authorized query target even with no team memberships", async ({
  page,
}) => {
  await fixture(page, async (route) =>
    route.fulfill({ json: { items: [row], nextCursor: null, limit: 25 } }),
  );
  await page.goto("/organizer");
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await expect(page).toHaveURL(/\/submissions\?submission=sub-1/);
  await expect(
    page.locator(".submission-table strong").filter({ hasText: /^Project$/ }),
  ).toBeVisible();
  await expect(page.getByTestId("submission-status-sub-1")).toHaveText(
    "RECEIVED",
  );
  await expect(
    page.locator(".submission-table .table-head > span"),
  ).toHaveCount(7);
  await expect(
    page.locator(".submission-table > div").nth(1).locator(":scope > span"),
  ).toHaveCount(7);
  await expect(page.getByRole("link", { name: /Evidence/ })).toBeVisible();
  const detail = page.getByRole("region", {
    name: "Project detail and evidence brief",
  });
  await expect(
    detail.getByRole("heading", { name: "Project overview" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: "Evidence brief" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("heading", { name: "Solana proof" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("navigation", { name: "Project artifacts" }),
  ).toBeVisible();
  await expect(
    detail.getByRole("link", { name: /Verify on Solana Explorer/ }),
  ).toBeVisible();
});

test("keeps organizer submissions accessible when the leaderboard is unavailable", async ({
  page,
}) => {
  await fixture(
    page,
    async (route) =>
      route.fulfill({ json: { items: [row], nextCursor: null, limit: 25 } }),
    404,
  );
  await page.goto("/organizer");
  await expect(
    page.getByRole("link", { name: "Project", exact: true }),
  ).toHaveAttribute("href", "/submissions?submission=sub-1");
});

test("organizer detail exposes completed advisory brief and distinct asset/transaction proof", async ({
  page,
}) => {
  await fixture(
    page,
    async (route) =>
      route.fulfill({ json: { items: [row], nextCursor: null, limit: 25 } }),
    200,
    {
      aiStatus: "COMPLETED",
      nftAssetId: "asset-123",
      transactionSignature: "tx-123",
      aiAnalysis: {
        id: "analysis",
        output: { executiveSummary: "Evidence-backed project summary" },
        createdAt: "2026-01-02T00:00:00.000Z",
        resolvedModel: "fixture-model",
      },
    },
  );
  await page.goto("/organizer");
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Project detail and evidence brief" }),
  ).toContainText("Authorized organizer detail");
  await expect(
    page.getByRole("region", { name: "Project detail and evidence brief" }),
  ).toContainText("Evidence-backed project summary");
  await expect(
    page.getByRole("region", { name: "Project detail and evidence brief" }),
  ).toContainText("asset-123");
  await expect(
    page.getByRole("region", { name: "Project detail and evidence brief" }),
  ).toContainText("tx-123");
});

test("submission ledger shows the persisted AI state instead of inventing a queued job", async ({
  page,
}) => {
  await fixture(
    page,
    async (route) =>
      route.fulfill({ json: { items: [row], nextCursor: null, limit: 25 } }),
    200,
    { aiStatus: "NOT_QUEUED", aiAnalysis: null },
  );
  await page.goto("/organizer");
  await page.getByRole("link", { name: "Project", exact: true }).click();
  await expect(page.getByTestId("submission-ai-status-sub-1")).toHaveText(
    "NOT_QUEUED",
  );
});

test("a denied submission detail shows one error without repeating the failed request", async ({
  page,
}) => {
  await fixture(page, async (route) =>
    route.fulfill({ json: { items: [row], nextCursor: null, limit: 25 } }),
  );
  let requests = 0;
  await page.route("http://localhost:3001/submissions/sub-1", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 403,
      json: { message: "Submission access denied" },
    });
  });
  await page.goto("/submissions?submission=sub-1");
  await expect(page.getByText("Submission access denied")).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests).toBe(1);
});

test("a failed team-ledger detail does not retry indefinitely on rerender", async ({
  page,
}) => {
  await fixture(page, async (route) =>
    route.fulfill({ json: { items: [], nextCursor: null, limit: 25 } }),
  );
  await page.route("http://localhost:3001/users/me/teams", async (route) =>
    route.fulfill({
      json: [
        {
          id: "team",
          name: "Team",
          submissions: [
            { id: "sub-1", projectName: "Project", status: "pending_nft" },
          ],
        },
      ],
    }),
  );
  let requests = 0;
  await page.route("http://localhost:3001/submissions/sub-1", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 503,
      json: { message: "Detail temporarily unavailable" },
    });
  });
  await page.goto("/submissions");
  await expect(page.getByText("Detail temporarily unavailable")).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests).toBe(1);
});
