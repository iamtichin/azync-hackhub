import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { UserThrottlerGuard } from './user-throttler.guard';

@Controller('rate-limit-fixture')
class RateLimitFixtureController {
  @Get('auth')
  @SkipThrottle({ provision: true, mint: true, ai: true })
  @Throttle({ auth: { limit: 10, ttl: 60000 } })
  auth() { return { ok: true }; }

  @Get('provision')
  @SkipThrottle({ auth: true, mint: true, ai: true })
  @Throttle({ provision: { limit: 3, ttl: 60000 } })
  provision() { return { ok: true }; }

  @Get('mint')
  @SkipThrottle({ auth: true, provision: true, ai: true })
  @Throttle({ mint: { limit: 5, ttl: 60000 } })
  mint() { return { ok: true }; }

  @Get('ai')
  @SkipThrottle({ auth: true, provision: true, mint: true })
  @Throttle({ ai: { limit: 12, ttl: 60000 } })
  ai() { return { ok: true }; }

  @Get('status')
  status() { return { status: 'processing' }; }
}

describe('UserThrottlerGuard named limits', () => {
  let app: INestApplication;
  let jwt: JwtService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({ secret: 'rate-limit-test-secret' }),
        ThrottlerModule.forRoot([
          { name: 'default', ttl: 60000, limit: 120 },
          { name: 'auth', ttl: 60000, limit: 15 },
          { name: 'provision', ttl: 60000, limit: 3 },
          { name: 'mint', ttl: 60000, limit: 5 },
          { name: 'ai', ttl: 60000, limit: 12 },
        ]),
      ],
      controllers: [RateLimitFixtureController],
      providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
    }).compile();
    app = module.createNestApplication();
    app.set('trust proxy', 1);
    await app.init();
    jwt = module.get(JwtService);
  });

  afterEach(async () => app.close());

  it.each([
    ['auth', 10],
    ['provision', 3],
    ['mint', 5],
    ['ai', 12],
  ])('enforces the %s named limit while valid requests continue', async (route, limit) => {
    for (let attempt = 0; attempt < limit; attempt += 1) {
      await request(app.getHttpServer())
        .get(`/rate-limit-fixture/${route}`)
        .set('X-Forwarded-For', '198.51.100.10')
        .expect(200)
        .expect({ ok: true });
    }
    await request(app.getHttpServer())
      .get(`/rate-limit-fixture/${route}`)
      .set('X-Forwarded-For', '198.51.100.10')
      .expect(429);
  });

  it('keys authenticated requests by user and anonymous requests by proxy-aware IP', async () => {
    const alice = jwt.sign({ sub: 'alice' });
    const bob = jwt.sign({ sub: 'bob' });

    for (const ip of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
      await request(app.getHttpServer())
        .get('/rate-limit-fixture/provision')
        .set('Authorization', `Bearer ${alice}`)
        .set('X-Forwarded-For', ip)
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/rate-limit-fixture/provision')
      .set('Authorization', `Bearer ${alice}`)
      .set('X-Forwarded-For', '203.0.113.5')
      .expect(429);
    await request(app.getHttpServer())
      .get('/rate-limit-fixture/provision')
      .set('Authorization', `Bearer ${bob}`)
      .set('X-Forwarded-For', '203.0.113.5')
      .expect(200);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app.getHttpServer())
        .get('/rate-limit-fixture/provision')
        .set('X-Forwarded-For', '192.0.2.9')
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/rate-limit-fixture/provision')
      .set('X-Forwarded-For', '192.0.2.9')
      .expect(429);
    await request(app.getHttpServer())
      .get('/rate-limit-fixture/provision')
      .set('X-Forwarded-For', '192.0.2.10')
      .expect(200);
  });

  it('allows bounded status polling under the default bucket while AI refresh reaches its own limit', async () => {
    for (let poll = 0; poll < 20; poll += 1) {
      await request(app.getHttpServer())
        .get('/rate-limit-fixture/status')
        .set('X-Forwarded-For', '203.0.113.40')
        .expect(200)
        .expect({ status: 'processing' });
    }

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await request(app.getHttpServer())
        .get('/rate-limit-fixture/ai')
        .set('X-Forwarded-For', '203.0.113.40')
        .expect(200);
    }
    await request(app.getHttpServer())
      .get('/rate-limit-fixture/ai')
      .set('X-Forwarded-For', '203.0.113.40')
      .expect(429);
  });
});
