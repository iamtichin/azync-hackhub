export type LeaderboardSourceTeam = {
  id: string;
  name: string;
  updatedAt: Date;
  tasks: Array<{ status: string; updatedAt: Date }>;
  registrations: Array<{ registeredAt: Date }>;
  repository: null | {
    lastCommitSha: string | null;
    workflowRuns: Array<{
      runId: string;
      runAttempt: number;
      headSha: string;
      status: string;
      conclusion: string | null;
      testStatus: string;
      coverageStatus: string;
      trustLimitations: unknown;
      updatedAt: Date;
    }>;
  };
};

function latestDate(team: LeaderboardSourceTeam): Date {
  const candidates = [
    team.updatedAt,
    team.registrations[0]?.registeredAt,
    ...team.tasks.map((task) => task.updatedAt),
    team.repository?.workflowRuns[0]?.updatedAt,
  ].filter((value): value is Date => value instanceof Date);
  return new Date(Math.max(...candidates.map((value) => value.getTime())));
}

function ciSignal(team: LeaderboardSourceTeam) {
  const run = team.repository?.workflowRuns[0];
  if (!run) {
    return {
      status: 'unknown' as const,
      testStatus: 'UNKNOWN',
      coverageStatus: 'UNKNOWN',
      commitSha: team.repository?.lastCommitSha ?? null,
      runId: null,
      runAttempt: null,
      updatedAt: null,
      trustLimitations: [
        'No signed workflow run has been received for this repository.',
      ],
    };
  }
  if (team.repository?.lastCommitSha && run.headSha !== team.repository.lastCommitSha) {
    return {
      status: 'unknown' as const,
      testStatus: 'UNKNOWN',
      coverageStatus: 'UNKNOWN',
      commitSha: team.repository.lastCommitSha,
      runId: null,
      runAttempt: null,
      updatedAt: null,
      trustLimitations: ['The latest workflow run belongs to a different commit.'],
    };
  }
  const status =
    run.status !== 'completed'
      ? ('running' as const)
      : run.testStatus === 'PASSED'
        ? ('passed' as const)
        : run.testStatus === 'FAILED'
          ? ('failed' as const)
          : ('unknown' as const);
  return {
    status,
    testStatus: run.testStatus,
    coverageStatus: run.coverageStatus,
    commitSha: run.headSha,
    runId: run.runId,
    runAttempt: run.runAttempt,
    updatedAt: run.updatedAt,
    trustLimitations: Array.isArray(run.trustLimitations)
      ? run.trustLimitations
      : [],
  };
}

export function buildLeaderboardEntries(teams: LeaderboardSourceTeam[]) {
  const entries = teams.map((team) => {
    const totalTasks = team.tasks.length;
    const completedTasks = team.tasks.filter(
      (task) => task.status === 'done',
    ).length;
    const taskCompletionPercent = totalTasks
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0;
    return {
      teamId: team.id,
      teamName: team.name,
      rank: 0,
      metrics: { taskCompletionPercent },
      progress: {
        totalTasks,
        completedTasks,
        inProgressTasks: team.tasks.filter(
          (task) => task.status === 'in_progress',
        ).length,
        blockedTasks: team.tasks.filter((task) => task.status === 'blocked')
          .length,
        todoTasks: team.tasks.filter((task) => task.status === 'todo').length,
        backlogTasks: team.tasks.filter((task) => task.status === 'backlog')
          .length,
      },
      ci: ciSignal(team),
      lastUpdated: latestDate(team),
    };
  });

  entries.sort(
    (left, right) =>
      right.metrics.taskCompletionPercent -
        left.metrics.taskCompletionPercent ||
      left.teamName.localeCompare(right.teamName) ||
      left.teamId.localeCompare(right.teamId),
  );

  let previousPercent: number | null = null;
  let previousRank = 0;
  return entries.map((entry, index) => {
    if (entry.metrics.taskCompletionPercent !== previousPercent) {
      previousRank = index + 1;
      previousPercent = entry.metrics.taskCompletionPercent;
    }
    return { ...entry, rank: previousRank };
  });
}
