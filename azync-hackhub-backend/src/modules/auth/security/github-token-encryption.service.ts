import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class GithubTokenEncryptionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(GithubTokenEncryptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let migrated = 0;
    while (true) {
      const users = await this.prisma.user.findMany({
        where: { accessToken: { not: null } },
        select: { id: true, githubId: true, accessToken: true },
        take: 500,
      });
      if (users.length === 0) break;
      for (const user of users) {
        const encrypted = this.encryptToken(
          user.id,
          user.githubId,
          user.accessToken!,
        );
        await this.prisma.user.update({
          where: { id: user.id },
          data: encrypted,
        });
      }
      migrated += users.length;
    }
    if (migrated > 0) {
      this.logger.log(
        JSON.stringify({ event: 'github_tokens_migrated', users: migrated }),
      );
    }
  }

  newUserId(): string {
    return randomUUID();
  }

  encryptToken(userId: string, githubId: string, token: string) {
    const version =
      this.config.get<string>('AI_DATA_ENCRYPTION_KEY_VERSION')?.trim() || 'v1';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(this.aad(userId, githubId, version), 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final(),
    ]);
    return {
      accessToken: null,
      accessTokenCiphertext: ciphertext.toString('base64'),
      accessTokenIv: iv.toString('base64'),
      accessTokenAuthTag: cipher.getAuthTag().toString('base64'),
      accessTokenKeyVersion: version,
    };
  }

  decryptToken(user: {
    id: string;
    githubId: string;
    accessTokenCiphertext: string | null;
    accessTokenIv: string | null;
    accessTokenAuthTag: string | null;
    accessTokenKeyVersion: string | null;
  }): string | null {
    if (!user.accessTokenCiphertext) return null;
    if (
      !user.accessTokenIv ||
      !user.accessTokenAuthTag ||
      !user.accessTokenKeyVersion
    ) {
      throw new Error(`Encrypted GitHub token for ${user.id} is incomplete`);
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(user.accessTokenIv, 'base64'),
    );
    decipher.setAAD(
      Buffer.from(
        this.aad(user.id, user.githubId, user.accessTokenKeyVersion),
        'utf8',
      ),
    );
    decipher.setAuthTag(Buffer.from(user.accessTokenAuthTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(user.accessTokenCiphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private key(): Buffer {
    const encoded = this.config.get<string>('AI_DATA_ENCRYPTION_KEY')?.trim();
    if (!encoded) throw new Error('AI_DATA_ENCRYPTION_KEY is required');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'AI_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
      );
    }
    return key;
  }

  private aad(userId: string, githubId: string, version: string): string {
    return ['azync', 'github-token', version, userId, githubId].join('|');
  }
}
