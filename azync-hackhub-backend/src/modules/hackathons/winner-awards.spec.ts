import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { HackathonsService } from './hackathons.service';

describe('Organizer winner decision', () => {
  const winnerAward = {
    findUnique: jest.fn(),
    create: jest.fn(),
  };
  const prisma: any = {
    hackathon: { findUnique: jest.fn() },
    submission: { findFirst: jest.fn() },
    winnerAward,
  };
  const events = { emitToHackathon: jest.fn(), emitToTeam: jest.fn() };
  const access = { requireHackathonOrganizer: jest.fn() };
  const solana = {
    mintWinnerCredential: jest.fn(),
    getExplorerUrl: jest.fn((signature) => `https://explorer/${signature}`),
  };
  const service = new HackathonsService(
    prisma,
    events as any,
    access as any,
    {} as any,
    solana as any,
  );
  const submission = {
    id: 'submission',
    hackathonId: 'event',
    projectName: 'Project',
    walletAddress: 'recipient',
    finalizedAt: new Date('2026-01-02'),
    finalSnapshot: { schemaVersion: 1 },
    team: { id: 'team', name: 'Team' },
  };
  const selected = {
    id: 'award',
    hackathonId: 'event',
    submissionId: 'submission',
    selectedById: 'owner',
    recipientAddress: 'recipient',
    decisionSnapshot: {},
    status: 'selected',
    selectedAt: new Date(),
    network: 'devnet',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    access.requireHackathonOrganizer.mockResolvedValue(undefined);
    prisma.hackathon.findUnique.mockResolvedValue({
      id: 'event',
      name: 'Event',
      endDate: new Date('2026-01-01'),
    });
    prisma.submission.findFirst.mockResolvedValue(submission);
    winnerAward.findUnique.mockResolvedValue(null);
    winnerAward.create.mockResolvedValue(selected);
  });

  it('checks organizer access before reading the event or submission', async () => {
    access.requireHackathonOrganizer.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(
      service.selectWinner('event', 'submission', 'outsider'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.hackathon.findUnique).not.toHaveBeenCalled();
  });

  it('allows selection only after the deadline and only for a final submission in scope', async () => {
    prisma.hackathon.findUnique.mockResolvedValueOnce({
      id: 'event',
      name: 'Event',
      endDate: new Date('2999-01-01'),
    });
    await expect(
      service.selectWinner('event', 'submission', 'owner'),
    ).rejects.toThrow('only after the hackathon deadline');
    expect(winnerAward.create).not.toHaveBeenCalled();

    prisma.submission.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.selectWinner('event', 'other-event-submission', 'owner'),
    ).rejects.toThrow('final submission from this hackathon');
  });

  it('persists the human decision before minting and returns a confirmed winner certificate', async () => {
    const confirmed = {
      ...selected,
      status: 'confirmed',
      signature: 'winner-tx',
      nftAssetId: 'winner-asset',
      credentialHash: 'hash',
      leafIndex: 4n,
      submission: { projectName: 'Project', team: submission.team },
    };
    winnerAward.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(confirmed);
    solana.mintWinnerCredential.mockResolvedValue({
      signature: 'winner-tx',
      assetId: 'winner-asset',
    });

    await expect(
      service.selectWinner('event', 'submission', 'owner'),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'confirmed',
        signature: 'winner-tx',
        leafIndex: '4',
      }),
    );
    expect(winnerAward.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          hackathonId: 'event',
          submissionId: 'submission',
          recipientAddress: 'recipient',
          decisionSnapshot: expect.objectContaining({
            awardType: 'HACKATHON_WINNER',
            awardVersion: 1,
          }),
        }),
      }),
    );
    expect(winnerAward.create.mock.invocationCallOrder[0]).toBeLessThan(
      solana.mintWinnerCredential.mock.invocationCallOrder[0],
    );
  });

  it('keeps the selected winner when mint fails and refuses a different replacement', async () => {
    const failed = {
      ...selected,
      status: 'failed',
      errorMessage: 'rpc unavailable',
    };
    winnerAward.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failed);
    solana.mintWinnerCredential.mockRejectedValueOnce(
      new Error('rpc unavailable'),
    );
    await expect(
      service.selectWinner('event', 'submission', 'owner'),
    ).resolves.toEqual(
      expect.objectContaining({
        submissionId: 'submission',
        status: 'failed',
        mintError: 'rpc unavailable',
      }),
    );

    winnerAward.findUnique
      .mockReset()
      .mockResolvedValue({ ...selected, submissionId: 'other' });
    await expect(
      service.selectWinner('event', 'submission', 'owner'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(winnerAward.create).toHaveBeenCalledTimes(1);
  });
});
