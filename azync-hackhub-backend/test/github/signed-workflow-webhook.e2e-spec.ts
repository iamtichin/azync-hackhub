import { createHash, createHmac } from 'crypto';
import { createRequire } from 'module';
import { resolve } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { SolanaService } from '../../src/modules/solana/solana.service';
import { e2eFixtureId } from '../support/e2e-environment';

// Socket.IO publishes its browser client bundle with the server package. Loading
// that bundle gives this test a real protocol client without another dependency.
type TestSocket = {
  on(event: string, listener: (...args: any[]) => void): TestSocket;
  once(event: string, listener: (...args: any[]) => void): TestSocket;
  off(event: string, listener: (...args: any[]) => void): TestSocket;
  emit(event: string, ...args: any[]): TestSocket;
  disconnect(): TestSocket;
};
const { io } = createRequire(import.meta.url)(
  resolve(process.cwd(), 'node_modules/socket.io/client-dist/socket.io.js'),
) as { io: (url: string, options: Record<string, unknown>) => TestSocket };

function waitForEvent<T>(
  socket: TestSocket,
  event: string,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      socket.off('connect_error', onError);
      socket.off('join:error', onJoinError);
      socket.off('disconnect', onDisconnect);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      socket.off('connect_error', onError);
      socket.off('join:error', onJoinError);
      socket.off('disconnect', onDisconnect);
    };
    const onEvent = (value: T) => {
      finish();
      resolve(value);
    };
    const onError = (error: Error) => {
      finish();
      reject(error);
    };
    const onJoinError = (error: unknown) => {
      finish();
      reject(
        new Error(
          `Socket join denied while waiting for ${event}: ${JSON.stringify(error)}`,
        ),
      );
    };
    const onDisconnect = (reason: string) => {
      finish();
      reject(
        new Error(`Socket disconnected while waiting for ${event}: ${reason}`),
      );
    };
    socket.once(event, onEvent);
    socket.once('connect_error', onError);
    if (event.startsWith('joined:')) socket.once('join:error', onJoinError);
    socket.once('disconnect', onDisconnect);
  });
}

function fixtureJwt(userId: string, secret: string): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: userId,
    jti: e2eFixtureId('session'),
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const signed = `${header}.${payload}`;
  return `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`;
}

describe('signed workflow webhook with isolated Prisma and subscribed Socket.IO client (e2e)', () => {
  const hackathonId = e2eFixtureId('webhook-hackathon');
  const teamId = e2eFixtureId('webhook-team');
  const userId = e2eFixtureId('webhook-user');
  const deliveryId = e2eFixtureId('webhook-delivery');
  const repositoryFullName = `fixture/${e2eFixtureId('webhook-repo')}`;
  const headSha = 'c'.repeat(40);
  const workflowUpdatedAt = new Date().toISOString();
  let app: INestApplication;
  let prisma: PrismaService;
  let socket: TestSocket | undefined;
  let backendReceivedAt: bigint | undefined;
  let backendReceivedAtUnixMs: number | undefined;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SolanaService)
      .useValue({
        getHealth: async () => ({ status: 'ok', network: 'devnet' }),
      })
      .compile();
    app = module.createNestApplication({ rawBody: true });
    app.use((req: any, _res: any, next: () => void) => {
      if (
        req.path === '/webhooks/github' &&
        req.headers['x-github-delivery'] === deliveryId
      ) {
        backendReceivedAt = process.hrtime.bigint();
        backendReceivedAtUnixMs = Date.now();
      }
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    await prisma.user.create({
      data: {
        id: userId,
        githubId: e2eFixtureId('webhook-gh-id'),
        githubUsername: e2eFixtureId('webhook-gh-user'),
        name: 'Webhook E2E User',
      },
    });
    await prisma.hackathon.create({
      data: {
        id: hackathonId,
        name: 'Webhook E2E Hackathon',
        isPublished: true,
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-10-01T00:00:00Z'),
      },
    });
    await prisma.team.create({
      data: {
        id: teamId,
        name: 'Webhook E2E Team',
        hackathonId,
        registrations: { create: { hackathonId } },
        repository: {
          create: {
            fullName: repositoryFullName,
            url: `https://github.com/${repositoryFullName}`,
            webhookConfigured: true,
          },
        },
      },
    });
  }, 60_000);

  afterAll(async () => {
    socket?.disconnect();
    try {
      if (prisma) {
        await prisma.gitHubWebhookDelivery.deleteMany({
          where: { deliveryId },
        });
        await prisma.team.deleteMany({ where: { id: teamId } });
        await prisma.hackathon.deleteMany({ where: { id: hackathonId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      if (app) await app.close();
    }
  }, 60_000);

  it('persists the signed HTTP delivery and CI run, reaches a joined socket, and appears on leaderboard HTTP', async () => {
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string')
      throw new Error('Expected TCP test listener');
    const jwtSecret = process.env.JWT_SECRET;
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!jwtSecret || !webhookSecret)
      throw new Error('Missing isolated E2E secrets');
    socket = io(`http://127.0.0.1:${address.port}`, {
      auth: { token: fixtureJwt(userId, jwtSecret) },
      transports: ['websocket'],
      reconnection: false,
    });
    await waitForEvent(socket, 'connect');
    const joined = waitForEvent<string>(socket, 'joined:leaderboard');
    socket.emit('join:leaderboard', hackathonId);
    expect(await joined).toBe(hackathonId);

    const body = Buffer.from(
      JSON.stringify(
        {
          action: 'completed',
          repository: { full_name: repositoryFullName },
          workflow_run: {
            id: 412,
            run_attempt: 1,
            head_sha: headSha,
            head_branch: 'main',
            event: 'push',
            head_repository: { full_name: repositoryFullName },
            status: 'completed',
            conclusion: 'success',
            updated_at: workflowUpdatedAt,
          },
        },
        null,
        2,
      ),
    );
    const signature = `sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`;
    const invalidation = waitForEvent<{ source: string; updatedAt: string }>(
      socket,
      'leaderboard:invalidated',
    ).then((value) => ({ value, at: process.hrtime.bigint() }));
    const clientStartedAt = process.hrtime.bigint();
    const response = await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'workflow_run')
      .set('x-github-delivery', deliveryId)
      .set('x-hub-signature-256', signature)
      .send(body.toString('utf8'))
      .expect(200);
    const responseAt = process.hrtime.bigint();
    const event = await invalidation;
    const socketReceivedAt = event.at;

    expect(response.body).toMatchObject({
      deliveryId,
      duplicate: false,
      status: 'processed',
      testStatus: 'PASSED',
    });
    expect(event.value).toEqual({ source: 'ci', updatedAt: workflowUpdatedAt });
    const delivery = await prisma.gitHubWebhookDelivery.findUniqueOrThrow({
      where: { deliveryId },
    });
    expect(delivery).toMatchObject({
      status: 'COMPLETED',
      event: 'workflow_run',
      repositoryFullName,
      payloadHash: createHash('sha256').update(body).digest('hex'),
    });
    const repository = await prisma.gitHubRepository.findUniqueOrThrow({
      where: { teamId },
    });
    const run = await prisma.gitHubWorkflowRun.findUniqueOrThrow({
      where: {
        repositoryId_runId_runAttempt: {
          repositoryId: repository.id,
          runId: '412',
          runAttempt: 1,
        },
      },
    });
    expect(run).toMatchObject({
      headSha,
      testStatus: 'PASSED',
      coverageStatus: 'UNKNOWN',
      conclusion: 'success',
    });
    const leaderboard = await request(app.getHttpServer())
      .get(`/hackathons/${hackathonId}/leaderboard`)
      .expect(200);
    expect(leaderboard.body.leaderboard).toEqual([
      expect.objectContaining({
        teamId,
        ci: expect.objectContaining({
          status: 'passed',
          runId: '412',
          testStatus: 'PASSED',
          commitSha: headSha,
        }),
      }),
    ]);
    expect(backendReceivedAt).toBeDefined();
    expect(clientStartedAt <= backendReceivedAt!).toBe(true);
    expect(backendReceivedAt! <= socketReceivedAt).toBe(true);
    const ms = (end: bigint, start: bigint) => Number(end - start) / 1e6;
    console.log(
      JSON.stringify({
        deliveryId,
        backendReceivedAtUnixMs,
        clientToBackendReceiveMs: ms(backendReceivedAt!, clientStartedAt),
        backendReceiveToSocketClientMs: ms(
          socketReceivedAt,
          backendReceivedAt!,
        ),
        backendReceiveToHttpCompletionMs: ms(responseAt, backendReceivedAt!),
      }),
    );
  }, 30_000);
});
