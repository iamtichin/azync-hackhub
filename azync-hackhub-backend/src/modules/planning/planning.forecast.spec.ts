import { calculatePlanningForecast } from './planning.forecast';

const now = new Date('2026-09-15T12:00:00.000Z');
const task = (overrides: Record<string, unknown> = {}) => ({
  id: 'task', status: 'todo', estimatedHours: 4, actualHours: 0,
  createdAt: new Date('2026-09-01T00:00:00.000Z'), startedAt: null, completedAt: null,
  ...overrides,
});

describe('calculatePlanningForecast', () => {
  it('does not invent a projection with no work or no completion history', () => {
    expect(calculatePlanningForecast([], 0, null, now)).toMatchObject({ status: 'no_tasks', projectedFinishAt: null, risk: 'unknown' });
    expect(calculatePlanningForecast([task()], 4, new Date('2026-09-20T00:00:00.000Z'), now)).toMatchObject({ status: 'not_started', projectedFinishAt: null, risk: 'unknown' });
  });

  it('requires a non-zero observation window before claiming velocity', () => {
    const result = calculatePlanningForecast([
      task({ id: 'done', status: 'done', completedAt: new Date('2026-09-14T12:00:00.000Z') }),
      task({ id: 'open' }),
    ], 4, null, now);
    expect(result).toMatchObject({ status: 'zero_velocity', projectedFinishAt: null, observation: { completedTaskCount: 1, velocityHoursPerDay: null } });
  });

  it('uses completion history and dependency critical work instead of member capacity', () => {
    const result = calculatePlanningForecast([
      task({ id: 'done-1', status: 'done', estimatedHours: 4, completedAt: new Date('2026-09-10T00:00:00.000Z') }),
      task({ id: 'done-2', status: 'done', estimatedHours: 4, completedAt: new Date('2026-09-12T00:00:00.000Z') }),
      task({ id: 'open', estimatedHours: 6 }),
    ], 8, new Date('2026-09-17T12:00:00.000Z'), now);
    expect(result.observation.velocityHoursPerDay).toBe(4);
    expect(result.remaining).toEqual({ taskHours: 6, criticalPathHours: 8, effectiveHours: 8 });
    expect(result.projectedFinishAt).toBe('2026-09-17T12:00:00.000Z');
    expect(result.risk).toBe('on_track');
  });

  it('reports deadline risk and completion explicitly', () => {
    expect(calculatePlanningForecast([task()], 4, new Date('2026-09-14T00:00:00.000Z'), now).risk).toBe('overdue');
    expect(calculatePlanningForecast([task({ status: 'done', completedAt: new Date('2026-09-12T00:00:00.000Z') })], 0, null, now)).toMatchObject({ status: 'complete', risk: 'complete' });
  });

  it('uses estimates for remaining work and excludes reopened tasks from velocity', () => {
    const result = calculatePlanningForecast([
      task({ id: 'done-1', status: 'done', estimatedHours: 4, actualHours: 2, completedAt: new Date('2026-09-10T00:00:00.000Z') }),
      task({ id: 'done-2', status: 'done', estimatedHours: 4, actualHours: 2, completedAt: new Date('2026-09-12T00:00:00.000Z') }),
      task({ id: 'open', estimatedHours: 5, actualHours: 99 }),
      task({ id: 'reopened', status: 'in_progress', estimatedHours: 3, actualHours: 8, completedAt: null }),
    ], 0, null, now);
    expect(result.observation).toMatchObject({ completedTaskCount: 2, completedHours: 4, velocityHoursPerDay: 2 });
    expect(result.remaining.taskHours).toBe(8);
  });
});
