import { expect, test } from "@playwright/test";

test("shows task progress and CI as separate non-official signals", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("azync.access_token", "leaderboard-token");
  });
  await page.route("http://localhost:3001/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me") {
      return route.fulfill({
        json: {
          id: "user",
          name: "Ada",
          githubUsername: "ada",
          avatarUrl: null,
        },
      });
    }
    if (path === "/hackathons/hack") {
      return route.fulfill({
        json: {
          id: "hack",
          name: "MVP",
          startDate: "2026-09-01T00:00:00Z",
          endDate: "2026-09-30T00:00:00Z",
          rules: [],
          rubric: [],
          rulesVersion: "v1",
          rubricVersion: "v1",
        },
      });
    }
    if (
      path === "/hackathons/hack/teams" ||
      path === "/hackathons/hack/submissions"
    ) {
      return route.fulfill({ json: [] });
    }
    if (path === "/hackathons/hack/leaderboard") {
      return route.fulfill({
        json: {
          hackathonId: "hack",
          hackathonName: "MVP",
          lastUpdated: "2026-09-16T00:00:00Z",
          definition: {
            rankingMetric: "task_completion_percent",
            formula:
              "completed tasks / total tasks * 100; an empty board is 0%",
            tiePolicy: "Equal percentages share a competition rank.",
            officialScore: false,
            ciMeaning: "CI is shown separately from rank.",
          },
          leaderboard: [
            {
              rank: 1,
              teamId: "team",
              teamName: "Fixture Team",
              metrics: { taskCompletionPercent: 50 },
              progress: {
                totalTasks: 2,
                completedTasks: 1,
                inProgressTasks: 0,
                blockedTasks: 0,
                todoTasks: 1,
                backlogTasks: 0,
              },
              ci: {
                status: "unknown",
                testStatus: "UNKNOWN",
                coverageStatus: "UNKNOWN",
                commitSha: null,
                runId: null,
                runAttempt: null,
                updatedAt: null,
                trustLimitations: ["No signed workflow run has been received."],
              },
              lastUpdated: "2026-09-16T00:00:00Z",
            },
          ],
        },
      });
    }
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected ${path}` },
    });
  });

  await page.goto("/hackathons/hack");

  const board = page.locator(".leaderboard-panel");
  await expect(board).toContainText("1/2");
  await expect(board).toContainText("50%");
  await expect(board).toContainText("Unknown");
  await expect(board).not.toContainText("Score");
  await expect(page.getByTestId("leaderboard-definition")).toContainText(
    "CI is a separate signal and is not an official score",
  );
});
