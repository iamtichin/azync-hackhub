import { expect, test, type Page, type Route } from "@playwright/test";

const user = {
  id: "wallet-user",
  name: "Wallet User",
  githubUsername: "wallet-user",
  avatarUrl: null,
};

async function routeBackend(page: Page, authenticated: boolean) {
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/me") {
      return authenticated
        ? route.fulfill({ json: user })
        : route.fulfill({ status: 401, json: { message: "Unauthorized" } });
    }
    if (url.pathname === "/hackathons" || url.pathname === "/teams") {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({
      status: 500,
      json: {
        message: `Unexpected request: ${route.request().method()} ${url.pathname}`,
      },
    });
  });
}

test("does not expose wallet connection before GitHub authentication", async ({
  page,
}) => {
  await routeBackend(page, false);
  await page.goto("/submit");

  await expect(
    page.getByRole("button", { name: "Sign in with GitHub first" }),
  ).toBeDisabled();
  await expect(page.locator(".wallet-adapter-button-trigger")).toHaveCount(1);
  await expect(page.locator(".wallet-adapter-modal")).toHaveCount(0);
  await expect(
    page.getByText("Sign in with GitHub before connecting a wallet."),
  ).toBeVisible();
});

test("invalid GitHub session remains wallet-gated and is cleared", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("azync.access_token", "invalid-token");
  });
  await routeBackend(page, false);
  await page.goto("/submit");

  await expect(
    page.getByRole("button", { name: "Sign in with GitHub first" }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => window.sessionStorage.getItem("azync.access_token")),
    )
    .toBeNull();
});

test("enables the wallet selector only after GitHub authentication succeeds", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("azync.access_token", "valid-token");
  });
  await routeBackend(page, true);
  await page.goto("/submit");

  await expect(
    page.getByRole("button", { name: "Sign in with GitHub first" }),
  ).toHaveCount(0);
  await expect(page.locator(".wallet-adapter-button-trigger")).toBeEnabled();
});
