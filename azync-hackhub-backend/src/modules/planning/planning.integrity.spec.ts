import { BadRequestException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { PlanningService } from './planning.service';
import { CreateTaskDto, UpdateTaskDto, CreateAreaDto, UpdateAreaDto } from './dto/planning.dto';

describe('Planning input integrity', () => {
  let prisma: any;
  let service: PlanningService;
  beforeEach(() => {
    prisma = {
      teamMember: { findUnique: jest.fn().mockResolvedValue({ id: 'member' }) },
      area: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ id: 'area', teamId: 'team' }),
        create: jest.fn(), update: jest.fn(), delete: jest.fn(),
      },
      task: {
        findUnique: jest.fn().mockResolvedValue({ id: 'task', teamId: 'team', status: 'done', startedAt: new Date('2026-09-01'), team: { hackathonId: 'hackathon' }, dependencies: [] }),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        update: jest.fn().mockResolvedValue({ id: 'task' }), delete: jest.fn(),
      },
      taskDependency: {
        findUnique: jest.fn().mockResolvedValue({ task: { teamId: 'team' } }),
        create: jest.fn(), delete: jest.fn(),
      },
    };
    service = new PlanningService(prisma, { emitToTeam: jest.fn() } as any, { emitLeaderboardUpdate: jest.fn() } as any);
  });

  it.each([CreateTaskDto, UpdateTaskDto, CreateAreaDto, UpdateAreaDto])('rejects negative estimate in %p DTO', async (Dto) => {
    const errors = await validate(Object.assign(new Dto(), { title: 'Task', name: 'Area', color: '#fff', estimatedHours: -1 }));
    expect(errors.some((error) => error.property === 'estimatedHours')).toBe(true);
  });

  it.each([-1, NaN, Infinity, null])('rejects invalid hours %p before mutation', async (value) => {
    await expect(service.updateTask('task', { actualHours: value } as any, 'member', 'team')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('rejects cross-team area on create and update', async () => {
    await expect(service.createTask('team', { title: 'Task', areaId: 'foreign' }, 'member')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateTask('task', { areaId: 'foreign' }, 'member', 'team')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('rejects non-member assignee for create and update', async () => {
    prisma.teamMember.findUnique.mockImplementation(({ where }: any) => Promise.resolve(where.teamId_userId.userId === 'member' ? { id: 'member' } : null));
    await expect(service.createTask('team', { title: 'Task', assigneeId: 'outsider' }, 'member')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateTask('task', { assigneeId: 'outsider' }, 'member', 'team')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.task.update).not.toHaveBeenCalled();
  });

  it('allows clearing optional references and zero hours', async () => {
    await service.updateTask('task', { assigneeId: null, areaId: null, actualHours: 0 } as any, 'member', 'team');
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: { assigneeId: null, areaId: null, actualHours: 0 } }));
  });

  it('rejects mismatched route team for every nested mutation', async () => {
    const operations = [
      () => service.updateArea('area', {}, 'member', 'foreign'),
      () => service.deleteArea('area', 'member', 'foreign'),
      () => service.updateTask('task', {}, 'member', 'foreign'),
      () => service.deleteTask('task', 'member', 'foreign'),
      () => service.addDependency('task', { dependsOnId: 'other' }, 'member', 'foreign'),
      () => service.removeDependency('task', 'other', 'member', 'foreign'),
    ];
    for (const operation of operations) await expect(operation()).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.task.update).not.toHaveBeenCalled();
    expect(prisma.task.delete).not.toHaveBeenCalled();
    expect(prisma.area.update).not.toHaveBeenCalled();
    expect(prisma.area.delete).not.toHaveBeenCalled();
    expect(prisma.taskDependency.create).not.toHaveBeenCalled();
    expect(prisma.taskDependency.delete).not.toHaveBeenCalled();
  });

  it('clears completion on reopen without resetting original start time', async () => {
    await service.updateTask('task', { status: 'in_progress' }, 'member', 'team');
    expect(prisma.task.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'in_progress', completedAt: null } }));
  });

  it.each(['in_progress', 'done'] as const)(
    'rejects moving a task to %s while a dependency is unfinished',
    async (status) => {
      prisma.task.findUnique.mockResolvedValue({
        id: 'task',
        teamId: 'team',
        status: 'todo',
        startedAt: null,
        team: { hackathonId: 'hackathon' },
        dependencies: [
          { dependsOn: { title: 'Required task', status: 'in_progress' } },
        ],
      });

      await expect(
        service.updateTask('task', { status }, 'member', 'team'),
      ).rejects.toThrow('Required task');
      expect(prisma.task.update).not.toHaveBeenCalled();
    },
  );
});
