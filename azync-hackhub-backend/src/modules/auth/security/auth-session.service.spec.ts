import { UnauthorizedException } from '@nestjs/common';
import { AuthSessionService } from './auth-session.service';

describe('AuthSessionService', () => {
  const revokedSession = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  };
  const prisma = { revokedSession } as any;
  const service = new AuthSessionService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it('persists a logout deny-list entry until the token expires', async () => {
    const expiresAt = Date.now() + 60_000;
    await service.revoke('session-1', 'user-1', expiresAt);

    expect(revokedSession.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { jti: 'session-1' },
      create: expect.objectContaining({ userId: 'user-1', jti: 'session-1' }),
    }));
  });

  it('rejects a revoked session', async () => {
    revokedSession.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() + 60_000) });
    await expect(service.assertActive('session-1')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('removes an expired deny-list entry and permits the already-expired record to be ignored', async () => {
    revokedSession.findUnique.mockResolvedValue({ expiresAt: new Date(Date.now() - 1) });
    await expect(service.assertActive('session-1')).resolves.toBeUndefined();
    expect(revokedSession.delete).toHaveBeenCalledWith({ where: { jti: 'session-1' } });
  });

  it('requires a token id, user, and expiry when revoking', async () => {
    await expect(service.revoke(undefined, 'user-1', Date.now() + 60_000)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.revoke('session-1', undefined, Date.now() + 60_000)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.revoke('session-1', 'user-1')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
