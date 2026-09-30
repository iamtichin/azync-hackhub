import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Database-backed JWT deny-list keeps logout effective across application instances. */
@Injectable()
export class AuthSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async revoke(jti: string | undefined, userId: string | undefined, expiresAt?: number) {
    if (!jti || !userId || !expiresAt || !Number.isSafeInteger(expiresAt)) {
      throw new UnauthorizedException('Invalid session');
    }
    const expiry = new Date(expiresAt);
    if (expiry <= new Date()) return;
    await this.prisma.revokedSession.upsert({
      where: { jti },
      update: { expiresAt: expiry },
      create: { jti, userId, expiresAt: expiry },
    });
  }

  async assertActive(jti?: string) {
    if (!jti || typeof jti !== 'string') throw new UnauthorizedException('Invalid session');
    const session = await this.prisma.revokedSession.findUnique({
      where: { jti },
      select: { expiresAt: true },
    });
    if (!session) return;
    if (session.expiresAt <= new Date()) {
      await this.prisma.revokedSession.delete({ where: { jti } });
      return;
    }
    throw new UnauthorizedException('Session has been revoked');
  }
}
