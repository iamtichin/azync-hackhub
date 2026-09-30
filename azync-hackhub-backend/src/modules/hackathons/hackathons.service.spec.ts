import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HackathonsService } from './hackathons.service';

describe('HackathonsService final receipt retention', () => {
  const tx = {
    hackathon: { findUnique: jest.fn(), delete: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  } as any;
  const service = new HackathonsService(
    prisma,
    {} as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('refuses to delete an event with a final submission', async () => {
    tx.hackathon.findUnique.mockResolvedValue({
      organizerId: 'owner',
      _count: { registrations: 2, submissions: 1 },
    });

    await expect(service.remove('event', 'owner')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.hackathon.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it('refuses to delete an event with registered teams', async () => {
    tx.hackathon.findUnique.mockResolvedValue({
      organizerId: 'owner',
      _count: { registrations: 1, submissions: 0 },
    });
    await expect(service.remove('event', 'owner')).rejects.toThrow(
      'Cannot delete a hackathon that has registered teams',
    );
    expect(tx.hackathon.delete).not.toHaveBeenCalled();
  });

  it('checks ownership before exposing retention state', async () => {
    tx.hackathon.findUnique.mockResolvedValue({
      organizerId: 'owner',
      _count: { registrations: 2, submissions: 1 },
    });
    await expect(service.remove('event', 'outsider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.hackathon.delete).not.toHaveBeenCalled();
  });
});

describe('HackathonsService public projection', () => {
  const prisma = { hackathon: { findUnique: jest.fn() } } as any;
  const service = new HackathonsService(prisma, {} as any, {} as any, { syncTeamCollaborators: jest.fn() } as any);

  beforeEach(() => jest.clearAllMocks());

  it('selects only approved public detail fields and never returns organizer/private collections', async () => {
    prisma.hackathon.findUnique.mockResolvedValue({
      id: 'hack', name: 'Public', startDate: new Date(), endDate: new Date(), rules: [], rubric: [],
      rulesVersion: 'rules-v1', rubricVersion: 'rubric-v1', createdAt: new Date(), updatedAt: new Date(),
      _count: { registrations: 1, submissions: 2 },
    });

    const result = await service.findOne('hack');
    const query = prisma.hackathon.findUnique.mock.calls[0][0];

    expect(query.select.organizerId).toBeUndefined();
    expect(query.select.registrations).toBeUndefined();
    expect(query.select.submissions).toBeUndefined();
    expect(result).not.toHaveProperty('organizerId');
    expect(result).not.toHaveProperty('registrations');
    expect(result).not.toHaveProperty('submissions');
  });
});

describe('HackathonsService leaderboard contract', () => {
  const prisma = {
    hackathon: { findUnique: jest.fn() },
    team: { findUnique: jest.fn(), findMany: jest.fn() },
    hackathonRegistration: { findUnique: jest.fn(), create: jest.fn() },
  } as any;
  const events = { emitToPublicHackathon: jest.fn() };
  const service = new HackathonsService(prisma, events as any, {} as any, { syncTeamCollaborators: jest.fn() } as any);

  beforeEach(() => jest.clearAllMocks());

  it('returns the same explicit task-progress formula consumed by the UI', async () => {
    prisma.hackathon.findUnique.mockResolvedValue({ id: 'hack', name: 'MVP' });
    prisma.team.findMany.mockResolvedValue([
      {
        id: 'team', name: 'Team', updatedAt: new Date('2026-09-01T00:00:00Z'),
        registrations: [{ registeredAt: new Date('2026-09-01T00:00:00Z') }],
        tasks: [
          { status: 'done', updatedAt: new Date('2026-09-02T00:00:00Z') },
          { status: 'todo', updatedAt: new Date('2026-09-03T00:00:00Z') },
        ],
        repository: null,
      },
    ]);

    const result = await service.getLeaderboard('hack');

    expect(result.definition).toMatchObject({
      rankingMetric: 'task_completion_percent',
      officialScore: false,
    });
    expect(result.leaderboard[0]).toMatchObject({
      rank: 1,
      metrics: { taskCompletionPercent: 50 },
      ci: { status: 'unknown' },
    });
  });

  it('invalidates the public leaderboard after a team registers', async () => {
    const endDate = new Date(Date.now() + 86_400_000);
    prisma.hackathon.findUnique.mockResolvedValue({ id: 'hack', endDate });
    prisma.team.findUnique.mockResolvedValue({
      id: 'team', hackathonId: 'hack', members: [{ userId: 'member' }],
    });
    prisma.hackathonRegistration.findUnique.mockResolvedValue(null);
    prisma.hackathonRegistration.create.mockResolvedValue({ id: 'registration' });
    const emit = jest.spyOn(service, 'emitLeaderboardUpdate').mockResolvedValue();

    await service.registerTeam('hack', { teamId: 'team' }, 'member');

    expect(emit).toHaveBeenCalledWith('hack');
  });
});

describe('HackathonsService judge roster reconciliation', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    hackathonJudge: { upsert: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    team: { findMany: jest.fn() },
  } as any;
  const events = { emitToTeam: jest.fn() };
  const github = { syncTeamCollaborators: jest.fn() };
  const service = new HackathonsService(prisma, events as any, {} as any, github as any);

  beforeEach(() => jest.clearAllMocks());

  function fiveTeams() {
    return Array.from({ length: 5 }, (_, index) => ({ id: `team-${index + 1}` }));
  }

  it('assigning a judge commits first, then resyncs repositories in bounded batches and publishes outcomes', async () => {
    (service as any).requireOrganizer = jest.fn().mockResolvedValue(undefined);
    prisma.user.findUnique.mockResolvedValue({ id: 'judge-1' });
    prisma.hackathonJudge.upsert.mockResolvedValue({ id: 'assignment-1' });
    prisma.team.findMany.mockResolvedValue(fiveTeams());
    let active = 0;
    let peak = 0;
    github.syncTeamCollaborators.mockImplementation(async (teamId: string) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: 'synced', teamId };
    });

    await expect(service.assignJudge('hack-1', { userId: 'judge-1' }, 'organizer-1'))
      .resolves.toEqual({ id: 'assignment-1' });
    expect(peak).toBeLessThanOrEqual(4);
    expect(github.syncTeamCollaborators).toHaveBeenCalledTimes(5);
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'repository:collaborators-sync', { status: 'synced', teamId: 'team-1' });
  });

  it('removing a judge stays committed when an individual repository sync fails and reports both outcomes', async () => {
    (service as any).requireOrganizer = jest.fn().mockResolvedValue(undefined);
    prisma.hackathonJudge.findUnique.mockResolvedValue({ hackathonId: 'hack-1', userId: 'judge-1' });
    prisma.hackathonJudge.delete.mockResolvedValue({ userId: 'judge-1' });
    prisma.team.findMany.mockResolvedValue([{ id: 'team-ok' }, { id: 'team-failed' }]);
    github.syncTeamCollaborators
      .mockResolvedValueOnce({ status: 'synced' })
      .mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(service.removeJudge('hack-1', 'judge-1', 'organizer-1')).resolves.toEqual({ userId: 'judge-1' });
    expect(prisma.hackathonJudge.delete).toHaveBeenCalled();
    expect(events.emitToTeam).toHaveBeenCalledWith('team-ok', 'repository:collaborators-sync', { status: 'synced' });
    expect(events.emitToTeam).toHaveBeenCalledWith('team-failed', 'repository:collaborators-sync', { status: 'failed' });
  });
});
