export type ForecastTask = {
  id: string;
  status: string;
  estimatedHours: number;
  actualHours?: number | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
};

export type PlanningForecast = {
  calculatedAt: string;
  unit: 'completed planned-hours/day';
  status: 'no_tasks' | 'not_started' | 'zero_velocity' | 'forecasted' | 'complete';
  risk: 'unknown' | 'on_track' | 'at_risk' | 'overdue' | 'complete';
  projectedFinishAt: string | null;
  deadline: string | null;
  observation: {
    from: string | null;
    to: string | null;
    days: number;
    completedTaskCount: number;
    completedHours: number;
    velocityHoursPerDay: number | null;
  };
  remaining: { taskHours: number; criticalPathHours: number; effectiveHours: number };
  assumptions: string[];
};

const DAY_MS = 86_400_000;
const completedWorkHours = (task: Pick<ForecastTask, 'estimatedHours' | 'actualHours'>) =>
  Number(task.actualHours) > 0 ? Number(task.actualHours) : Number(task.estimatedHours) || 0;
const remainingWorkHours = (task: Pick<ForecastTask, 'estimatedHours'>) =>
  Number(task.estimatedHours) || 0;

export function calculatePlanningForecast(
  tasks: ForecastTask[],
  criticalPathHours: number,
  deadline: Date | null,
  now = new Date(),
): PlanningForecast {
  const calculatedAt = now.toISOString();
  const remainingTasks = tasks.filter((task) => task.status !== 'done');
  const remainingHours = remainingTasks.reduce((total, task) => total + remainingWorkHours(task), 0);
  const effectiveHours = Math.max(remainingHours, criticalPathHours);
  const completed = tasks
    .filter((task) => task.status === 'done' && task.completedAt)
    .sort((a, b) => a.completedAt!.getTime() - b.completedAt!.getTime());
  const assumptions = [
    'Velocity is historical completed planned-hours per calendar day, not team capacity.',
    'Actual hours replace estimates only for completed-task throughput; remaining work always uses estimates.',
    'The dependency critical path is a lower-bound check; the forecast uses the larger remaining-work or critical-path workload.',
  ];
  const base = {
    calculatedAt,
    unit: 'completed planned-hours/day' as const,
    deadline: deadline?.toISOString() ?? null,
    remaining: { taskHours: remainingHours, criticalPathHours, effectiveHours },
    assumptions,
  };
  if (!tasks.length) {
    return {
      ...base, status: 'no_tasks', risk: 'unknown', projectedFinishAt: null,
      observation: { from: null, to: null, days: 0, completedTaskCount: 0, completedHours: 0, velocityHoursPerDay: null },
    };
  }
  if (!remainingTasks.length) {
    return {
      ...base, status: 'complete', risk: 'complete', projectedFinishAt: calculatedAt,
      observation: { from: null, to: null, days: 0, completedTaskCount: completed.length, completedHours: completed.reduce((sum, task) => sum + completedWorkHours(task), 0), velocityHoursPerDay: null },
    };
  }
  const first = completed[0]?.completedAt ?? null;
  const last = completed[completed.length - 1]?.completedAt ?? null;
  const observationDays = first && last ? (last.getTime() - first.getTime()) / DAY_MS : 0;
  const completedHours = completed.reduce((sum, task) => sum + completedWorkHours(task), 0);
  const velocity = completed.length >= 2 && observationDays > 0 ? completedHours / observationDays : null;
  const observation = {
    from: first?.toISOString() ?? null, to: last?.toISOString() ?? null, days: observationDays,
    completedTaskCount: completed.length, completedHours, velocityHoursPerDay: velocity,
  };
  if (!completed.length) return { ...base, status: 'not_started', risk: deadline && deadline <= now ? 'overdue' : 'unknown', projectedFinishAt: null, observation };
  if (!velocity || velocity <= 0) return { ...base, status: 'zero_velocity', risk: deadline && deadline <= now ? 'overdue' : 'unknown', projectedFinishAt: null, observation };
  const projected = new Date(now.getTime() + (effectiveHours / velocity) * DAY_MS);
  return {
    ...base, status: 'forecasted', projectedFinishAt: projected.toISOString(), observation,
    risk: deadline ? (deadline <= now ? 'overdue' : projected > deadline ? 'at_risk' : 'on_track') : 'unknown',
  };
}
