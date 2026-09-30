import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PlanningService } from './planning.service';

describe('PlanningService atomic templates and dependencies', () => {
  let prisma: any;
  let tx: any;
  let events: { emitToTeam: jest.Mock };
  let service: PlanningService;

  beforeEach(() => {
    let areaSequence = 0;
    let taskSequence = 0;
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      area: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(() =>
          Promise.resolve({ id: `area-${++areaSequence}` }),
        ),
        findMany: jest.fn().mockResolvedValue([{ id: 'area-1' }]),
      },
      task: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(() =>
          Promise.resolve({ id: `task-${++taskSequence}` }),
        ),
        findMany: jest.fn().mockResolvedValue([{ id: 'task-1' }]),
      },
      taskDependency: {
        create: jest.fn().mockResolvedValue({ id: 'dependency' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma = {
      teamMember: { findUnique: jest.fn().mockResolvedValue({ id: 'member' }) },
      task: { findUnique: jest.fn(), updateMany: jest.fn() },
      taskDependency: { findMany: jest.fn() },
      teamActivity: { create: jest.fn().mockResolvedValue({ id: 'activity', actor: { id: 'member' } }) },
      $transaction: jest.fn().mockImplementation(async (work: (client: any) => unknown) => work(tx)),
    };
    events = { emitToTeam: jest.fn().mockResolvedValue(undefined) };
    service = new PlanningService(prisma, events as any, {} as any);
  });

  it('creates the full template in one serializable transaction and emits after commit', async () => {
    await expect(service.applyTemplate('team', 'web3', 'member')).resolves.toEqual({
      areas: [{ id: 'area-1' }],
      tasks: [{ id: 'task-1' }],
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.area.create).toHaveBeenCalledTimes(3);
    expect(tx.task.create).toHaveBeenCalledTimes(3);
    expect(tx.taskDependency.create).toHaveBeenCalledTimes(2);
    expect(events.emitToTeam).toHaveBeenCalledWith(
      'team',
      'planning:template-applied',
      expect.objectContaining({ templateId: 'web3' }),
    );
    expect(prisma.teamActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actorId: 'member', action: 'planning.template_applied', subjectId: 'web3' }),
    }));
  });

  it('rejects a nonempty canvas before creating any template rows', async () => {
    tx.task.count.mockResolvedValue(1);
    await expect(
      service.applyTemplate('team', 'web3', 'member'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.area.create).not.toHaveBeenCalled();
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(events.emitToTeam).not.toHaveBeenCalled();
  });

  it('does not emit when a transaction mutation fails', async () => {
    tx.task.create.mockRejectedValueOnce(new Error('database write failed'));
    await expect(
      service.applyTemplate('team', 'ai', 'member'),
    ).rejects.toThrow('database write failed');
    expect(events.emitToTeam).not.toHaveBeenCalled();
  });

  it('serializes dependency cycle-check and insertion by team', async () => {
    prisma.task.findUnique
      .mockResolvedValueOnce({ id: 'task', teamId: 'team' })
      .mockResolvedValueOnce({ id: 'dependency', teamId: 'team' });
    await service.addDependency(
      'task',
      { dependsOnId: 'dependency' },
      'member',
      'team',
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.taskDependency.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a self-cycle inside the lock without inserting it', async () => {
    prisma.task.findUnique.mockResolvedValue({ id: 'task', teamId: 'team' });
    await expect(
      service.addDependency(
        'task',
        { dependsOnId: 'task' },
        'member',
        'team',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.taskDependency.create).not.toHaveBeenCalled();
  });

  it('clears stale critical-path flags when every task is complete', async () => {
    prisma.task.findMany = jest.fn().mockResolvedValue([]);
    prisma.task.updateMany.mockResolvedValue({ count: 2 });
    await expect(
      service.calculateCriticalPath('team', 'member'),
    ).resolves.toEqual({ criticalPath: [], totalHours: 0, tasks: [] });
    expect(prisma.task.updateMany).toHaveBeenCalledWith({
      where: { teamId: 'team', isCriticalPath: true },
      data: { isCriticalPath: false },
    });
  });

  it.each([
    ['member-2', 'member-2'],
    ['unassigned', null],
  ])('filters task reads by assignee selector %s', async (selector, expected) => {
    prisma.task.findMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.task.updateMany.mockResolvedValue({ count: 0 });

    await service.getTasks('team', 'member', undefined, undefined, selector);

    expect(prisma.task.findMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: { teamId: 'team', assigneeId: expected },
        include: expect.objectContaining({
          assignee: {
            select: {
              id: true,
              name: true,
              githubUsername: true,
              avatarUrl: true,
            },
          },
        }),
      }),
    );
  });
});
