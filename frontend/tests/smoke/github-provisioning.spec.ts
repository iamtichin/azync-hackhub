import { expect, test, type Route } from "@playwright/test";

const team = {
  id: "fixture-team",
  name: "Fixture Team",
  hackathonId: "fixture-hackathon",
  repository: {
    id: "repo-1",
    teamId: "fixture-team",
    fullName: "azync/fixture-team",
    url: "https://github.com/azync/fixture-team",
    webhookConfigured: false,
    provisioningStatus: "WEBHOOK_PENDING",
    provisioningError: "Webhook retry required",
    isPrivate: true,
    collaborators: [
      { username: "ada", permission: "push", status: "active" },
      {
        username: "judge",
        permission: "pull",
        status: "failed",
        error: "Invitation pending",
      },
    ],
  },
};
const user = { id: "user-1", name: "Ada", githubUsername: "ada" };
const members = [
  { id: "member-1", teamId: team.id, userId: user.id, role: "admin", user },
];
const hackathon = {
  id: "fixture-hackathon",
  name: "Fixture Hackathon",
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-10-01T00:00:00.000Z",
  rules: [],
  rubric: [],
};

test("renders recoverable provisioning and collaborator invitation outcomes", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") return route.fulfill({ json: user });
    if (path === `/teams/${team.id}`) return route.fulfill({ json: team });
    if (path === `/teams/${team.id}/members`)
      return route.fulfill({ json: members });
    if (path === `/hackathons/${hackathon.id}`)
      return route.fulfill({ json: hackathon });
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected ${path}` },
    });
  });

  await page.goto(`/teams/${team.id}`);
  await page.getByRole("button", { name: "GitHub & Webhook" }).click();
  await expect(page.getByTestId("repository-provisioning-status")).toHaveText(
    "WEBHOOK_PENDING",
  );
  await expect(page.getByTestId("repository-provisioning-error")).toContainText(
    "Webhook retry required",
  );
  await expect(page.getByTestId("repository-collaborators")).toContainText(
    "ada",
  );
  await expect(page.getByTestId("repository-collaborators")).toContainText(
    "judge",
  );
  await expect(page.getByTestId("repository-collaborators")).toContainText(
    "failed",
  );
});
