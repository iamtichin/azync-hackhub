"use client";

import {
  AlertTriangle,
  Clock3,
  GitMerge,
  LayoutTemplate,
  Plus,
  Trash2,
} from "lucide-react";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api, apiErrorMessage } from "@/lib/api";
import { useTeamActivityRealtime, useTeamRealtime } from "@/lib/use-realtime";
import { areaProgressAlerts, currentForecastRisk } from "@/lib/planning-health";
import type {
  CriticalPath,
  PlanningArea,
  PlanningForecast,
  PlanningTask,
  TaskPriority,
  TaskStatus,
  TeamMember,
  TeamActivity,
} from "@/lib/types";

const statuses: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "done",
];

type Template = {
  id: "web3" | "ai" | "fullstack";
  name: string;
  areas: Array<{
    name: string;
    color: string;
    tasks: Array<{ title: string; hours: number }>;
  }>;
};

const templates: Template[] = [
  {
    id: "web3",
    name: "Web3 dApp",
    areas: [
      {
        name: "Smart Contract",
        color: "#7c3aed",
        tasks: [
          { title: "Design instructions and accounts", hours: 3 },
          { title: "Implement Solana program", hours: 5 },
        ],
      },
      {
        name: "Frontend",
        color: "#087da8",
        tasks: [
          { title: "Wallet integration", hours: 4 },
          { title: "Product UI", hours: 6 },
        ],
      },
      {
        name: "Testing",
        color: "#18794e",
        tasks: [{ title: "Program & integration tests", hours: 4 }],
      },
      {
        name: "Demo",
        color: "#946200",
        tasks: [{ title: "Demo script & proof", hours: 4 }],
      },
    ],
  },
  {
    id: "ai",
    name: "AI Application",
    areas: [
      {
        name: "Model Integration",
        color: "#7c3aed",
        tasks: [
          { title: "Prompt and output schema", hours: 3 },
          { title: "Provider integration", hours: 3 },
        ],
      },
      {
        name: "API Layer",
        color: "#18794e",
        tasks: [
          { title: "AI endpoint & validation", hours: 5 },
          { title: "Queue and retries", hours: 3 },
        ],
      },
      {
        name: "Frontend",
        color: "#087da8",
        tasks: [
          { title: "AI experience UI", hours: 7 },
          { title: "Loading and error states", hours: 3 },
        ],
      },
      {
        name: "Demo",
        color: "#946200",
        tasks: [{ title: "Evaluation set & demo", hours: 4 }],
      },
    ],
  },
  {
    id: "fullstack",
    name: "Full-Stack Web",
    areas: [
      {
        name: "Backend",
        color: "#18794e",
        tasks: [
          { title: "Schema and API contracts", hours: 5 },
          { title: "Core business flow", hours: 7 },
        ],
      },
      {
        name: "Frontend",
        color: "#087da8",
        tasks: [
          { title: "Primary user flow", hours: 7 },
          { title: "Responsive polish", hours: 5 },
        ],
      },
      {
        name: "Database",
        color: "#7c3aed",
        tasks: [{ title: "Migrations and seed data", hours: 4 }],
      },
      {
        name: "Deploy",
        color: "#946200",
        tasks: [{ title: "Production deployment", hours: 4 }],
      },
    ],
  },
];

export function PlanningBoard({
  teamId,
  members = [],
  deadline,
}: {
  teamId: string;
  members?: TeamMember[];
  deadline?: string;
}) {
  const [areas, setAreas] = useState<PlanningArea[]>([]);
  const [tasks, setTasks] = useState<PlanningTask[]>([]);
  const [critical, setCritical] = useState<CriticalPath | null>(null);
  const [forecast, setForecast] = useState<PlanningForecast | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [areaName, setAreaName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [areaId, setAreaId] = useState("");
  const [hours, setHours] = useState(1);
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dependencyTask, setDependencyTask] = useState("");
  const [dependsOn, setDependsOn] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | TaskStatus>("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [activities, setActivities] = useState<TeamActivity[]>([]);
  const activityCursor = useRef<TeamActivity | null>(null);

  const mergeActivities = useCallback((incoming: TeamActivity[]) => {
    if (!incoming.length) return;
    setActivities((current) => {
      const merged = new Map(current.map((item) => [item.id, item]));
      incoming.forEach((item) => merged.set(item.id, item));
      const ordered = [...merged.values()].sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
      activityCursor.current =
        ordered[ordered.length - 1] || activityCursor.current;
      return ordered.slice(-30);
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const [areaRows, taskRows, path, nextForecast, activityRows] =
        await Promise.all([
          api.planning.areas(teamId),
          api.planning.tasks(teamId),
          api.planning.criticalPath(teamId),
          api.planning.forecast(teamId),
          api.planning.activity(teamId),
        ]);
      setAreas(areaRows);
      setTasks(taskRows);
      setCritical(path);
      setForecast(nextForecast);
      mergeActivities(activityRows.items);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }, [mergeActivities, teamId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useTeamRealtime(teamId, load);
  const loadActivityDelta = useCallback(() => {
    const initialCursor = activityCursor.current?.id;
    if (!initialCursor) return;
    void (async () => {
      let cursor: string | undefined = initialCursor;
      // Drain cursor pages so a long offline interval cannot silently lose
      // events after the first 100 rows.
      for (let page = 0; cursor && page < 100; page += 1) {
        const response = await api.planning.activity(teamId, cursor);
        mergeActivities(response.items);
        cursor = response.nextCursor || undefined;
      }
    })().catch(() => undefined);
  }, [mergeActivities, teamId]);
  const appendActivity = useCallback(
    (activity: TeamActivity) => mergeActivities([activity]),
    [mergeActivities],
  );
  useTeamActivityRealtime(teamId, appendActivity, loadActivityDelta);
  const criticalIds = useMemo(
    () => new Set(critical?.criticalPath || []),
    [critical],
  );
  const filteredTasks = useMemo(
    () =>
      tasks.filter(
        (task) =>
          (statusFilter === "all" || task.status === statusFilter) &&
          (areaFilter === "all" ||
            (areaFilter === "none"
              ? !task.areaId
              : task.areaId === areaFilter)) &&
          (assigneeFilter === "all" ||
            (assigneeFilter === "unassigned"
              ? !task.assigneeId
              : task.assigneeId === assigneeFilter)),
      ),
    [tasks, statusFilter, areaFilter, assigneeFilter],
  );
  const progress = useMemo(() => {
    const done = tasks.filter((task) => task.status === "done").length;
    const remainingHours = tasks
      .filter((task) => task.status !== "done")
      .reduce((sum, task) => sum + Number(task.estimatedHours || 0), 0);
    const byArea = areas.map((area) => {
      const scoped = tasks.filter((task) => task.areaId === area.id);
      const completed = scoped.filter((task) => task.status === "done").length;
      return {
        ...area,
        total: scoped.length,
        percent: scoped.length
          ? Math.round((completed / scoped.length) * 100)
          : 0,
      };
    });
    return {
      done,
      remainingHours,
      byArea,
      percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  }, [areas, tasks]);
  const currentRisk = currentForecastRisk(forecast, now);
  const alerts = useMemo(() => {
    const values: string[] = [];
    const blocked = tasks.filter((task) => task.status === "blocked").length;
    if (blocked)
      values.push(
        `${blocked} task${blocked === 1 ? " is" : "s are"} blocked and may delay the critical path.`,
      );
    const testing = progress.byArea.find((area) => /test|qa/i.test(area.name));
    if (!testing || testing.total === 0)
      values.push("No tasks have been allocated to testing.");
    const demo = progress.byArea.find((area) =>
      /demo|pitch|polish/i.test(area.name),
    );
    if (!demo || demo.percent === 0)
      values.push("No demo or pitch tasks have been completed.");
    values.push(...areaProgressAlerts(areas, tasks));
    if (currentRisk === "at_risk")
      values.push("The completion forecast exceeds the deadline.");
    if (currentRisk === "overdue")
      values.push("The deadline has passed with work still remaining.");
    return values;
  }, [areas, currentRisk, progress, tasks]);
  const deadlineAt = forecast?.deadline || deadline;
  const remainingDeadlineMs = deadlineAt
    ? new Date(deadlineAt).getTime() - now
    : null;

  async function mutate(operation: () => Promise<unknown>) {
    try {
      setError(null);
      await operation();
      await load();
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }
  async function addArea(event: FormEvent) {
    event.preventDefault();
    await mutate(() =>
      api.planning.createArea(teamId, { name: areaName, color: "#087da8" }),
    );
    setAreaName("");
  }
  async function addTask(event: FormEvent) {
    event.preventDefault();
    await mutate(() =>
      api.planning.createTask(teamId, {
        title: taskTitle,
        areaId: areaId || undefined,
        estimatedHours: hours,
        priority,
        assigneeId: assigneeId || undefined,
      }),
    );
    setTaskTitle("");
  }
  async function addDependency(event: FormEvent) {
    event.preventDefault();
    if (!dependencyTask || !dependsOn) return;
    await mutate(() =>
      api.planning.addDependency(teamId, dependencyTask, dependsOn),
    );
  }
  async function applyTemplate(template: Template) {
    try {
      setTemplateBusy(true);
      setError(null);
      const snapshot = await api.planning.applyTemplate(teamId, template.id);
      setAreas(snapshot.areas);
      setTasks(snapshot.tasks);
      setCritical(null);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setTemplateBusy(false);
    }
  }
  function canMoveToStatus(task: PlanningTask, nextStatus: TaskStatus) {
    if (nextStatus === task.status) return true;
    const waitingFor = (task.dependencies || [])
      .filter((dependency) => dependency.dependsOn?.status !== "done")
      .map(
        (dependency) => dependency.dependsOn?.title || dependency.dependsOnId,
      );
    if (waitingFor.length && ["in_progress", "done"].includes(nextStatus)) {
      setError(
        `This task cannot move forward until these dependencies are complete: ${waitingFor.join(", ")}.`,
      );
      return false;
    }
    return true;
  }
  function moveTask(task: PlanningTask, nextStatus: TaskStatus) {
    if (!canMoveToStatus(task, nextStatus)) return;
    void mutate(() =>
      api.planning.updateTask(teamId, task.id, { status: nextStatus }),
    );
  }

  return (
    <section className="planning-workspace">
      {error && (
        <div className="notice danger" role="alert">
          {error}
        </div>
      )}
      <div className="planning-progress">
        <section>
          <p className="eyebrow">Delivery health</p>
          <strong>{progress.percent}%</strong>
          <div className="progress-track">
            <i style={{ width: `${progress.percent}%` }} />
          </div>
          <small>
            {progress.done}/{tasks.length} tasks complete ·{" "}
            {progress.remainingHours}h remaining
          </small>
        </section>
        <section>
          <p className="eyebrow">Projected finish</p>
          <strong>
            {forecast?.projectedFinishAt
              ? new Date(forecast.projectedFinishAt).toLocaleString("en-US", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : forecast?.status === "complete"
                ? "Complete"
                : forecast?.status === "no_tasks"
                  ? "No tasks"
                  : forecast?.status === "not_started"
                    ? "Not started"
                    : "Not enough history"}
          </strong>
          <small>
            {forecast
              ? `${forecast.observation.velocityHoursPerDay?.toFixed(2) ?? "—"} ${forecast.unit}; observed over ${forecast.observation.days.toFixed(2)} days.`
              : "Loading forecast…"}
          </small>
          <small>
            {remainingDeadlineMs === null
              ? "No deadline"
              : remainingDeadlineMs <= 0
                ? "Deadline has passed"
                : `${Math.ceil(remainingDeadlineMs / 3_600_000)} hours until the deadline`}
          </small>
          {forecast && (
            <small title={forecast.assumptions.join(" ")}>
              Calculated at{" "}
              {new Date(forecast.calculatedAt).toLocaleTimeString("en-US", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · critical {forecast.remaining.criticalPathHours}h
            </small>
          )}
        </section>
        <section className={alerts.length ? "risk-cell" : ""}>
          <p className="eyebrow">Rule-based alerts</p>
          <strong>
            {alerts.length
              ? `${alerts.length} item${alerts.length === 1 ? "" : "s"} need attention`
              : "On track"}
          </strong>
          {alerts.slice(0, 4).map((alert) => (
            <small key={alert}>
              <AlertTriangle size={11} /> {alert}
            </small>
          ))}
        </section>
      </div>
      {!!progress.byArea.length && (
        <div className="area-progress">
          {progress.byArea.map((area) => (
            <div key={area.id}>
              <span>
                <i style={{ background: area.color }} />
                {area.name}
              </span>
              <div>
                <i
                  style={{ width: `${area.percent}%`, background: area.color }}
                />
              </div>
              <strong>{area.percent}%</strong>
            </div>
          ))}
        </div>
      )}
      <div className="critical-strip">
        <div>
          <p className="eyebrow">Critical path</p>
          <strong>{critical?.totalHours ?? 0} hours remaining</strong>
        </div>
        <div className="critical-sequence">
          {critical?.tasks.length ? (
            critical.tasks.map((task, index) => (
              <span key={task.id}>
                {index > 0 && <i>→</i>}
                <b>{task.title}</b>
                <small>{task.estimatedHours}h</small>
              </span>
            ))
          ) : (
            <span>No tasks are on the critical path</span>
          )}
        </div>
      </div>
      <div className="planning-forms">
        <div className="template-bar">
          <span>
            <LayoutTemplate size={15} /> Start from a template
          </span>
          {templates.map((template) => (
            <button
              type="button"
              className="bare-button"
              disabled={templateBusy}
              key={template.id}
              onClick={() => void applyTemplate(template)}
            >
              {template.name}
            </button>
          ))}
        </div>
        <form className="inline-form" onSubmit={addArea}>
          <label>
            <span>Planning area</span>
            <input
              required
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
              placeholder="Backend, UX, Demo…"
            />
          </label>
          <button className="button secondary compact">
            <Plus size={14} /> Area
          </button>
        </form>
        <form className="inline-form task-form" onSubmit={addTask}>
          <label>
            <span>Task</span>
            <input
              required
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder="Work to complete"
            />
          </label>
          <label>
            <span>Area</span>
            <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">No area</option>
              {areas.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Assignee</span>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.user.name || member.user.githubUsername}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Hours</span>
            <input
              min={0}
              step={0.5}
              type="number"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
          <label>
            <span>Priority</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <button className="button primary compact">Add task</button>
        </form>
        <form className="inline-form dependency-form" onSubmit={addDependency}>
          <GitMerge size={16} />
          <label>
            <span>Task</span>
            <select
              value={dependencyTask}
              onChange={(e) => setDependencyTask(e.target.value)}
            >
              <option value="">Select task</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <span>depends on</span>
          <label>
            <span className="sr-only">Dependency</span>
            <select
              value={dependsOn}
              onChange={(e) => setDependsOn(e.target.value)}
            >
              <option value="">Select dependency</option>
              {tasks
                .filter((task) => task.id !== dependencyTask)
                .map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="button secondary compact"
            disabled={!dependencyTask || !dependsOn}
          >
            Link
          </button>
        </form>
        {areas.length > 0 && (
          <div className="area-inventory">
            {areas.map((area) => (
              <div key={area.id}>
                <i style={{ background: area.color }} />
                <span>
                  <strong>{area.name}</strong>
                  <small>
                    {area._count?.tasks ?? area.tasks?.length ?? 0} tasks
                  </small>
                </span>
                <button
                  type="button"
                  className="bare-button"
                  onClick={() => {
                    const name = prompt("New area name", area.name);
                    if (name?.trim())
                      void mutate(() =>
                        api.planning.updateArea(teamId, area.id, {
                          name: name.trim(),
                        }),
                      );
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="bare-button danger-text"
                  onClick={() => {
                    if (
                      confirm(
                        `Delete area “${area.name}”? Its tasks will no longer have an area.`,
                      )
                    )
                      void mutate(() =>
                        api.planning.removeArea(teamId, area.id),
                      );
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="planning-filters">
        <Clock3 size={14} />
        <span>Filter board</span>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "all" | TaskStatus)
          }
        >
          <option value="all">All statuses</option>
          {statuses.map((status) => (
            <option key={status} value={status}>
              {status.replace("_", " ")}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by area"
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
        >
          <option value="all">All areas</option>
          <option value="none">No area</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="all">Everyone</option>
          <option value="unassigned">Unassigned</option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.user.name || member.user.githubUsername}
            </option>
          ))}
        </select>
        <small>
          {filteredTasks.length}/{tasks.length} task
        </small>
      </div>
      <aside className="activity-feed" aria-label="Team activity">
        <header>
          <Clock3 size={14} /> <strong>Team activity</strong>
        </header>
        {activities.length ? (
          <ol>
            {activities
              .slice()
              .reverse()
              .map((activity) => (
                <li key={activity.id} data-testid={`activity-${activity.id}`}>
                  <strong>
                    {activity.actor.name || activity.actor.githubUsername}
                  </strong>{" "}
                  <span>
                    {activity.action.replaceAll(".", " ").replaceAll("_", " ")}
                  </span>
                  <time dateTime={activity.createdAt}>
                    {new Date(activity.createdAt).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
          </ol>
        ) : (
          <p className="muted">No planning activity yet.</p>
        )}
      </aside>
      <div className="kanban-board">
        {statuses.map((status) => (
          <section className="kanban-column" key={status}>
            <header>
              <span>{status.replace("_", " ")}</span>
              <b>
                {filteredTasks.filter((task) => task.status === status).length}
              </b>
            </header>
            <div
              data-testid={`kanban-column-${status}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                const task = tasks.find((item) => item.id === draggedTaskId);
                setDraggedTaskId(null);
                if (task) moveTask(task, status);
              }}
            >
              {filteredTasks
                .filter((task) => task.status === status)
                .map((task) => (
                  <article
                    className={`task-ticket ${criticalIds.has(task.id) ? "critical" : ""}`}
                    key={task.id}
                    data-testid={`task-${task.id}`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", task.id);
                      setDraggedTaskId(task.id);
                    }}
                    onDragEnd={() => setDraggedTaskId(null)}
                  >
                    <div className="task-flags">
                      {criticalIds.has(task.id) && (
                        <span>
                          <AlertTriangle size={11} /> critical
                        </span>
                      )}
                      <small>{task.priority}</small>
                    </div>
                    <strong>{task.title}</strong>
                    <p>
                      {task.area?.name || "No area"} · {task.estimatedHours}h
                      {task.assignee
                        ? ` · ${task.assignee.name || task.assignee.githubUsername}`
                        : ""}
                    </p>
                    {!!task.dependencies?.length && (
                      <div className="dependency-list">
                        sau{" "}
                        {task.dependencies
                          .map(
                            (item) => item.dependsOn?.title || item.dependsOnId,
                          )
                          .join(", ")}
                      </div>
                    )}
                    {!!task.dependencies?.length && (
                      <div className="dependency-actions">
                        {task.dependencies.map((item) => (
                          <button
                            type="button"
                            key={item.dependsOnId}
                            onClick={() =>
                              void mutate(() =>
                                api.planning.removeDependency(
                                  teamId,
                                  task.id,
                                  item.dependsOnId,
                                ),
                              )
                            }
                          >
                            × {item.dependsOn?.title || "dependency"}
                          </button>
                        ))}
                      </div>
                    )}
                    <footer>
                      <select
                        aria-label={`Status for ${task.title}`}
                        value={task.status}
                        onChange={(e) =>
                          moveTask(task, e.target.value as TaskStatus)
                        }
                      >
                        {statuses.map((item) => (
                          <option key={item} value={item}>
                            {item.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={`Assignee for ${task.title}`}
                        value={task.assigneeId || ""}
                        onChange={(e) =>
                          void mutate(() =>
                            api.planning.updateTask(teamId, task.id, {
                              assigneeId: e.target.value || null,
                            }),
                          )
                        }
                      >
                        <option value="">Unassigned</option>
                        {members.map((member) => (
                          <option key={member.userId} value={member.userId}>
                            {member.user.name || member.user.githubUsername}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="bare-button"
                        onClick={() => {
                          const title = prompt("New task name", task.title);
                          const estimate = prompt(
                            "Estimated hours",
                            String(task.estimatedHours),
                          );
                          if (
                            title?.trim() &&
                            estimate !== null &&
                            Number.isFinite(Number(estimate))
                          )
                            void mutate(() =>
                              api.planning.updateTask(teamId, task.id, {
                                title: title.trim(),
                                estimatedHours: Number(estimate),
                              }),
                            );
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="bare-button danger-text"
                        onClick={() => {
                          if (confirm(`Delete task “${task.title}”?`))
                            void mutate(() =>
                              api.planning.removeTask(teamId, task.id),
                            );
                        }}
                        aria-label={`Delete ${task.title}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </footer>
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
