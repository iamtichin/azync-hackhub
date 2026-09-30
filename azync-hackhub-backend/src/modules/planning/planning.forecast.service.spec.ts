import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { PlanningService } from './planning.service';

const events = { emitToTeam: jest.fn() };
const hackathons = { emitLeaderboardUpdate: jest.fn() };
const rows = [{
  id: 'open', status: 'todo', estimatedHours: 4, actualHours: 0,
  createdAt: new Date('2026-09-01T00:00:00.000Z'), startedAt: null, completedAt: null,
  dependencies: [], area: { name: 'Delivery' },
}];

describe('PlanningService forecast endpoint contract', () => {
  it('requires membership before reading forecast data', async () => {
    const prisma = { teamMember: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    const service = new PlanningService(prisma, events as any, hackathons as any);
    await expect(service.getForecast('team', 'outsider')).rejects.toBeInstanceOf(ForbiddenException);
    expect((prisma as any).task).toBeUndefined();
  });

  it('queries only the requested team and its hackathon deadline', async () => {
    const prisma = {
      teamMember: { findUnique: jest.fn().mockResolvedValue({ id: 'membership' }) },
      task: { findMany: jest.fn().mockResolvedValue(rows), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      team: { findUnique: jest.fn().mockResolvedValue({ hackathonId: 'hackathon' }) },
      hackathon: { findUnique: jest.fn().mockResolvedValue({ endDate: new Date('2026-10-01T00:00:00.000Z') }) },
    } as unknown as PrismaService;
    const service = new PlanningService(prisma, events as any, hackathons as any);
    const result = await service.getForecast('team', 'member');
    expect(result.status).toBe('not_started');
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teamId: 'team' } }));
    expect(prisma.team.findUnique).toHaveBeenCalledWith({ where: { id: 'team' }, select: { hackathonId: true } });
    expect(prisma.hackathon.findUnique).toHaveBeenCalledWith({ where: { id: 'hackathon' }, select: { endDate: true } });
  });
});
