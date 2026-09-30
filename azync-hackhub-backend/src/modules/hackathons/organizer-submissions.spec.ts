import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HackathonsService } from './hackathons.service';

describe('Organizer submission list and CSV', () => {
  const prisma: any = {
    submission: { findFirst: jest.fn(), findMany: jest.fn() },
    track: { findFirst: jest.fn() },
    winnerAward: { findUnique: jest.fn() },
  };
  const access: any = { requireHackathonOrganizer: jest.fn() };
  const service = new HackathonsService(prisma, {} as any, access, {} as any);
  const row = (id: string, projectName = 'Project') => ({
    id,
    projectName,
    createdAt: new Date('2026-01-01'),
    receivedStatus: 'RECEIVED',
    aiStatus: 'QUEUED',
    mintStatus: 'CONFIRMED',
    status: 'confirmed',
    team: { id: 'team', name: 'Team' },
    track: null,
  });
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.winnerAward.findUnique.mockResolvedValue(null);
  });

  it('enforces organizer ownership before querying rows', async () => {
    access.requireHackathonOrganizer.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.listOrganizerSubmissions('event', 'outsider', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.submission.findMany).not.toHaveBeenCalled();
  });

  it('uses exact filter scope for a cursor and rejects stale/cross-filter cursors', async () => {
    access.requireHackathonOrganizer.mockResolvedValue(undefined);
    prisma.track.findFirst.mockResolvedValue({ id: 'track' });
    prisma.submission.findFirst.mockResolvedValue(null);
    await expect(
      service.listOrganizerSubmissions('event', 'owner', {
        cursor: 'cursor',
        trackId: 'track',
        status: 'confirmed',
        search: 'team',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.submission.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'cursor',
          hackathonId: 'event',
          trackId: 'track',
          status: 'confirmed',
        }),
      }),
    );
  });

  it('rejects unknown status and cross-event track filters before reading submissions', async () => {
    access.requireHackathonOrganizer.mockResolvedValue(undefined);
    await expect(
      service.listOrganizerSubmissions('event', 'owner', { status: 'made-up' }),
    ).rejects.toThrow('Invalid submission status filter');
    prisma.track.findFirst.mockResolvedValue(null);
    await expect(
      service.exportOrganizerSubmissionsCsv('event', 'owner', {
        trackId: 'other-event-track',
      }),
    ).rejects.toThrow('Invalid submission track filter');
    expect(prisma.submission.findMany).not.toHaveBeenCalled();
  });

  it('pages over more than 100 rows without truncating the next cursor', async () => {
    access.requireHackathonOrganizer.mockResolvedValue(undefined);
    prisma.submission.findMany.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => row(`s${index}`)),
    );
    const result = await service.listOrganizerSubmissions('event', 'owner', {
      limit: 100,
    });
    expect(result.items).toHaveLength(100);
    expect(result.nextCursor).toBe('s99');
  });

  it('marks the selected submission and exposes the winner certificate separately', async () => {
    access.requireHackathonOrganizer.mockResolvedValue(undefined);
    prisma.submission.findMany.mockResolvedValue([row('s1'), row('s2')]);
    prisma.winnerAward.findUnique.mockResolvedValue({
      id: 'award',
      hackathonId: 'event',
      submissionId: 's2',
      status: 'confirmed',
      selectedAt: new Date('2026-01-03'),
      recipientAddress: 'recipient',
      network: 'devnet',
      signature: 'winner-tx',
      nftAssetId: 'winner-asset',
      leafIndex: 8n,
      submission: {
        projectName: 'Project',
        team: { id: 'team', name: 'Team' },
      },
    });
    const result = await service.listOrganizerSubmissions('event', 'owner', {});
    expect(result.items).toEqual([
      expect.objectContaining({ id: 's1', isWinner: false }),
      expect.objectContaining({ id: 's2', isWinner: true }),
    ]);
    expect(result.winner).toEqual(
      expect.objectContaining({ id: 'award', leafIndex: '8' }),
    );
  });

  it('exports quoted allowlisted values, neutralizes control-whitespace formulas, and refuses >500 rows', async () => {
    access.requireHackathonOrganizer.mockResolvedValue(undefined);
    prisma.submission.findMany.mockResolvedValueOnce([
      row('s1', '\t=SUM(1,1)'),
    ]);
    const csv = await service.exportOrganizerSubmissionsCsv(
      'event',
      'owner',
      {},
    );
    expect(csv).toContain("'\t=SUM(1,1)");
    expect(csv).not.toContain('githubUrl');
    expect(csv).toContain(
      'team,project,track,submittedAt,receivedStatus,aiStatus,solanaStatus',
    );
    prisma.submission.findMany.mockResolvedValueOnce(
      Array.from({ length: 501 }, (_, index) => row(`s${index}`)),
    );
    await expect(
      service.exportOrganizerSubmissionsCsv('event', 'owner', {}),
    ).rejects.toThrow('limited to 500');
  });
});
