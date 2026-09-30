import { ForbiddenException } from '@nestjs/common';
import { PlanningService } from './planning.service';

describe('PlanningService realtime events and activity cursor', () => {
  let prisma: any;
  let events: { emitToTeam: jest.Mock };
  let service: PlanningService;

  beforeEach(() => {
    events = { emitToTeam: jest.fn() };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      taskDependency: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 'dep-1', taskId: 'task-1', dependsOnId: 'task-2' }) },
    };
    prisma = {
      teamMember: { findUnique: jest.fn(({ where }: any) => Promise.resolve(where.teamId_userId.userId === 'outsider' ? null : { id: 'member' })) },
      area: {
        create: jest.fn().mockResolvedValue({ id: 'area-1', teamId: 'team-1', name: 'Build' }),
        findUnique: jest.fn().mockResolvedValue({ id: 'area-1', teamId: 'team-1' }),
        update: jest.fn().mockResolvedValue({ id: 'area-1', teamId: 'team-1', name: 'Ship' }),
        delete: jest.fn().mockResolvedValue({ id: 'area-1', teamId: 'team-1' }),
      },
      task: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 'task-1', teamId: 'team-1' }).mockResolvedValueOnce({ id: 'task-2', teamId: 'team-1' }),
        create: jest.fn().mockResolvedValue({ id: 'task-3', teamId: 'team-1', title: 'Build feature' }),
        update: jest.fn().mockResolvedValue({ id: 'task-3', teamId: 'team-1', title: 'Build feature', status: 'done' }),
        delete: jest.fn().mockResolvedValue({ id: 'task-3', teamId: 'team-1' }),
      },
      taskDependency: {
        findUnique: jest.fn().mockResolvedValue({ id: 'dep-1', task: { teamId: 'team-1' } }),
        delete: jest.fn().mockResolvedValue({ id: 'dep-1' }),
      },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      teamActivity: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `activity-${data.action}`, createdAt: new Date('2026-09-16T00:00:00Z'), ...data, actor: { id: data.actorId, name: 'Member' } })),
        findFirst: jest.fn().mockResolvedValue({ id: 'activity-1', createdAt: new Date('2026-09-16T00:00:00Z') }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new PlanningService(prisma, events as any, { emitLeaderboardUpdate: jest.fn() } as any);
  });

  it('emits area and dependency mutations to the team and persists actor-attributed activity', async () => {
    await service.createArea('team-1', { name: 'Build', color: '#fff' } as any, 'member-a');
    await service.updateArea('area-1', { name: 'Ship' }, 'member-b', 'team-1');
    await service.deleteArea('area-1', 'member-a', 'team-1');
    await service.addDependency('task-1', { dependsOnId: 'task-2' }, 'member-b', 'team-1');

    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'area:created', expect.objectContaining({ id: 'area-1' }));
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'area:updated', expect.objectContaining({ name: 'Ship' }));
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'area:deleted', { id: 'area-1' });
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'dependency:created', expect.objectContaining({ id: 'dep-1' }));
    expect(prisma.teamActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'member-b', action: 'dependency.created' }) }));
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'planning:activity', expect.objectContaining({ actor: expect.objectContaining({ id: expect.any(String) }) }));
  });

  it('authorizes the feed and requests only activity newer than a reconnect cursor', async () => {
    await service.getActivity('team-1', 'member-a', 'activity-1');
    expect(prisma.teamActivity.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: 'team-1', OR: [
        { createdAt: { gt: new Date('2026-09-16T00:00:00Z') } },
        { createdAt: new Date('2026-09-16T00:00:00Z'), id: { gt: 'activity-1' } },
      ] }),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));
    await expect(service.getActivity('team-1', 'outsider')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.teamActivity.findMany).toHaveBeenCalledTimes(1);

    prisma.teamActivity.findFirst.mockResolvedValueOnce(null);
    await expect(service.getActivity('team-1', 'member-a', 'foreign-or-stale-cursor')).resolves.toEqual({ items: [], nextCursor: null });
    expect(prisma.teamActivity.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns the newest initial activity page and paginates more than 100 reconnect events', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      id: `activity-${String(index).padStart(3, '0')}`,
      createdAt: new Date(1_700_000_000_000 + index),
      actor: { id: 'member-a' },
    }));
    // Prisma returns the newest initial page in DESC order: 100 down to 1.
    prisma.teamActivity.findMany.mockResolvedValueOnce(rows.slice(1).reverse());
    const initial = await service.getActivity('team-1', 'member-a');
    expect(initial.items).toHaveLength(100);
    expect(initial.items[0].id).toBe('activity-001');
    expect(initial.items.at(-1)?.id).toBe('activity-100');
    expect(initial.items.some((item: any) => item.id === 'activity-000')).toBe(false);
    expect(prisma.teamActivity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
    }));

    prisma.teamActivity.findMany.mockResolvedValueOnce(rows);
    const delta = await service.getActivity('team-1', 'member-a', 'activity-1');
    expect(delta.items).toHaveLength(100);
    expect(delta.nextCursor).toBe('activity-099');
    expect(prisma.teamActivity.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 101,
    }));
  });

  it('records actor-attributed task lifecycle activity alongside task status events', async () => {
    await service.createTask('team-1', { title: 'Build feature' }, 'member-a');
    prisma.task.findUnique.mockReset()
      .mockResolvedValueOnce({ id: 'task-3', teamId: 'team-1', status: 'todo', startedAt: null, team: { hackathonId: 'hack-1' } })
      .mockResolvedValueOnce({ id: 'task-3', teamId: 'team-1' });
    await service.updateTask('task-3', { status: 'done' }, 'member-b', 'team-1');
    await service.deleteTask('task-3', 'member-a', 'team-1');

    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'task:created', expect.objectContaining({ id: 'task-3' }));
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'task:updated', expect.objectContaining({ status: 'done' }));
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'task:deleted', { id: 'task-3' });
    expect(prisma.teamActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'member-a', action: 'task.created' }) }));
    expect(prisma.teamActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'member-b', action: 'task.updated' }) }));
    expect(prisma.teamActivity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'member-a', action: 'task.deleted' }) }));
  });

  it('does not turn a committed mutation into an ambiguous failure when activity persistence is unavailable', async () => {
    prisma.teamActivity.create.mockRejectedValueOnce(new Error('activity storage unavailable'));
    await expect(service.createArea('team-1', { name: 'Build', color: '#fff' } as any, 'member-a'))
      .resolves.toEqual(expect.objectContaining({ id: 'area-1' }));
    expect(prisma.area.create).toHaveBeenCalledTimes(1);
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'area:created', expect.anything());
    expect(events.emitToTeam).not.toHaveBeenCalledWith('team-1', 'planning:activity', expect.anything());
  });
});
