import { expect, test, type Route } from "@playwright/test";

const hackathon = {
  id: "privacy-event",
  name: "Privacy Event",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-01-02T00:00:00.000Z",
  rules: [],
  rubric: [],
  rulesVersion: "rules-v1",
  rubricVersion: "rubric-v1",
};

function submission(id: string, projectName: string) {
  return {
    id,
    teamId: `team-${id}`,
    hackathonId: hackathon.id,
    projectName,
    description: `${projectName} description`,
    githubUrl: `https://github.com/example/${id}`,
    demoUrl: `https://demo.example/${id}`,
    walletAddress: "wallet",
    status: "confirmed",
    createdAt: "2026-01-01T12:00:00.000Z",
    team: {
      id: `team-${id}`,
      name: `${projectName} Team`,
      hackathonId: hackathon.id,
    },
  };
}

function analysis(secret: string) {
  return {
    status: "completed",
    completed: true,
    results: {
      id: `analysis-${secret}`,
      createdAt: "2026-01-01T12:00:00.000Z",
      output: {
        summary: {
          problem: secret,
          solution: "Scoped review",
          targetUsers: "Judges",
        },
        technologies: [],
        requirements: [],
        rubricAnalysis: [],
        concerns: [],
        judgeQuestions: [],
      },
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("account switch removes prior Judge and bot state and ignores late prior-session responses", async ({
  page,
}) => {
  const alpha = submission("alpha", "ALPHA PRIVATE PROJECT");
  const beta = submission("beta", "BETA PRIVATE PROJECT");
  let logoutAuthorization = "";

  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "token-a"),
  );

  await page.route("http://localhost:3001/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const authorization = route.request().headers()["authorization"] ?? "";
    const account = authorization.includes("token-b")
      ? "b"
      : authorization.includes("token-a")
        ? "a"
        : "anonymous";

    if (url.pathname === "/auth/me") {
      if (account === "a") {
        return route.fulfill({
          json: { id: "user-a", name: "Alpha Judge", githubUsername: "alpha" },
        });
      }
      if (account === "b") {
        return route.fulfill({
          json: { id: "user-b", name: "Beta Judge", githubUsername: "beta" },
        });
      }
      return route.fulfill({ status: 401, json: { message: "Unauthorized" } });
    }

    if (url.pathname === "/auth/logout") {
      logoutAuthorization = authorization;
      return route.fulfill({ json: { message: "Logged out" } });
    }

    if (url.pathname === "/hackathons")
      return route.fulfill({ json: [hackathon] });

    if (url.pathname === `/hackathons/${hackathon.id}/submissions`) {
      if (account === "a") return route.fulfill({ json: [alpha] });
      if (account === "b") return route.fulfill({ json: [beta] });
      return route.fulfill({ status: 401, json: { message: "Unauthorized" } });
    }

    if (url.pathname === `/submissions/${alpha.id}/ai-analysis`) {
      await sleep(700);
      return route.fulfill({ json: analysis("ALPHA ANALYSIS SECRET") });
    }
    if (url.pathname === `/submissions/${beta.id}/ai-analysis`) {
      return route.fulfill({ json: analysis("BETA ANALYSIS") });
    }

    if (url.pathname === `/submissions/${alpha.id}/ai-chat/sessions`) {
      await sleep(700);
      return route.fulfill({ json: [] });
    }
    if (url.pathname === `/submissions/${beta.id}/ai-chat/sessions`) {
      return route.fulfill({ json: [] });
    }

    if (url.pathname.includes("/ai-chat/suggestions")) {
      if (url.pathname.includes(`/${alpha.id}/`)) await sleep(700);
      return route.fulfill({
        json: {
          suggestion: null,
          completion: null,
          candidates: [],
          contextVersion: 1,
        },
      });
    }

    if (url.pathname === "/ai-bot/suggestions") {
      return route.fulfill({ json: { suggestions: [] } });
    }

    if (url.pathname === "/ai-bot/messages") {
      if (account === "a") {
        await sleep(700);
        return route.fulfill({
          json: {
            answer: "ALPHA BOT SECRET",
            relatedRoutes: [],
            suggestedQuestions: [],
          },
        });
      }
      return route.fulfill({
        json: {
          answer: "BETA BOT ANSWER",
          relatedRoutes: [],
          suggestedQuestions: [],
        },
      });
    }

    return route.fulfill({ json: {} });
  });

  await page.goto("/judge");
  await expect(
    page.getByRole("heading", { name: "ALPHA PRIVATE PROJECT" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/hackathon=privacy-event.*submission=alpha/);

  const alphaBotTrigger = page.getByRole("button", { name: "Open Azync-Bot" });
  await expect(alphaBotTrigger).toBeEnabled();
  await alphaBotTrigger.press("Enter");
  await expect(page.getByRole("region", { name: /Azync-Bot/ })).toBeVisible();
  await page
    .getByLabel("Question for Azync-Bot")
    .fill("alpha private question");
  await page
    .getByRole("button", { name: "Send question to Azync-Bot" })
    .click();
  await expect(page.getByText("alpha private question")).toBeVisible();

  await page.evaluate(() => {
    const state = { leaked: false };
    (
      window as typeof window & { __privacyState?: typeof state }
    ).__privacyState = state;
    const observer = new MutationObserver(() => {
      const identity =
        Array.from(
          document.querySelectorAll<HTMLElement>(".identity-button"),
        ).find((element) => element.getClientRects().length > 0)?.textContent ??
        "";
      const alphaHeading = Array.from(
        document.querySelectorAll("h1, h2, h3"),
      ).find((element) =>
        element.textContent?.includes("ALPHA PRIVATE PROJECT"),
      );
      if (
        identity.includes("Sign in") &&
        alphaHeading?.getClientRects().length
      ) {
        state.leaked = true;
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  });

  await page.getByRole("button", { name: "Account Alpha Judge" }).click();
  await page.getByRole("button", { name: /Sign out on this device/ }).click();

  await expect(
    page.getByRole("heading", { name: "ALPHA PRIVATE PROJECT" }),
  ).toHaveCount(0);
  await expect(page.getByText("alpha private question")).toHaveCount(0);
  await expect.poll(() => logoutAuthorization).toBe("Bearer token-a");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __privacyState?: { leaked: boolean } })
            .__privacyState?.leaked ?? false,
      ),
    )
    .toBe(false);

  const tokenInput = page.locator("#access-token");
  if (!(await tokenInput.isVisible())) {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(tokenInput).toBeVisible();
  await tokenInput.fill("token-b");
  await page.getByRole("button", { name: /Use this session/ }).click();

  await expect(
    page.getByRole("heading", { name: "BETA PRIVATE PROJECT" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/hackathon=privacy-event.*submission=beta/);
  const betaBotTrigger = page.getByRole("button", { name: "Open Azync-Bot" });
  await expect(betaBotTrigger).toBeEnabled();
  await betaBotTrigger.press("Enter");
  await expect(page.getByRole("region", { name: /Azync-Bot/ })).toBeVisible();
  await expect(page.getByText("alpha private question")).toHaveCount(0);

  await sleep(900);
  await expect(page.getByText("ALPHA ANALYSIS SECRET")).toHaveCount(0);
  await expect(page.getByText("ALPHA BOT SECRET")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "ALPHA PRIVATE PROJECT" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "BETA PRIVATE PROJECT" }),
  ).toBeVisible();
});
