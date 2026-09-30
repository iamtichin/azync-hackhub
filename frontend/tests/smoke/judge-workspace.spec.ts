import { expect, test, type Route } from "@playwright/test";

const hackathon = {
  id: "ended-hackathon",
  name: "Ended Hackathon",
  endDate: "2026-01-02T00:00:00.000Z",
  startDate: "2026-01-01T00:00:00.000Z",
  rules: [],
  rubric: [
    {
      id: "impact",
      name: "Impact",
      description: "Demonstrable user impact",
      weight: 0.5,
      minScore: 0,
      maxScore: 10,
    },
  ],
  rulesVersion: "rules-v2",
  rubricVersion: "rubric-v3",
};

const submission = {
  id: "submission-1",
  teamId: "team-1",
  hackathonId: hackathon.id,
  projectName: "Evidence Project",
  description: "A project whose claims require human review.",
  githubUrl: "https://github.com/example/project",
  demoUrl: "https://demo.example/project",
  walletAddress: "wallet",
  status: "confirmed",
  createdAt: "2026-01-01T12:00:00.000Z",
  team: { id: "team-1", name: "Evidence Team", hackathonId: hackathon.id },
};

const completedAnalysis = {
  status: "completed",
  completed: true,
  results: {
    id: "analysis-1",
    createdAt: "2026-01-01T12:00:00.000Z",
    output: {
      summary: {
        problem: "Teams need trustworthy review evidence.",
        solution: "The project collects scoped evidence for a human judge.",
        targetUsers: "Hackathon reviewers",
      },
      technologies: [],
      requirements: [
        {
          requirementId: "proof",
          status: "UNCERTAIN",
          confidence: 0.4,
          reason: "No independent proof was collected.",
          evidenceIds: [],
        },
      ],
      rubricAnalysis: [],
      concerns: [{ severity: "HIGH", description: "Evidence is incomplete." }],
      judgeQuestions: [],
    },
  },
};

test("renders an ended judge review as advisory with rubric and uncertainty", async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "judge-token"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/me")
      return route.fulfill({
        json: {
          id: "judge-1",
          name: "Judge",
          githubUsername: "judge",
          avatarUrl: null,
        },
      });
    if (url.pathname === "/hackathons")
      return route.fulfill({ json: [hackathon] });
    if (url.pathname === `/hackathons/${hackathon.id}/submissions`)
      return route.fulfill({ json: [submission] });
    if (url.pathname === `/submissions/${submission.id}/ai-analysis`)
      return route.fulfill({ json: completedAnalysis });
    if (url.pathname === `/submissions/${submission.id}/ai-chat/sessions`)
      return route.fulfill({ json: [] });
    if (url.pathname === `/submissions/${submission.id}/ai-chat/suggestions`)
      return route.fulfill({
        json: {
          suggestion: null,
          completion: null,
          candidates: [],
          contextVersion: 4,
        },
      });
    return route.fulfill({ json: {} });
  });

  await page.goto("/judge");
  await expect(
    page.getByRole("heading", { name: "Evidence Project" }),
  ).toBeVisible();
  await expect(page.getByText("AI advisory only.")).toBeVisible();
  await expect(page.getByText(/1 requirement is uncertain/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Human scoring rubric" }),
  ).toBeVisible();
  await expect(page.getByText(/Impact/)).toBeVisible();
  await expect(page.getByText(/range 0–10/)).toBeVisible();
  await expect(page.getByText("v4")).toBeVisible();
});

test("hides an old brief while current analysis is queued or failed and exposes retry", async ({
  page,
}) => {
  let analysisReads = 0;
  let refreshes = 0;
  let failureRequested = false;
  const submissionWithOldBrief = {
    ...submission,
    aiAnalyses: [{ output: completedAnalysis.results.output }],
  };
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "judge-token"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/me")
      return route.fulfill({
        json: {
          id: "judge-1",
          name: "Judge",
          githubUsername: "judge",
          avatarUrl: null,
        },
      });
    if (url.pathname === "/hackathons")
      return route.fulfill({ json: [hackathon] });
    if (url.pathname === `/hackathons/${hackathon.id}/submissions`)
      return route.fulfill({ json: [submissionWithOldBrief] });
    if (url.pathname === `/submissions/${submission.id}/ai-analysis`) {
      analysisReads += 1;
      return route.fulfill({
        json: failureRequested
          ? {
              status: "failed",
              completed: false,
              error: { message: "Provider timed out" },
              results: { ...completedAnalysis.results },
            }
          : { status: "queued", completed: false, results: null },
      });
    }
    if (url.pathname === `/submissions/${submission.id}/ai-analysis/refresh`) {
      refreshes += 1;
      failureRequested = true;
      return route.fulfill({
        json: {
          submissionId: submission.id,
          status: "queued",
          aiJobId: "job-2",
        },
      });
    }
    if (url.pathname === `/submissions/${submission.id}/ai-chat/sessions`)
      return route.fulfill({ json: [] });
    if (url.pathname === `/submissions/${submission.id}/ai-chat/suggestions`)
      return route.fulfill({
        json: {
          suggestion: null,
          completion: null,
          candidates: [],
          contextVersion: 4,
        },
      });
    return route.fulfill({ json: {} });
  });

  await page.goto("/judge");
  await expect(
    page.getByRole("heading", { name: "Evidence analysis pending" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByText("Teams need trustworthy review evidence."),
  ).toHaveCount(0);
  await expect(page.getByText("queued", { exact: true })).toBeVisible();
  await page.locator(".brief-actions button").click();
  await expect.poll(() => refreshes).toBe(1);
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/Evidence analysis failed: Provider timed out/),
  ).toBeVisible();
  await expect(
    page.getByText("Teams need trustworthy review evidence."),
  ).toHaveCount(0);
  await expect(page.getByText(/refresh control to retry/)).toBeVisible();
});

test("keeps one persisted chat message and updates its private session count", async ({
  page,
}) => {
  const userMessage = {
    id: "message-user",
    role: "USER",
    content: "What proves impact?",
    contextVersion: 4,
    createdAt: "2026-01-01T12:01:00.000Z",
  };
  const assistantMessage = {
    id: "message-assistant",
    role: "ASSISTANT",
    content: "The available evidence is incomplete.",
    contextVersion: 4,
    createdAt: "2026-01-01T12:01:01.000Z",
    model: "local-evidence-fallback",
    evidenceLinks: [
      {
        evidence: {
          id: "evidence-1",
          type: "GITHUB_TEST_SIGNAL",
          status: "VERIFIED",
          reference: "https://github.com/example/project/actions",
        },
      },
    ],
  };
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "judge-token"),
  );
  await page.route("http://localhost:3001/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/auth/me")
      return route.fulfill({
        json: {
          id: "judge-1",
          name: "Judge",
          githubUsername: "judge",
          avatarUrl: null,
        },
      });
    if (url.pathname === "/hackathons")
      return route.fulfill({ json: [hackathon] });
    if (url.pathname === `/hackathons/${hackathon.id}/submissions`)
      return route.fulfill({ json: [submission] });
    if (url.pathname === `/submissions/${submission.id}/ai-analysis`)
      return route.fulfill({ json: completedAnalysis });
    if (url.pathname === `/submissions/${submission.id}/ai-chat/sessions`)
      return route.fulfill({
        json: [
          {
            id: "session-1",
            title: "Private review",
            submissionId: submission.id,
            contextVersion: 4,
            status: "ACTIVE",
            createdAt: "2026-01-01T12:00:00.000Z",
            updatedAt: "2026-01-01T12:00:00.000Z",
            _count: { messages: 0 },
          },
        ],
      });
    if (
      url.pathname ===
        `/submissions/${submission.id}/ai-chat/sessions/session-1/messages` &&
      method === "GET"
    )
      return route.fulfill({ json: [userMessage] });
    if (
      url.pathname ===
        `/submissions/${submission.id}/ai-chat/sessions/session-1/messages` &&
      method === "POST"
    )
      return route.fulfill({
        json: {
          status: "completed",
          userMessage,
          assistantMessage,
          answer: assistantMessage.content,
          evidenceIds: [],
          uncertainty: "Evidence is incomplete.",
          contextVersion: 4,
          contextAdvanced: false,
        },
      });
    if (url.pathname === `/submissions/${submission.id}/ai-chat/suggestions`)
      return route.fulfill({
        json: {
          suggestion: null,
          completion: null,
          candidates: [],
          contextVersion: 4,
        },
      });
    return route.fulfill({ json: {} });
  });

  await page.goto("/judge");
  await expect(page.getByText("What proves impact?")).toHaveCount(1);
  await page
    .getByLabel(/Question for this submission/)
    .fill("What proves impact?");
  await page.getByRole("button", { name: /Send question/ }).click();
  await expect(page.getByText("What proves impact?")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const bot = document
          .querySelector(".app-guide-trigger")
          ?.getBoundingClientRect();
        const send = document
          .querySelector(".inquiry-composer .send-button")
          ?.getBoundingClientRect();
        if (!bot || !send) return false;
        return (
          bot.right <= send.left ||
          bot.left >= send.right ||
          bot.bottom <= send.top ||
          bot.top >= send.bottom
        );
      }),
    )
    .toBe(true);
  await expect(
    page.getByText("The available evidence is incomplete."),
  ).toBeVisible();
  await expect(page.getByText("Azync evidence")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Test \/ CI signal · VERIFIED/ }),
  ).toHaveAttribute("href", "https://github.com/example/project/actions");
  await expect(page.locator(".session-select select")).toContainText("2");
});
