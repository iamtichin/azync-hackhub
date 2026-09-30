import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { PlanningService } from './planning.service';

// Mock dependencies
const mockEventsGateway = {
  emitToTeam: jest.fn(),
  emitToHackathon: jest.fn(),
};

const mockHackathonsService = {
  emitLeaderboardUpdate: jest.fn(),
};

describe('PlanningService reads and critical path', () => {
  const tasks = [
    {
      id: 't1',
      title: 'Schema',
      description: null,
      estimatedHours: 4,
      actualHours: 0,
      status: 'todo',
      areaId: 'a1',
      area: { name: 'Backend' },
      dependencies: [],
    },
    {
      id: 't2',
      title: 'Auth',
      description: null,
      estimatedHours: 6,
      actualHours: 0,
      status: 'todo',
      areaId: 'a1',
      area: { name: 'Backend' },
      dependencies: [],
    },
    {
      id: 't3',
      title: 'CRUD',
      description: null,
      estimatedHours: 5,
      actualHours: 0,
      status: 'todo',
      areaId: 'a1',
      area: { name: 'Backend' },
      dependencies: [{ dependsOnId: 't1' }],
    },
    {
      id: 't4',
      title: 'Tests',
      description: null,
      estimatedHours: 3,
      actualHours: 0,
      status: 'todo',
      areaId: 'a1',
      area: { name: 'Backend' },
      dependencies: [{ dependsOnId: 't2' }, { dependsOnId: 't3' }],
    },
  ];

  it('rejects a non-member before reading planning data', async () => {
    const prisma = {
      teamMember: { findUnique: jest.fn().mockResolvedValue(null) },
      area: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const service = new PlanningService(prisma, mockEventsGateway as any, mockHackathonsService as any);
    await expect(service.getAreas('team', 'outsider')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.area.findMany).not.toHaveBeenCalled();
  });

  it('returns the complete mathematical longest path contract', async () => {
    const prisma = {
      teamMember: { findUnique: jest.fn().mockResolvedValue({ id: 'member' }) },
      task: {
        findMany: jest.fn().mockResolvedValue(tasks),
        updateMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
    } as unknown as PrismaService;
    const service = new PlanningService(prisma, mockEventsGateway as any, mockHackathonsService as any);
    await expect(
      service.calculateCriticalPath('team', 'member'),
    ).resolves.toMatchObject({
      criticalPath: ['t1', 't3', 't4'],
      totalHours: 12,
      tasks: [
        { id: 't1', areaName: 'Backend', dependencies: [] },
        { id: 't3', dependencies: ['t1'] },
        { id: 't4', dependencies: ['t2', 't3'] },
      ],
    });
  });

  it('invalidates leaderboard data when a task is created', async () => {
    const prisma = {
      teamMember: { findUnique: jest.fn().mockResolvedValue({ id: 'member' }) },
      task: { create: jest.fn().mockResolvedValue({ id: 'task', teamId: 'team' }) },
      team: { findUnique: jest.fn().mockResolvedValue({ hackathonId: 'hack' }) },
    } as unknown as PrismaService;
    const service = new PlanningService(
      prisma,
      mockEventsGateway as any,
      mockHackathonsService as any,
    );

    await service.createTask('team', { title: 'Task' }, 'member');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockHackathonsService.emitLeaderboardUpdate).toHaveBeenCalledWith('hack');
  });
});
