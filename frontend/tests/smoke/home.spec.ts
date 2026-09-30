import { expect, test, type Page, type Route } from "@playwright/test";

const activeHackathon = {
  id: "fixture-hackathon",
  name: "Fixture Hackathon",
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-10-01T00:00:00.000Z",
  rules: [],
  rubric: [],
  rulesVersion: "v1",
  rubricVersion: "v1",
  organizerId: "fixture-user",
  _count: { registrations: 2, submissions: 1 },
};

const authenticatedUser = {
  id: "fixture-user",
  githubUsername: "fixture-user",
  name: "Fixture User",
};

async function blockUnexpectedBackendRequests(
  page: Page,
  handler: (route: Route) => Promise<void>,
) {
  await page.route("http://localhost:3001/**", async (route) => {
    try {
      await handler(route);
    } catch (error) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          message: `Unexpected test request: ${route.request().url()}`,
        }),
      });
      throw error;
    }
  });
}

test("renders a deterministic loading state before showing the fixture-backed active hackathon", async ({
  page,
}) => {
  let releaseHackathons!: () => void;
  const hackathonsReleased = new Promise<void>((resolve) => {
    releaseHackathons = resolve;
  });

  await blockUnexpectedBackendRequests(page, async (route) => {
    if (new URL(route.request().url()).pathname === "/hackathons") {
      await hackathonsReleased;
      await route.fulfill({ json: [activeHackathon] });
      return;
    }
    throw new Error(`Unexpected backend request: ${route.request().url()}`);
  });

  await page.goto("/");

  await expect(page.getByRole("status")).toBeVisible();
  releaseHackathons();
  await expect(page.getByText("Fixture Hackathon")).toBeVisible();
  await expect(
    page.locator('a[href="/hackathons/fixture-hackathon"]'),
  ).toHaveAttribute("href", "/hackathons/fixture-hackathon");
});

test("shows the backend message when the hackathon API fails", async ({
  page,
}) => {
  await blockUnexpectedBackendRequests(page, async (route) => {
    if (new URL(route.request().url()).pathname === "/hackathons") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Mock backend unavailable" }),
      });
      return;
    }
    throw new Error(`Unexpected backend request: ${route.request().url()}`);
  });

  await page.goto("/");

  await expect(
    page
      .locator('[role="alert"]')
      .filter({ hasText: "Mock backend unavailable" }),
  ).toBeVisible();
});

test("invalid authentication keeps protected workspaces behind the GitHub gate", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem(
      "azync.access_token",
      "invalid-fixture-token",
    );
  });
  await blockUnexpectedBackendRequests(page, async (route) => {
    if (new URL(route.request().url()).pathname === "/auth/me") {
      await route.fulfill({
        status: 401,
        json: { message: "Invalid test token" },
      });
      return;
    }
    throw new Error(`Unexpected backend request: ${route.request().url()}`);
  });

  await page.goto("/dashboard");

  await expect(page.getByRole("link", { name: /GitHub/ })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect
    .poll(() =>
      page.evaluate(() => window.sessionStorage.getItem("azync.access_token")),
    )
    .toBeNull();
});

test("valid authentication loads the protected dashboard with only its bounded fixture requests", async ({
  page,
}) => {
  const backendRequests: string[] = [];
  await page.addInitScript(() => {
    window.sessionStorage.setItem("azync.access_token", "valid-fixture-token");
  });
  await blockUnexpectedBackendRequests(page, async (route) => {
    const url = new URL(route.request().url());
    const request = `${route.request().method()} ${url.pathname}${url.search}`;
    backendRequests.push(request);

    if (url.pathname === "/auth/me") {
      await route.fulfill({ json: authenticatedUser });
      return;
    }
    if (url.pathname === "/hackathons") {
      await route.fulfill({ json: [activeHackathon] });
      return;
    }
    if (url.pathname === "/hackathons/mine") {
      await route.fulfill({ json: [activeHackathon] });
      return;
    }
    if (url.pathname === "/users/me/teams") {
      await route.fulfill({ json: [] });
      return;
    }
    if (url.pathname === "/solana/health") {
      await route.fulfill({ json: { status: "ok" } });
      return;
    }
    throw new Error(`Unexpected backend request: ${request}`);
  });

  await page.goto("/dashboard");

  await expect(page.getByText("Fixture Hackathon")).toBeVisible();
  await expect(
    page.getByText("Organizer scope").locator("..").getByText("1"),
  ).toBeVisible();
  expect(backendRequests.sort()).toEqual([
    "GET /auth/me",
    "GET /hackathons/mine",
    "GET /hackathons?includeEnded=true",
    "GET /solana/health",
    "GET /users/me/teams",
  ]);
});

test("dashboard shows core data while the Solana health request is pending", async ({
  page,
}) => {
  let releaseSolana!: () => void;
  const solanaReleased = new Promise<void>((resolve) => {
    releaseSolana = resolve;
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem("azync.access_token", "valid-fixture-token");
  });
  await blockUnexpectedBackendRequests(page, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: authenticatedUser });
    if (path === "/hackathons")
      return route.fulfill({ json: [activeHackathon] });
    if (path === "/hackathons/mine")
      return route.fulfill({ json: [activeHackathon] });
    if (path === "/users/me/teams") return route.fulfill({ json: [] });
    if (path === "/solana/health") {
      await solanaReleased;
      return route.fulfill({ json: { status: "unavailable" } });
    }
    throw new Error(`Unexpected backend request: ${route.request().url()}`);
  });

  try {
    await page.goto("/dashboard");
    await expect(page.getByText("Fixture Hackathon")).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.getByText("Preparing your workspace…")).toHaveCount(0);
    await expect(page.getByText("Could not reach the backend")).toHaveCount(0);
  } finally {
    releaseSolana();
  }
});
