import type { PrismaService } from '../../prisma/prisma.service';
import { AzyncBotDataService } from './azync-bot-tools';

describe('AzyncBotDataService', () => {
  it('lists only open hackathons with a minimal DTO', async () => {
    const prisma = {
      hackathon: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'hack-1',
            name: 'Open Hack',
            startDate: new Date('2026-09-10T00:00:00Z'),
            endDate: new Date('2026-09-20T00:00:00Z'),
            rulesVersion: 'rules-v2',
            rubricVersion: 'rubric-v3',
            _count: { registrations: 4, submissions: 2 },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new AzyncBotDataService(prisma);

    const result = await service.execute('user-1', {
      tool: 'LIST_OPEN_HACKATHONS',
      hackathonQuery: null,
    });

    expect(prisma.hackathon.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { endDate: { gte: expect.any(Date) } },
        take: 20,
      }),
    );
    expect(result).toMatchObject({
      tool: 'LIST_OPEN_HACKATHONS',
      hackathons: [{ name: 'Open Hack', registeredTeams: 4, submissions: 2 }],
    });
  });

  it('resolves a public hackathon summary by name and caps criteria', async () => {
    const rules = Array.from({ length: 35 }, (_, index) => ({
      id: `rule-${index}`,
    }));
    const prisma = {
      hackathon: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'hack-1',
          name: 'UniHackFest',
          startDate: new Date('2026-09-10T00:00:00Z'),
          endDate: new Date('2026-09-20T00:00:00Z'),
          rules,
          rubric: [],
          rulesVersion: 'rules-v1',
          rubricVersion: 'rubric-v1',
          _count: { registrations: 3, submissions: 1 },
        }),
      },
    } as unknown as PrismaService;
    const service = new AzyncBotDataService(prisma);

    const result = (await service.execute('user-1', {
      tool: 'GET_HACKATHON_SUMMARY',
      hackathonQuery: 'UniHackFest',
    })) as { hackathon: { rules: unknown[]; registeredTeams: number } };

    expect(prisma.hackathon.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { id: 'UniHackFest' },
            { name: { contains: 'UniHackFest', mode: 'insensitive' } },
          ],
        },
      }),
    );
    expect(result.hackathon.rules).toHaveLength(30);
    expect(result.hackathon.registeredTeams).toBe(3);
  });

  it('scopes team data to the authenticated user membership', async () => {
    const prisma = {
      teamMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            role: 'admin',
            joinedAt: new Date('2026-09-01T00:00:00Z'),
            team: {
              id: 'team-1',
              name: 'Builders',
              hackathonId: 'hack-1',
              repository: null,
              _count: { submissions: 1, tasks: 5 },
            },
          },
        ]),
      },
      hackathon: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'hack-1',
            name: 'Open Hack',
            startDate: new Date('2026-09-10T00:00:00Z'),
            endDate: new Date('2026-09-20T00:00:00Z'),
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new AzyncBotDataService(prisma);

    const result = await service.execute('user-secret-scope', {
      tool: 'LIST_MY_TEAMS',
      hackathonQuery: null,
    });

    expect(prisma.teamMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-secret-scope' } }),
    );
    expect(result).toMatchObject({
      tool: 'LIST_MY_TEAMS',
      teams: [
        {
          id: 'team-1',
          role: 'admin',
          hackathon: { id: 'hack-1', name: 'Open Hack' },
          submissions: 1,
          tasks: 5,
        },
      ],
    });
  });

  it('scopes submissions to user teams and derives a compact AI status', async () => {
    const prisma = {
      submission: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'submission-1',
            projectName: 'Proof App',
            status: 'confirmed',
            createdAt: new Date('2026-09-12T00:00:00Z'),
            aiAnalysisCompleted: false,
            team: { id: 'team-1', name: 'Builders' },
            hackathon: { id: 'hack-1', name: 'Open Hack' },
            solanaTransaction: {
              status: 'confirmed',
              network: 'devnet',
              confirmedAt: new Date('2026-09-12T00:01:00Z'),
            },
            aiJobs: [{ status: 'PROCESSING' }],
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new AzyncBotDataService(prisma);

    const result = await service.execute('user-secret-scope', {
      tool: 'LIST_MY_SUBMISSIONS',
      hackathonQuery: null,
    });

    expect(prisma.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          team: { members: { some: { userId: 'user-secret-scope' } } },
        },
      }),
    );
    expect(result).toMatchObject({
      tool: 'LIST_MY_SUBMISSIONS',
      submissions: [{ id: 'submission-1', aiStatus: 'processing' }],
    });
  });
});
