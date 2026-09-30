import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { GithubTokenEncryptionService } from './github-token-encryption.service';

describe('GithubTokenEncryptionService', () => {
  it('encrypts OAuth tokens with user-bound authenticated data', () => {
    const config = {
      get: jest.fn((name: string) =>
        name === 'AI_DATA_ENCRYPTION_KEY'
          ? Buffer.alloc(32, 9).toString('base64')
          : 'v1',
      ),
    } as unknown as ConfigService;
    const service = new GithubTokenEncryptionService(
      {} as PrismaService,
      config,
    );
    const encrypted = service.encryptToken('user-1', 'github-1', 'gho_secret');

    expect(encrypted.accessToken).toBeNull();
    expect(encrypted.accessTokenCiphertext).not.toContain('gho_secret');
    expect(
      service.decryptToken({
        id: 'user-1',
        githubId: 'github-1',
        ...encrypted,
      }),
    ).toBe('gho_secret');
    expect(() =>
      service.decryptToken({
        id: 'user-2',
        githubId: 'github-1',
        ...encrypted,
      }),
    ).toThrow();
  });
});
