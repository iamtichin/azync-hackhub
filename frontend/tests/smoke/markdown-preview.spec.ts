import { expect, test, type Page, type Route } from "@playwright/test";

const event = {
  id: "event",
  name: "Ended event",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-01-02T00:00:00.000Z",
  rules: [],
  rubric: [],
  rulesVersion: "rules-v1",
  rubricVersion: "rubric-v1",
};

const submission = {
  id: "submission",
  teamId: "team",
  hackathonId: "event",
  projectName: "Markdown project",
  description: "A **source-backed** project.",
  githubUrl: "https://github.com/example/project",
  demoUrl: "https://example.com/demo",
  walletAddress: "wallet",
  status: "confirmed",
  createdAt: "2026-01-01T12:00:00.000Z",
  team: { id: "team", name: "Team", hackathonId: "event" },
};

async function judgeFixture(page: Page) {
  const messages = Array.from({ length: 18 }, (_, index) => ({
    id: `user-${index}`,
    role: "USER",
    content: `Earlier question ${index}\n\nThis line makes the history long enough to scroll.`,
    contextVersion: 2,
    createdAt: "2026-01-02T01:00:00.000Z",
  }));
  messages.push({
    id: "assistant-latest",
    role: "ASSISTANT",
    content:
      "## Latest verdict\n\n- **Verified** source\n- `CI` pending\n\n| Signal | State |\n| --- | --- |\n| Repo | Verified |\n\n<script>unsafe()</script>",
    contextVersion: 2,
    createdAt: "2026-01-02T01:01:00.000Z",
  });

  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "judge"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({ json: { id: "judge", name: "Judge" } });
    if (path === "/hackathons") return route.fulfill({ json: [event] });
    if (path === "/hackathons/event/submissions")
      return route.fulfill({ json: [submission] });
    if (path === "/submissions/submission/ai-analysis")
      return route.fulfill({
        json: {
          status: "completed",
          completed: true,
          results: {
            id: "analysis",
            createdAt: "2026-01-02T00:00:00.000Z",
            output: {
              summary:
                "## Evidence summary\n\nThe repository is **reviewable**.",
            },
          },
        },
      });
    if (path === "/submissions/submission/ai-chat/sessions")
      return route.fulfill({
        json: [
          {
            id: "session",
            title: "Review",
            submissionId: "submission",
            contextVersion: 2,
            status: "ACTIVE",
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            _count: { messages: messages.length },
          },
        ],
      });
    if (path === "/submissions/submission/ai-chat/sessions/session/messages")
      return route.fulfill({ json: messages });
    if (path === "/submissions/submission/ai-chat/suggestions")
      return route.fulfill({
        json: {
          suggestion: null,
          completion: null,
          candidates: [],
          contextVersion: 2,
        },
      });
    if (path === "/ai-bot/suggestions")
      return route.fulfill({ json: { suggestions: [] } });
    return route.fulfill({ json: {} });
  });
}

test("renders AI analysis and judge chat as safe Markdown and opens at the newest message", async ({
  page,
}) => {
  await judgeFixture(page);
  await page.goto("/judge?hackathon=event&submission=submission");

  await expect(page.locator(".brief-document .markdown-preview h2")).toHaveText(
    "Evidence summary",
  );
  await expect(
    page.locator(".brief-document .markdown-preview strong", {
      hasText: "reviewable",
    }),
  ).toHaveText("reviewable");
  await expect(
    page.locator(".message.assistant .markdown-preview h2"),
  ).toHaveText("Latest verdict");
  await expect(
    page.locator(".message.assistant .markdown-preview table"),
  ).toContainText("Verified");
  await expect(page.locator(".message.assistant script")).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator(".message-log")
        .evaluate(
          (element) =>
            Math.abs(
              element.scrollHeight - element.clientHeight - element.scrollTop,
            ) <= 2,
        ),
    )
    .toBe(true);
});

test("Azync-Bot renders Markdown and returns to the latest answer after reopening", async ({
  page,
}) => {
  const answer = `## Answer\n\n${Array.from({ length: 24 }, (_, index) => `- Item **${index + 1}**`).join("\n")}`;
  await page.addInitScript(() =>
    sessionStorage.setItem("azync.access_token", "user"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/auth/me")
      return route.fulfill({ json: { id: "user", name: "User" } });
    if (path === "/ai-bot/suggestions")
      return route.fulfill({ json: { suggestions: [] } });
    if (path === "/ai-bot/messages")
      return route.fulfill({
        json: { answer, relatedRoutes: [], suggestedQuestions: [] },
      });
    if (path === "/hackathons") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  const authReady = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/auth/me",
  );
  await page.goto("/");
  await authReady;
  await page.getByRole("button", { name: "Open Azync-Bot" }).click();
  const question = page.getByLabel("Question for Azync-Bot");
  await expect(question).toBeEnabled();
  await question.fill("Give me the long answer");
  await page
    .getByRole("button", { name: "Send question to Azync-Bot" })
    .click();
  await expect(
    page.locator(".app-guide-message.assistant .markdown-preview h2"),
  ).toHaveText("Answer");
  await expect
    .poll(() =>
      page
        .locator(".app-guide-log")
        .evaluate(
          (element) =>
            Math.abs(
              element.scrollHeight - element.clientHeight - element.scrollTop,
            ) <= 2,
        ),
    )
    .toBe(true);

  await page
    .getByRole("region", { name: /Azync-Bot/ })
    .getByRole("button", { name: "Close Azync-Bot" })
    .click();
  await page.getByRole("button", { name: "Open Azync-Bot" }).click();
  await expect
    .poll(() =>
      page
        .locator(".app-guide-log")
        .evaluate(
          (element) =>
            Math.abs(
              element.scrollHeight - element.clientHeight - element.scrollTop,
            ) <= 2,
        ),
    )
    .toBe(true);
});
