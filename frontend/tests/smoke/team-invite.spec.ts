import { expect, test } from "@playwright/test";

const code = "x".repeat(32);
const user = { id: "new-user", name: "New User", githubUsername: "new-user" };

test("preserves an invite return path behind OAuth and redeems it only after authentication", async ({
  page,
}) => {
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({
        status: 401,
        json: { message: "OAuth required" },
      });
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected ${path}` },
    });
  });
  await page.goto(`/teams/invites/${code}`);
  await expect(page.getByRole("link", { name: /GitHub/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("azync.return_path")),
    )
    .toBe(`/teams/invites/${code}`);

  await page.unrouteAll();
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: user });
    if (path === `/teams/invites/${code}/join`)
      return route.fulfill({
        json: { teamId: "fixture-team", registrationRequired: true },
      });
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected ${path}` },
    });
  });
  await page.goto(`/teams/invites/${code}`);
  await page.getByRole("button", { name: "Join team" }).click();
  await expect(page).toHaveURL("/teams/fixture-team?registration=required");
});

test("rejects unsafe OAuth return paths", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("azync.return_path", "//attacker.example");
  });
  await page.route("http://localhost:3001/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/auth/me") {
      return route.fulfill({ json: user });
    }
    return route.fulfill({ status: 500 });
  });
  await page.goto("/auth/callback#access_token=fixture-token");
  await expect(page).toHaveURL("/dashboard");
});

test("admin sees durable active invites, can create/copy/revoke one, and the list survives refresh", async ({
  page,
}) => {
  const team = {
    id: "team-1",
    name: "Builders",
    hackathonId: "hack-1",
    registrations: [],
  };
  const admin = { id: "admin-1", name: "Admin", githubUsername: "admin" };
  let activeInvites = [
    {
      id: "invite-old",
      code: "old-code",
      expiresAt: "2026-10-01T00:00:00.000Z",
    },
  ];
  await page.addInitScript(() => {
    let copied = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copied = value;
        },
      },
    });
    (window as Window & { __copiedInvite?: () => string }).__copiedInvite =
      () => copied;
    sessionStorage.setItem("azync.access_token", "fixture-token");
  });
  await page.route("http://localhost:3001/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: admin });
    if (path === "/teams/team-1") return route.fulfill({ json: team });
    if (path === "/teams/team-1/members")
      return route.fulfill({
        json: [{ userId: "admin-1", role: "admin", user: admin }],
      });
    if (path === "/hackathons/hack-1")
      return route.fulfill({
        json: {
          id: "hack-1",
          name: "Hack",
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-12-01T00:00:00.000Z",
        },
      });
    if (path === "/teams/team-1/invites" && request.method() === "GET")
      return route.fulfill({ json: activeInvites });
    if (path === "/teams/team-1/invites" && request.method() === "POST") {
      const invite = {
        id: "invite-new",
        code: "new-code",
        expiresAt: "2026-10-02T00:00:00.000Z",
      };
      activeInvites = [invite, ...activeInvites];
      return route.fulfill({
        json: { ...invite, joinPath: "/teams/invites/new-code" },
      });
    }
    if (
      path === "/teams/team-1/invites/invite-new" &&
      request.method() === "DELETE"
    ) {
      activeInvites = activeInvites.filter(
        (invite) => invite.id !== "invite-new",
      );
      return route.fulfill({ json: { id: "invite-new", status: "revoked" } });
    }
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected ${request.method()} ${path}` },
    });
  });

  await page.goto("/teams/team-1");
  await page.getByRole("button", { name: "GitHub & Webhook" }).click();
  await expect(page.getByText("2026-10-01T00:00:00.000Z")).toBeVisible();
  await page
    .getByRole("button", { name: /Create and copy 24h invite/ })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as Window & { __copiedInvite?: () => string }
        ).__copiedInvite?.(),
      ),
    )
    .toBe("http://127.0.0.1:3100/teams/invites/new-code");
  await page.reload();
  await page.getByRole("button", { name: "GitHub & Webhook" }).click();
  await expect(page.getByText("2026-10-02T00:00:00.000Z")).toBeVisible();
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByText("2026-10-02T00:00:00.000Z")).toHaveCount(0);
});

test("team registration has one CTA and switches to disabled registered state after success", async ({
  page,
}) => {
  const member = { id: "member-1", name: "Member", githubUsername: "member" };
  let registered = false;
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: member });
    if (path === "/teams/team-2")
      return route.fulfill({
        json: {
          id: "team-2",
          name: "Joiners",
          hackathonId: "hack-2",
          registrations: registered
            ? [
                {
                  id: "reg-1",
                  hackathonId: "hack-2",
                  registeredAt: "2026-09-21T00:00:00.000Z",
                },
              ]
            : [],
        },
      });
    if (path === "/teams/team-2/members")
      return route.fulfill({
        json: [{ userId: "member-1", role: "member", user: member }],
      });
    if (path === "/hackathons/hack-2")
      return route.fulfill({
        json: {
          id: "hack-2",
          name: "Hack",
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-12-01T00:00:00.000Z",
        },
      });
    if (path === "/hackathons/hack-2/register" && request.method() === "POST") {
      registered = true;
      return route.fulfill({ json: { id: "reg-1" } });
    }
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected ${request.method()} ${path}` },
    });
  });

  await page.goto("/teams/team-2?registration=required");
  const register = page.getByRole("button", {
    name: "Register team for hackathon",
  });
  await expect(register).toHaveCount(1);
  await expect(register).toBeEnabled();
  await register.click();
  const completed = page.getByRole("button", {
    name: "Registered for hackathon",
  });
  await expect(completed).toHaveCount(1);
  await expect(completed).toBeDisabled();
});

test("a durable collaborator-sync failure is visible after the workspace reloads", async ({
  page,
}) => {
  const admin = { id: "admin-2", name: "Admin", githubUsername: "admin-two" };
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: admin });
    if (path === "/teams/team-3")
      return route.fulfill({
        json: {
          id: "team-3",
          name: "Sync state",
          hackathonId: "hack-3",
          registrations: [],
          repository: {
            id: "repo-3",
            fullName: "azync/team-3",
            url: "https://github.com/azync/team-3",
            collaborators: [
              {
                username: "former-user",
                permission: "push",
                status: "revoke_failed",
                error: "temporary failure",
              },
            ],
            provisioningError:
              "Collaborator sync incomplete; retry on the next roster change.",
          },
        },
      });
    if (path === "/teams/team-3/members")
      return route.fulfill({
        json: [{ userId: "admin-2", role: "admin", user: admin }],
      });
    if (path === "/teams/team-3/invites") return route.fulfill({ json: [] });
    if (path === "/hackathons/hack-3")
      return route.fulfill({
        json: {
          id: "hack-3",
          name: "Hack",
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-12-01T00:00:00.000Z",
        },
      });
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected ${path}` },
    });
  });
  await page.goto("/teams/team-3");
  await page.getByRole("button", { name: "GitHub & Webhook" }).click();
  await expect(page.getByTestId("repository-provisioning-error")).toContainText(
    "Collaborator sync incomplete",
  );
  await expect(page.getByTestId("repository-collaborators")).toContainText(
    "former-user",
  );
  await expect(page.getByTestId("repository-collaborators")).toContainText(
    "revoke_failed",
  );
});
