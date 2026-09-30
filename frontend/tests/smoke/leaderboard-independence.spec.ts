import { expect, test, type Page, type Route } from "@playwright/test";

const event = {
  id: "event",
  organizerId: "owner",
  name: "Independent Event",
  isPublished: true,
  startDate: "2026-09-01T00:00:00Z",
  endDate: "2026-10-01T00:00:00Z",
  rules: [],
  rubric: [],
  rulesVersion: "v1",
  rubricVersion: "v1",
  tracks: [],
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

async function fixture(page: Page, unrelated: (route: Route) => Promise<void>) {
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "leaderboard-fixture"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({ json: { id: "owner", name: "Owner" } });
    if (path === "/hackathons/event" || path === "/hackathons/mine")
      return route.fulfill({ json: path.endsWith("/mine") ? [event] : event });
    if (path === "/hackathons/event/leaderboard")
      return route.fulfill({ json: board("Independent Team") });
    if (
      path === "/hackathons/event/teams" ||
      path === "/hackathons/event/organizer-submissions"
    )
      return unrelated(route);
    if (
      path === "/hackathons/event/submissions" ||
      path === "/hackathons/event/judges"
    )
      return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
}

test("HackathonDetail shows leaderboard while unrelated teams request is still pending", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await fixture(page, async (route) => {
    await pending;
    await route.fulfill({ json: [] });
  });
  try {
    await page.goto("/hackathons/event");
    await expect(page.locator(".leaderboard-panel")).toContainText(
      "Independent Team",
      { timeout: 3_000 },
    );
  } finally {
    release();
  }
});

test("OrganizerWorkspace shows leaderboard while unrelated submissions API fails", async ({
  page,
}) => {
  await fixture(page, async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill(
      path.endsWith("/organizer-submissions")
        ? { status: 503, json: { message: "Submissions unavailable" } }
        : { json: [] },
    );
  });
  await page.goto("/organizer");
  await expect(page.locator(".leaderboard-panel")).toContainText(
    "Independent Team",
  );
  await expect(page.getByText("Submissions unavailable")).toBeVisible();
});

test("OrganizerWorkspace ignores a late leaderboard response from the previous event", async ({
  page,
}) => {
  const other = { ...event, id: "other", name: "Other Event" };
  let release!: () => void;
  const oldBoard = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "leaderboard-fixture"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({ json: { id: "owner", name: "Owner" } });
    if (path === "/hackathons/mine")
      return route.fulfill({ json: [event, other] });
    if (path === "/hackathons/event/leaderboard") {
      await oldBoard;
      return route.fulfill({ json: board("Old Event Team") });
    }
    if (path === "/hackathons/other/leaderboard")
      return route.fulfill({ json: board("Current Event Team") });
    if (path.endsWith("/organizer-submissions"))
      return route.fulfill({
        json: { items: [], nextCursor: null, limit: 25 },
      });
    return route.fulfill({ json: [] });
  });
  try {
    await page.goto("/organizer");
    await page.locator(".heading-select").selectOption("other");
    await expect(page.locator(".leaderboard-panel")).toContainText(
      "Current Event Team",
    );
    release();
    await expect(page.locator(".leaderboard-panel")).not.toContainText(
      "Old Event Team",
    );
    await expect(page.locator(".leaderboard-panel")).toContainText(
      "Current Event Team",
    );
  } finally {
    release();
  }
});
