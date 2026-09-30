import { expect, test, type Page, type Route } from "@playwright/test";

const team = {
  id: "fixture-team",
  name: "Fixture Team",
  hackathonId: "fixture-hackathon",
};
const members = [
  {
    id: "membership-1",
    teamId: team.id,
    userId: "user-1",
    role: "admin",
    user: { id: "user-1", name: "Ada", githubUsername: "ada", avatarUrl: null },
  },
  {
    id: "membership-2",
    teamId: team.id,
    userId: "user-2",
    role: "member",
    user: { id: "user-2", name: "Lin", githubUsername: "lin", avatarUrl: null },
  },
];
const hackathon = {
  id: "fixture-hackathon",
  name: "Fixture Hackathon",
  startDate: "2026-09-01T00:00:00.000Z",
  endDate: "2026-10-01T00:00:00.000Z",
  rules: [],
  rubric: [],
  rulesVersion: "v1",
  rubricVersion: "v1",
  organizerId: "user-1",
};
const areas = [
  {
    id: "area-1",
    teamId: team.id,
    name: "Product",
    color: "#087da8",
    _count: { tasks: 2 },
  },
];
const prerequisite = {
  id: "task-prerequisite",
  teamId: team.id,
  areaId: "area-1",
  title: "Prerequisite",
  estimatedHours: 2,
  status: "todo",
  priority: "high",
  assigneeId: "user-1",
  assignee: members[0].user,
  area: areas[0],
  dependencies: [],
};
const dependent = {
  id: "task-dependent",
  teamId: team.id,
  areaId: "area-1",
  title: "Dependent task",
  estimatedHours: 3,
  status: "todo",
  priority: "medium",
  assigneeId: "user-2",
  assignee: members[1].user,
  area: areas[0],
  dependencies: [
    {
      taskId: "task-dependent",
      dependsOnId: "task-prerequisite",
      dependsOn: prerequisite,
    },
  ],
};
const forecast = {
  calculatedAt: "2026-09-15T12:00:00.000Z",
  unit: "completed planned-hours/day",
  status: "zero_velocity",
  risk: "unknown",
  projectedFinishAt: null,
  deadline: hackathon.endDate,
  observation: {
    days: 0,
    completedTaskCount: 0,
    completedHours: 0,
    velocityHoursPerDay: null,
  },
  remaining: { taskHours: 5, criticalPathHours: 3, effectiveHours: 5 },
  assumptions: ["Fixture forecast assumption."],
};
const activities = [
  {
    id: "activity-1",
    teamId: team.id,
    actorId: "user-2",
    action: "task.updated",
    createdAt: "2026-09-15T12:00:00.000Z",
    actor: members[1].user,
  },
  // The API may replay the latest item during reconnect; the UI must de-duplicate by id.
  {
    id: "activity-1",
    teamId: team.id,
    actorId: "user-2",
    action: "task.updated",
    createdAt: "2026-09-15T12:00:00.000Z",
    actor: members[1].user,
  },
];

async function openPlanning(
  page: Page,
  handler: (route: Route) => Promise<void>,
) {
  await page.addInitScript(() =>
    window.sessionStorage.setItem("azync.access_token", "fixture-token"),
  );
  await page.route("http://localhost:3001/**", handler);
  await page.goto(`/teams/${team.id}`);
  await page.getByRole("button", { name: "Planning Canvas" }).click();
  await expect(page.getByTestId("task-task-dependent")).toBeVisible();
}

function fixtureHandler(options: {
  template?: "success" | "failure";
  tasks?: unknown[];
  areas?: unknown[];
  onPatch?: (route: Route) => Promise<void>;
}) {
  return async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === "/auth/me")
      return route.fulfill({ json: members[0].user });
    if (url.pathname === `/teams/${team.id}`)
      return route.fulfill({ json: team });
    if (url.pathname === `/teams/${team.id}/members`)
      return route.fulfill({ json: members });
    if (url.pathname === `/hackathons/${hackathon.id}`)
      return route.fulfill({ json: hackathon });
    // Invite listing is optional admin-only data. A failure here must not
    // discard the already-loaded roster used by planning.
    if (url.pathname === `/teams/${team.id}/invites`)
      return route.fulfill({
        status: 503,
        json: { message: "Invite service unavailable" },
      });
    if (url.pathname === `/teams/${team.id}/planning/areas`)
      return route.fulfill({ json: options.areas || areas });
    if (url.pathname === `/teams/${team.id}/planning/tasks` && method === "GET")
      return route.fulfill({
        json: options.tasks || [prerequisite, dependent],
      });
    if (url.pathname === `/teams/${team.id}/planning/critical-path`)
      return route.fulfill({
        json: { criticalPath: [], totalHours: 0, tasks: [] },
      });
    if (url.pathname === `/teams/${team.id}/planning/forecast`)
      return route.fulfill({ json: forecast });
    if (url.pathname === `/teams/${team.id}/planning/activity`)
      return route.fulfill({ json: { items: activities, nextCursor: null } });
    if (
      url.pathname === `/teams/${team.id}/planning/templates` &&
      method === "POST"
    ) {
      if (options.template === "failure")
        return route.fulfill({
          status: 409,
          json: { message: "Planning canvas is not empty" },
        });
      return route.fulfill({
        json: {
          areas: [{ ...areas[0], name: "Web3" }],
          tasks: [
            { ...prerequisite, id: "template-task", title: "Template task" },
          ],
        },
      });
    }
    if (method === "PATCH" && options.onPatch) return options.onPatch(route);
    return route.fulfill({
      status: 500,
      json: { message: `Unexpected request: ${method} ${url.pathname}` },
    });
  };
}

test("applies a template with one atomic request and replaces the board from its snapshot", async ({
  page,
}) => {
  let templateCalls = 0;
  await openPlanning(
    page,
    fixtureHandler({
      onPatch: async (route) => route.fulfill({ json: dependent }),
    }),
  );
  await expect(page.getByText(/completed planned-hours\/day/)).toBeVisible();
  await expect(page.getByText("Not enough history")).toBeVisible();
  await page.route(
    "http://localhost:3001/teams/fixture-team/planning/templates",
    async (route) => {
      templateCalls += 1;
      await route.fulfill({
        json: {
          areas: [{ ...areas[0], name: "Web3" }],
          tasks: [
            { ...prerequisite, id: "template-task", title: "Template task" },
          ],
        },
      });
    },
  );
  await page.getByRole("button", { name: "Web3 dApp" }).click();
  await expect(page.getByTestId("task-template-task")).toBeVisible();
  await expect(page.getByTestId("task-task-dependent")).toHaveCount(0);
  expect(templateCalls).toBe(1);
});

test("keeps the current board intact when atomic template creation fails", async ({
  page,
}) => {
  await openPlanning(page, fixtureHandler({ template: "failure" }));
  await page.getByRole("button", { name: "Web3 dApp" }).click();
  await expect(
    page.locator('.planning-workspace [role="alert"]'),
  ).toContainText("Planning canvas is not empty");
  await expect(page.getByTestId("task-task-dependent")).toBeVisible();
  await expect(page.getByTestId("task-template-task")).toHaveCount(0);
});

test("filters by assignee, unassigns a task, and denies a dependency-blocked drag", async ({
  page,
}) => {
  const patches: Array<Record<string, unknown>> = [];
  await openPlanning(
    page,
    fixtureHandler({
      onPatch: async (route) => {
        patches.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.fulfill({
          json: { ...dependent, assigneeId: null, assignee: null },
        });
      },
    }),
  );
  await page.getByLabel("Filter by assignee").selectOption("user-2");
  await expect(page.getByTestId("task-task-dependent")).toBeVisible();
  await expect(page.getByTestId("task-task-prerequisite")).toHaveCount(0);
  await page.getByLabel("Assignee for Dependent task").selectOption("");
  await expect.poll(() => patches).toEqual([{ assigneeId: null }]);

  const card = page.getByTestId("task-task-dependent");
  const doneColumn = page.getByTestId("kanban-column-done");
  await card.dispatchEvent("dragstart", {
    dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
  });
  await doneColumn.dispatchEvent("drop");
  await expect(
    page.locator('.planning-workspace [role="alert"]'),
  ).toContainText("Prerequisite");
  expect(patches).toHaveLength(1);
});

test("keeps roster assignees and hackathon-backed planning usable when active invite loading fails", async ({
  page,
}) => {
  await openPlanning(page, fixtureHandler({}));
  const assigneeFilter = page.getByLabel("Filter by assignee");
  await expect(assigneeFilter.locator('option[value="user-2"]')).toHaveText(
    "Lin",
  );
  await assigneeFilter.selectOption("user-2");
  await expect(page.getByTestId("task-task-dependent")).toBeVisible();
  await expect(page.getByText(/Fixture Hackathon/)).toBeVisible();
});

test("updates deadline risk on the deterministic timer and flags a materially lagging area", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-30T00:00:00.000Z") });
  const laggingAreas = [
    { ...areas[0], id: "area-api", name: "API", _count: { tasks: 2 } },
    { ...areas[0], id: "area-ui", name: "UI", _count: { tasks: 2 } },
  ];
  const laggingTasks = [
    { ...prerequisite, id: "api-1", areaId: "area-api", area: laggingAreas[0] },
    { ...prerequisite, id: "api-2", areaId: "area-api", area: laggingAreas[0] },
    {
      ...prerequisite,
      id: "ui-1",
      areaId: "area-ui",
      area: laggingAreas[1],
      status: "done",
    },
    {
      ...prerequisite,
      id: "ui-2",
      areaId: "area-ui",
      area: laggingAreas[1],
      status: "done",
    },
    { ...dependent, areaId: "area-api", area: laggingAreas[0] },
  ];
  await openPlanning(
    page,
    fixtureHandler({ areas: laggingAreas, tasks: laggingTasks }),
  );
  await expect(page.getByText(/API trails overall progress/)).toBeVisible();
  await page.clock.fastForward("48:01:00");
  await expect(
    page.getByText("The deadline has passed with work still remaining."),
  ).toBeVisible();
});

test("renders persistent team activity once when an initial or replayed activity has the same cursor id", async ({
  page,
}) => {
  await openPlanning(page, fixtureHandler({}));
  const feed = page.getByLabel("Team activity");
  await expect(feed).toContainText("Lin");
  await expect(feed).toContainText("task updated");
  await expect(feed.getByTestId("activity-activity-1")).toHaveCount(1);
});

test("drains successive activity cursor pages after reconnect without losing or duplicating events", async ({
  page,
}) => {
  const afterCursors: string[] = [];
  await openPlanning(page, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/teams/${team.id}/planning/activity`) {
      const after = url.searchParams.get("after");
      if (!after)
        return route.fulfill({
          json: {
            items: [
              {
                id: "activity-1",
                teamId: team.id,
                actorId: "user-1",
                action: "task.created",
                createdAt: "2026-09-15T12:00:00.000Z",
                actor: members[0].user,
              },
            ],
            nextCursor: null,
          },
        });
      afterCursors.push(after);
      if (after === "activity-1")
        return route.fulfill({
          json: {
            items: [
              {
                id: "activity-2",
                teamId: team.id,
                actorId: "user-2",
                action: "task.updated",
                createdAt: "2026-09-15T12:01:00.000Z",
                actor: members[1].user,
              },
            ],
            nextCursor: "activity-2",
          },
        });
      return route.fulfill({
        json: {
          items: [
            {
              id: "activity-3",
              teamId: team.id,
              actorId: "user-1",
              action: "task.deleted",
              createdAt: "2026-09-15T12:02:00.000Z",
              actor: members[0].user,
            },
          ],
          nextCursor: null,
        },
      });
    }
    await fixtureHandler({})(route);
  });
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("activity-activity-2")).toHaveCount(1);
  await expect(page.getByTestId("activity-activity-3")).toHaveCount(1);
  await expect.poll(() => afterCursors).toEqual(["activity-1", "activity-2"]);
});
