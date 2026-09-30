import { buildLeaderboardEntries, type LeaderboardSourceTeam } from './leaderboard';

const at = (value: string) => new Date(value);
const team = (
  id: string,
  statuses: string[],
  workflowRuns: LeaderboardSourceTeam['repository'] extends infer R
    ? R extends { workflowRuns: infer W }
      ? W
      : never
    : never = [],
): LeaderboardSourceTeam => ({
  id,
  name: id,
  updatedAt: at('2026-09-01T00:00:00.000Z'),
  registrations: [{ registeredAt: at('2026-09-02T00:00:00.000Z') }],
  tasks: statuses.map((status, index) => ({
    status,
    updatedAt: at(`2026-09-0${index + 3}T00:00:00.000Z`),
  })),
  repository: {
    lastCommitSha: workflowRuns[0]?.headSha ?? 'a'.repeat(40),
    workflowRuns,
  },
});

describe('buildLeaderboardEntries', () => {
  it('ranks only by completed-task percentage and gives equal percentages the same rank', () => {
    const result = buildLeaderboardEntries([
      team('Zulu', ['done', 'todo']),
      team('Alpha', ['done', 'blocked']),
      team('Winner', ['done']),
    ]);

    expect(result.map(({ teamId, rank }) => ({ teamId, rank }))).toEqual([
      { teamId: 'Winner', rank: 1 },
      { teamId: 'Alpha', rank: 2 },
      { teamId: 'Zulu', rank: 2 },
    ]);
    expect(result[1].metrics.taskCompletionPercent).toBe(50);
  });

  it('never presents missing CI as passed and keeps task states separate', () => {
    const [entry] = buildLeaderboardEntries([
      team('NoCI', ['done', 'in_progress', 'blocked', 'todo', 'backlog']),
    ]);

    expect(entry.ci).toMatchObject({
      status: 'unknown',
      testStatus: 'UNKNOWN',
      coverageStatus: 'UNKNOWN',
      runId: null,
    });
    expect(entry.progress).toEqual({
      totalTasks: 5,
      completedTasks: 1,
      inProgressTasks: 1,
      blockedTasks: 1,
      todoTasks: 1,
      backlogTasks: 1,
    });
  });

  it('shows running and completed CI independently from task rank', () => {
    const running = {
      runId: '10', runAttempt: 1, headSha: 'b'.repeat(40), status: 'in_progress',
      conclusion: null, testStatus: 'UNKNOWN', coverageStatus: 'UNKNOWN',
      trustLimitations: ['Participant can modify workflow'],
      updatedAt: at('2026-09-10T00:00:00.000Z'),
    };
    const passed = {
      ...running, runId: '11', status: 'completed', conclusion: 'success',
      testStatus: 'PASSED', updatedAt: at('2026-09-11T00:00:00.000Z'),
    };

    expect(buildLeaderboardEntries([team('Running', [], [running])])[0].ci.status)
      .toBe('running');
    expect(buildLeaderboardEntries([team('Passed', [], [passed])])[0].ci.status)
      .toBe('passed');
  });

  it('does not present an older successful run as CI for a newer commit', () => {
    const previousRun = {
      runId: '12', runAttempt: 1, headSha: 'a'.repeat(40), status: 'completed',
      conclusion: 'success', testStatus: 'PASSED', coverageStatus: 'UNKNOWN',
      trustLimitations: [], updatedAt: at('2026-09-11T00:00:00.000Z'),
    };
    const source = team('NewHead', [], [previousRun]);
    source.repository!.lastCommitSha = 'b'.repeat(40);
    expect(buildLeaderboardEntries([source])[0].ci).toMatchObject({
      status: 'unknown', testStatus: 'UNKNOWN', commitSha: 'b'.repeat(40), runId: null,
    });
  });
});
