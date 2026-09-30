import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HackathonsService } from './hackathons.service';

describe('HackathonsService tracks and publication boundaries', () => {
  const prisma: any = {
    hackathon: { findUnique: jest.fn(), findMany: jest.fn() },
    team: { findUnique: jest.fn() }, hackathonRegistration: { findUnique: jest.fn(), create: jest.fn() },
    track: { findFirst: jest.fn(), update: jest.fn() }, submission: { count: jest.fn() },
  };
  const service = new HackathonsService(prisma, {} as any, {} as any);
  beforeEach(() => jest.clearAllMocks());

  it('keeps legacy no-track registration compatible', async () => {
    prisma.hackathon.findUnique.mockResolvedValue({ id: 'event', endDate: new Date(Date.now() + 60_000) });
    prisma.team.findUnique.mockResolvedValue({ id: 'team', hackathonId: 'event', members: [{ userId: 'user' }] });
    prisma.hackathonRegistration.findUnique.mockResolvedValue(null); prisma.hackathonRegistration.create.mockResolvedValue({ id: 'registration' });
    jest.spyOn(service, 'emitLeaderboardUpdate').mockResolvedValue();
    await expect(service.registerTeam('event', { teamId: 'team' }, 'user')).resolves.toEqual({ id: 'registration' });
    expect(prisma.track.findFirst).not.toHaveBeenCalled();
  });

  it.each(['inactive-track', 'track-from-another-event'])('rejects inactive or cross-event tracks during registration (%s)', async (trackId) => {
    prisma.hackathon.findUnique.mockResolvedValue({ id: 'event', endDate: new Date(Date.now() + 60_000) });
    prisma.team.findUnique.mockResolvedValue({ id: 'team', hackathonId: 'event', members: [{ userId: 'user' }] });
    prisma.track.findFirst.mockResolvedValue(null);
    await expect(service.registerTeam('event', { teamId: 'team', trackId }, 'user')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.track.findFirst).toHaveBeenCalledWith({ where: { id: trackId, hackathonId: 'event', isActive: true } });
  });

  it('hides a known unpublished event from public detail and leaderboard', async () => {
    prisma.hackathon.findUnique.mockResolvedValue({ id: 'draft', isPublished: false, name: 'draft' });
    await expect(service.findOne('draft')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getLeaderboard('draft')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('denies the track list for a known unpublished event', async () => {
    prisma.hackathon.findUnique.mockResolvedValue({ id: 'draft', isPublished: false });
    await expect(service.listTracks('draft')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.track.findMany).toBeUndefined();
  });

  it('excludes drafts from public lists but keeps them available to their organizer', async () => {
    prisma.hackathon.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'draft', organizerId: 'owner', isPublished: false, tracks: [] }]);

    await expect(service.findAll()).resolves.toEqual([]);
    await expect(service.findOwned('owner')).resolves.toEqual([expect.objectContaining({ id: 'draft', isPublished: false })]);
    expect(prisma.hackathon.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ isPublished: true }) }));
    expect(prisma.hackathon.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { organizerId: 'owner' } }));
  });

  it('does not mutate a track configuration after a submission exists', async () => {
    prisma.hackathon.findUnique.mockResolvedValue({ organizerId: 'owner' });
    prisma.track.findFirst.mockResolvedValue({ id: 'track', hackathonId: 'event' });
    prisma.submission.count.mockResolvedValue(1);
    await expect(service.updateTrack('event', 'track', { name: 'Changed' }, 'owner')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still permits deactivating a track after a submission exists', async () => {
    prisma.hackathon.findUnique.mockResolvedValue({ organizerId: 'owner' });
    prisma.track.findFirst.mockResolvedValue({ id: 'track', hackathonId: 'event' });
    prisma.track.update.mockResolvedValue({ id: 'track', isActive: false });
    await expect(service.updateTrack('event', 'track', { isActive: false }, 'owner')).resolves.toEqual({ id: 'track', isActive: false });
    expect(prisma.submission.count).not.toHaveBeenCalled();
  });
});
