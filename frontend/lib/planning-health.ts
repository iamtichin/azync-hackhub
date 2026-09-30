import type { PlanningArea, PlanningForecast, PlanningTask } from "./types";

export function currentForecastRisk(
  forecast: PlanningForecast | null,
  now: number,
) {
  if (!forecast || forecast.status === "complete")
    return forecast?.risk ?? "unknown";
  if (
    forecast.deadline &&
    new Date(forecast.deadline).getTime() <= now &&
    forecast.remaining.effectiveHours > 0
  )
    return "overdue";
  return forecast.risk;
}

export function areaProgressAlerts(
  areas: PlanningArea[],
  tasks: PlanningTask[],
) {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "done").length;
  if (total < 2 || completed === 0) return [];
  const overallPercent = (completed / total) * 100;
  return areas
    .map((area) => {
      const scoped = tasks.filter((task) => task.areaId === area.id);
      const areaPercent = scoped.length
        ? (scoped.filter((task) => task.status === "done").length /
            scoped.length) *
          100
        : 0;
      return { area, scoped, areaPercent };
    })
    .filter(
      ({ scoped, areaPercent }) =>
        scoped.length >= 2 && overallPercent - areaPercent >= 25,
    )
    .map(
      ({ area, areaPercent }) =>
        `${area.name} trails overall progress by at least 25 percentage points (${Math.round(areaPercent)}%).`,
    );
}
