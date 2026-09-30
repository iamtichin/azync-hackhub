import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerRequest } from '@nestjs/throttler';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';

/** Uses a verified JWT subject when present, otherwise falls back to Express's proxy-aware IP. */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  constructor(options: ThrottlerModuleOptions, storage: ThrottlerStorage, reflector: Reflector, private readonly jwt: JwtService) {
    super(options, storage, reflector);
  }

  protected override async handleRequest(request: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = request;
    // Named buckets are opt-in. Otherwise a 3/min provisioning limit also
    // throttles ordinary reads, planning updates, and GitHub webhooks.
    if (throttler.name !== 'default') {
      const routeLimit = this.reflector.getAllAndOverride(
        THROTTLER_LIMIT + throttler.name,
        [context.getHandler(), context.getClass()],
      );
      if (routeLimit === undefined) return true;
    }
    return super.handleRequest(request);
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const token = typeof req.headers?.authorization === 'string'
      ? req.headers.authorization.replace(/^Bearer\s+/i, '')
      : '';
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub?: string }>(token, { algorithms: ['HS256'] });
        if (typeof payload.sub === 'string' && payload.sub) return `user:${payload.sub}`;
      } catch {
        // Unauthenticated requests are deliberately grouped by the proxy-aware IP below.
      }
    }
    return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
  }
}
