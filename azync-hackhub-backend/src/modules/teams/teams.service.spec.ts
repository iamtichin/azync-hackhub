import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TeamsService } from './teams.service';

describe('TeamsService private detail and roster', () => {
  const prisma = {
    team: { findUnique: jest.fn(), delete: jest.fn() },
    teamInvite: { create: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    teamMember: { findUnique: jest.fn(), create: jest.fn(), count: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
  } as any;
  const access = { requireTeamMember: jest.fn() };
  const github = { syncTeamCollaborators: jest.fn().mockResolvedValue({ status: 'not_configured' }) };
  const events = { emitToTeam: jest.fn() };
  const service = new TeamsService(prisma, events as any, access as any, github as any);

  beforeEach(() => jest.clearAllMocks());

  it.each(['findOne', 'getMembers'] as const)('denies an outsider from team %s before reading roster', async (method) => {
    access.requireTeamMember.mockRejectedValue(new ForbiddenException());
    await expect((service as any)[method]('team', 'outsider')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });

  it('creates an expiring invite only for a team admin', async () => {
    (service as any).checkAdminPermission = jest.fn().mockResolvedValue(undefined);
    prisma.teamInvite.create.mockResolvedValue({ id: 'invite-1', code: 'x'.repeat(32), expiresAt: new Date(), createdAt: new Date() });

    const invite = await service.createInvite('team-1', { expiresInHours: 2 }, 'admin-1');

    expect(invite.joinPath).toContain(invite.code);
    expect(prisma.teamInvite.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ teamId: 'team-1', createdById: 'admin-1' }),
    }));
  });

  it('lists only active invites after enforcing admin access', async () => {
    (service as any).checkAdminPermission = jest.fn().mockResolvedValue(undefined);
    prisma.teamInvite.findMany.mockResolvedValue([{ id: 'invite-1', code: 'x'.repeat(32) }]);
    await expect(service.listInvites('team-1', 'admin-1')).resolves.toEqual([{ id: 'invite-1', code: 'x'.repeat(32) }]);
    expect(prisma.teamInvite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: 'team-1', usedAt: null, revokedAt: null }),
    }));
  });

  it('claims a one-time invite atomically and requires explicit registration afterward', async () => {
    const tx = {
      teamInvite: {
        findUnique: jest.fn().mockResolvedValue({ id: 'invite-1', teamId: 'team-1', expiresAt: new Date(Date.now() + 60_000), usedAt: null, revokedAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      teamMember: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'member-1', userId: 'new-user', role: 'member' }),
      },
    };
    prisma.$transaction.mockImplementation((work: any) => work(tx));

    await expect(service.joinInvite('x'.repeat(32), 'new-user')).resolves.toEqual(expect.objectContaining({
      teamId: 'team-1', registrationRequired: true,
    }));
    expect(tx.teamInvite.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ usedAt: null, revokedAt: null }),
      data: expect.objectContaining({ usedById: 'new-user' }),
    }));
  });

  it.each([
    [{ revokedAt: new Date(), usedAt: null }, 'revoked'],
    [{ revokedAt: null, usedAt: new Date() }, 'already used'],
    [{ revokedAt: null, usedAt: null, expiresAt: new Date(Date.now() - 1) }, 'expired'],
  ])('rejects %s invite replay states', async (state) => {
    const tx = { teamInvite: { findUnique: jest.fn().mockResolvedValue({ id: 'invite-1', teamId: 'team-1', expiresAt: new Date(Date.now() + 60_000), ...state }) } };
    prisma.$transaction.mockImplementation((work: any) => work(tx));
    await expect(service.joinInvite('x'.repeat(32), 'new-user')).rejects.toMatchObject({ message: expect.stringMatching(/expired|revoked|already used/) });
  });

  it('rejects a concurrent second redemption after its conditional claim loses', async () => {
    const tx = {
      teamInvite: {
        findUnique: jest.fn().mockResolvedValue({ id: 'invite-1', teamId: 'team-1', expiresAt: new Date(Date.now() + 60_000), usedAt: null, revokedAt: null }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      teamMember: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    prisma.$transaction.mockImplementation((work: any) => work(tx));
    await expect(service.joinInvite('x'.repeat(32), 'other-user')).rejects.toMatchObject({ message: expect.stringContaining('already used') });
  });

  it('serializes self-removal and retains the last-admin guard', async () => {
    const tx = { teamMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'admin' }),
      count: jest.fn().mockResolvedValue(1), delete: jest.fn(),
    } };
    prisma.$transaction.mockImplementation((work: any) => work(tx));
    await expect(service.removeMember('team-1', 'admin-1', 'admin-1'))
      .rejects.toMatchObject({ message: 'Cannot remove the last admin' });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });

  it('allows an admin to remove another member, but lets a member leave without admin access', async () => {
    const tx = { teamMember: {
      findUnique: jest.fn().mockResolvedValue({ role: 'member' }),
      delete: jest.fn().mockResolvedValue({ userId: 'member-2' }),
    } };
    prisma.$transaction.mockImplementation((work: any) => work(tx));
    (service as any).checkAdminPermission = jest.fn().mockResolvedValue(undefined);

    await expect(service.removeMember('team-1', 'member-2', 'admin-1')).resolves.toEqual({ userId: 'member-2' });
    expect((service as any).checkAdminPermission).toHaveBeenCalledWith('team-1', 'admin-1');

    (service as any).checkAdminPermission.mockClear();
    await expect(service.removeMember('team-1', 'member-2', 'member-2')).resolves.toEqual({ userId: 'member-2' });
    expect((service as any).checkAdminPermission).not.toHaveBeenCalled();
  });

  it('keeps a successful membership change when collaborator sync fails', async () => {
    (service as any).checkAdminPermission = jest.fn().mockResolvedValue(undefined);
    prisma.user = { findUnique: jest.fn().mockResolvedValue({ id: 'new-user' }) };
    prisma.teamMember.findUnique.mockResolvedValue(null);
    prisma.teamMember.create.mockResolvedValue({ id: 'member-1', userId: 'new-user' });
    github.syncTeamCollaborators.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(service.addMember('team-1', { userId: 'new-user' }, 'admin-1')).resolves.toEqual({ id: 'member-1', userId: 'new-user' });
    expect(events.emitToTeam).toHaveBeenCalledWith('team-1', 'repository:collaborators-sync', { status: 'failed' });
  });

  it('keeps a team and its final receipt when deletion is requested', async () => {
    (service as any).checkAdminPermission = jest.fn().mockResolvedValue(undefined);
    const tx = {
      team: {
        findUnique: jest.fn().mockResolvedValue({
          _count: { registrations: 1, submissions: 1 },
        }),
        delete: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((work: any) => work(tx));

    await expect(service.remove('team-1', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tx.team.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });
});
