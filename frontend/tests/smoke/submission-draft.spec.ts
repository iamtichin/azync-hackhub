import { expect, test, type Route } from "@playwright/test";

test("loads repository autofill and saves an editable draft without a wallet", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  const event = {
    id: "event",
    name: "Published event",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-10-01T00:00:00.000Z",
    rules: [],
    rubric: [],
    tracks: [],
  };
  let revision = "2026-09-21T00:00:00.000Z";
  let saved: Record<string, unknown> | undefined;
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.port !== "3001") return route.continue();
    const path = url.pathname;
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
        json: [
          {
            id: "team",
            name: "Team",
            hackathonId: "event",
            repository: { url: "https://github.com/org/autofill" },
          },
          { id: "team-2", name: "Other team", hackathonId: "event" },
        ],
      });
    if (path === "/submissions/draft" && request.method() === "GET")
      return route.fulfill({
        json: {
          teamId: "team",
          hackathonId: "event",
          payload: { githubUrl: "https://github.com/org/autofill" },
        },
      });
    if (path === "/submissions/draft" && request.method() === "POST") {
      saved = request.postDataJSON();
      const responseRevision = revision;
      revision = "2026-09-22T00:00:00.000Z";
      return route.fulfill({
        json: { id: "draft", payload: saved, updatedAt: responseRevision },
      });
    }
    if (path === "/submission-validation/draft" && request.method() === "POST")
      return route.fulfill({
        json: {
          draftRevision: revision,
          fingerprint: "a".repeat(64),
          staleWarning: "Editing makes validation stale.",
          rateLimit: { retryAfterSeconds: 15 },
          checks: [
            {
              code: "demo.url_semantics",
              status: "PASS",
              summary: "URL semantics checked.",
              evidence: ["URL syntax only; not a working-demo claim."],
            },
          ],
          advisory: {
            kind: "AI_ADVISORY",
            status: "UNCERTAIN",
            message: "Advisory unavailable.",
            evidence: [],
          },
        },
      });
    return route.fulfill({ json: {} });
  });
  await page.goto("/submit?hackathon=event&team=team");
  await expect(page.getByLabel("Hackathon")).toHaveValue("event");
  await expect(page.getByLabel("Team")).toHaveValue("team");
  const github = page.getByPlaceholder("https://github.com/org/repository");
  await expect(github).toHaveValue("https://github.com/org/autofill");
  await page
    .getByPlaceholder("https://demo.example.com")
    .fill("https://demo.example.com");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect
    .poll(() => saved)
    .toEqual(
      expect.objectContaining({
        teamId: "team",
        hackathonId: "event",
        githubUrl: "https://github.com/org/autofill",
      }),
    );
  await expect(
    page.getByText(
      "Draft saved. You can add a recipient wallet when you finalize.",
    ),
  ).toBeVisible();
  const validate = page.getByRole("button", { name: "Validate saved draft" });
  await expect(validate).toBeEnabled();
  await validate.click();
  await expect(page.getByLabel("Draft validator")).toContainText("AI advisory");
  await github.fill("https://github.com/org/changed");
  await expect(validate).toBeDisabled();
  await expect(
    page.getByText(
      "Draft changed since validation. Save and rerun validation for the current revision.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(validate).toBeEnabled();
  await page.getByLabel("Team").selectOption("team-2");
  await expect(page.getByText("aaaaaaaaaaaa")).toHaveCount(0);
});

test("shows all final-only evidence fields while finalization remains wallet gated", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("**/*", (route: Route) => {
    const url = new URL(route.request().url());
    if (url.port !== "3001") return route.continue();
    const path = url.pathname;
    if (path === "/auth/me")
      return route.fulfill({
        json: {
          id: "user",
          name: "User",
          githubUsername: "user",
          avatarUrl: null,
        },
      });
    if (path === "/hackathons")
      return route.fulfill({
        json: [
          {
            id: "event",
            name: "Event",
            startDate: "2026-09-01",
            endDate: "2026-10-01",
            rules: [],
            rubric: [],
            tracks: [],
          },
        ],
      });
    if (path === "/users/me/teams")
      return route.fulfill({
        json: [{ id: "team", name: "Team", hackathonId: "event" }],
      });
    if (path === "/submissions/draft")
      return route.fulfill({
        json: { teamId: "team", hackathonId: "event", payload: {} },
      });
    return route.fulfill({ json: {} });
  });
  await page.goto("/submit");
  await expect(
    page.getByPlaceholder("https://docs.google.com/..."),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("https://explorer.solana.com/..."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Submit and create proof|Complete/ }),
  ).toBeDisabled();
});
