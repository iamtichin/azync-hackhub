import { expect, test, type Route } from "@playwright/test";

test("renders only active public tracks and lets a participant select one for submission", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  const event = {
    id: "event",
    name: "Published event",
    description: "Public brief",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-10-01T00:00:00.000Z",
    rules: [],
    rubric: [],
    rulesVersion: "v1",
    rubricVersion: "v1",
    tracks: [
      {
        id: "track",
        hackathonId: "event",
        name: "AI",
        description: "Active",
        isActive: true,
      },
    ],
  };
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({
        json: {
          id: "user",
          name: "User",
          githubUsername: "user",
          avatarUrl: null,
        },
      });
    if (path === "/hackathons") return route.fulfill({ json: [event] });
    if (path === "/users/me/teams")
      return route.fulfill({
        json: [{ id: "team", name: "Team", hackathonId: "event" }],
      });
    return route.fulfill({
      json: path === "/solana/health" ? { status: "ok" } : event,
    });
  });
  await page.goto("/submit?hackathon=event");
  const track = page.getByLabel("Track");
  await track.selectOption("track");
  await expect(track).toHaveValue("track");
});

test("keeps unpublished fixtures off public home and detail routes", async ({
  page,
}) => {
  const published = {
    id: "published",
    name: "Published event",
    description: "Public brief",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-10-01T00:00:00.000Z",
    rules: [],
    rubric: [],
    rulesVersion: "v1",
    rubricVersion: "v1",
    tracks: [],
  };
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/hackathons") return route.fulfill({ json: [published] });
    if (path === "/hackathons/draft")
      return route.fulfill({
        status: 404,
        json: { message: "Hackathon not found" },
      });
    return route.fulfill({ json: [] });
  });

  await page.goto("/");
  await expect(page.getByText("Published event")).toBeVisible();
  await expect(page.getByText("Organizer-only draft")).toHaveCount(0);
  await page.goto("/hackathons/draft");
  await expect(page.getByText("Hackathon not found")).toBeVisible();
});

test("organizer can manage a private draft, publication, brief, and tracks with exact API payloads", async ({
  page,
}) => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const draft: any = {
    id: "draft",
    organizerId: "owner",
    name: "Organizer-only draft",
    description: "Old brief",
    coverUrl: "https://old.example/cover.png",
    isPublished: false,
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-10-01T00:00:00.000Z",
    rules: [],
    rubric: [],
    rulesVersion: "v1",
    rubricVersion: "v1",
    tracks: [
      {
        id: "track-1",
        hackathonId: "draft",
        name: "AI",
        description: "Old track brief",
        isActive: true,
      },
    ],
  };
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = route.request().postDataJSON();
    requests.push({ method, path: url.pathname, body });
    if (url.pathname === "/auth/me")
      return route.fulfill({
        json: { id: "owner", name: "Owner", githubUsername: "owner" },
      });
    if (url.pathname === "/hackathons/mine")
      return route.fulfill({ json: [draft] });
    if (url.pathname === "/hackathons/draft/teams")
      return route.fulfill({ json: [] });
    if (url.pathname === "/hackathons/draft/leaderboard")
      return route.fulfill({ json: { hackathonId: "draft", leaderboard: [] } });
    if (url.pathname === "/hackathons/draft/judges")
      return route.fulfill({ json: [] });
    if (url.pathname === "/hackathons/draft/organizer-submissions")
      return route.fulfill({
        json: { items: [], nextCursor: null, limit: 25 },
      });
    if (method === "PATCH" && url.pathname === "/hackathons/draft") {
      Object.assign(draft, body);
      return route.fulfill({ json: draft });
    }
    if (method === "POST" && url.pathname === "/hackathons/draft/tracks") {
      draft.tracks.push({
        id: "track-2",
        hackathonId: "draft",
        isActive: true,
        ...(body as object),
      });
      return route.fulfill({ json: draft.tracks[1] });
    }
    if (
      method === "PATCH" &&
      url.pathname === "/hackathons/draft/tracks/track-1"
    ) {
      Object.assign(draft.tracks[0], body);
      return route.fulfill({ json: draft.tracks[0] });
    }
    return route.fulfill({ json: {} });
  });
  const answers = [
    "New brief",
    "https://new.example/cover.png",
    "Web3",
    "AI edited",
    "Edited track brief",
  ];
  page.on("dialog", (dialog) => void dialog.accept(answers.shift() ?? ""));

  await page.goto("/organizer");
  await expect(page.locator("select.heading-select")).toHaveValue("draft");
  await expect(page.getByRole("heading", { name: "Draft" })).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "Unpublish" }).click();
  await page.getByRole("button", { name: "Edit description / cover" }).click();
  await page.getByRole("button", { name: "Add track" }).click();
  await page.getByRole("button", { name: "Edit track AI" }).click();
  await page.getByRole("button", { name: "Disable track AI edited" }).click();

  await expect
    .poll(() =>
      requests
        .filter((request) => request.method !== "GET")
        .map((request) => [request.method, request.path, request.body]),
    )
    .toEqual([
      ["PATCH", "/hackathons/draft", { isPublished: true }],
      ["PATCH", "/hackathons/draft", { isPublished: false }],
      [
        "PATCH",
        "/hackathons/draft",
        { description: "New brief", coverUrl: "https://new.example/cover.png" },
      ],
      ["POST", "/hackathons/draft/tracks", { name: "Web3" }],
      [
        "PATCH",
        "/hackathons/draft/tracks/track-1",
        { name: "AI edited", description: "Edited track brief" },
      ],
      ["PATCH", "/hackathons/draft/tracks/track-1", { isActive: false }],
    ]);
});

test("self profile saves bounded university and skills without reading another user profile", async ({
  page,
}) => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const url = new URL(route.request().url());
    requests.push({
      method: route.request().method(),
      path: url.pathname,
      body: route.request().postDataJSON(),
    });
    if (url.pathname === "/auth/me")
      return route.fulfill({
        json: {
          id: "self",
          name: "Self",
          githubUsername: "self",
          university: "Old U",
          skills: ["Old"],
        },
      });
    if (url.pathname === "/users/me" && route.request().method() === "PATCH")
      return route.fulfill({
        json: {
          id: "self",
          university: "New U",
          skills: ["TypeScript", "Solana"],
        },
      });
    return route.fulfill({ json: [] });
  });
  const answers = ["New U", "TypeScript, Solana"];
  page.on("dialog", (dialog) => void dialog.accept(answers.shift() ?? ""));
  await page.goto("/");
  await page.getByRole("button", { name: /Account Self/ }).click();
  await page
    .getByRole("button", { name: "University and skills profile" })
    .click();
  await expect
    .poll(() => requests.filter((request) => request.method === "PATCH"))
    .toEqual([
      {
        method: "PATCH",
        path: "/users/me",
        body: { university: "New U", skills: ["TypeScript", "Solana"] },
      },
    ]);
  expect(
    requests.some((request) => request.path === "/users/other"),
  ).toBeFalsy();
});
