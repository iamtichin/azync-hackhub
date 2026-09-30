import { createHmac } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { AiQueueService } from '../../src/modules/ai/queue/ai-queue.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { SolanaService } from '../../src/modules/solana/solana.service';
import { e2eFixtureId } from '../support/e2e-environment';

const runLoad = process.env.AZYNC_E2E_LOAD === 'true';
const loadDescribe = runLoad ? describe : describe.skip;

type TestSocket = {
  on(event: string, listener: (...args: any[]) => void): TestSocket;
  once(event: string, listener: (...args: any[]) => void): TestSocket;
  emit(event: string, ...args: any[]): TestSocket;
  disconnect(): TestSocket;
};
const { io } = createRequire(import.meta.url)(
  resolve(process.cwd(), 'node_modules/socket.io/client-dist/socket.io.js'),
) as { io: (url: string, options: Record<string, unknown>) => TestSocket };

function percentile(values: number[], percentileValue: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)];
}

function waitForSocket(socket: TestSocket, event: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      10_000,
    );
    socket.once(event, (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

loadDescribe('Phase 8 bounded load and realtime operation (isolated E2E)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;
  let socket: TestSocket | undefined;
  const organizerId = e2eFixtureId('load-organizer');
  const hackathonId = e2eFixtureId('load-hackathon');
  const trackId = e2eFixtureId('load-track');
  const userIds = Array.from({ length: 101 }, (_, index) =>
    e2eFixtureId(`load-user-${index}`),
  );
  const teamIds = Array.from({ length: 101 }, (_, index) =>
    e2eFixtureId(`load-team-${index}`),
  );
  const repositoryFullName = `fixture/${e2eFixtureId('load-repository')}`;
  const mint = jest.fn(
    async (submissionId: string) => ({
      signature: `signature-${submissionId}`,
      assetId: `asset-${submissionId}`,
    }),
  );

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SolanaService)
      .useValue({
        mintSubmissionCredential: mint,
        getMintRecoveryState: async () => null,
        getExplorerUrl: (signature: string) =>
          `https://explorer.example/tx/${signature}`,
        getHealth: async () => ({ status: 'ok', network: 'devnet' }),
      })
      .overrideProvider(AiQueueService)
      .useValue({
        enqueueSubmission: async (submissionId: string) => ({
          id: `load-job-${submissionId}`,
          bullmqJobId: `load-queue-${submissionId}`,
          status: 'QUEUED',
        }),
      })
      .compile();

    app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    await prisma.user.createMany({
      data: [organizerId, ...userIds].map((id, index) => ({
        id,
        githubId: e2eFixtureId(`load-github-${index}`),
        githubUsername: id,
        name: `Load user ${index}`,
      })),
    });
    await prisma.hackathon.create({
      data: {
        id: hackathonId,
        organizerId,
        name: 'Phase 8 bounded load event',
        isPublished: true,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 90_000),
        tracks: { create: { id: trackId, name: 'Load track' } },
      },
    });
    await prisma.team.createMany({
      data: teamIds.map((id, index) => ({
        id,
        name: `Load workspace ${index}`,
        hackathonId,
      })),
    });
    await prisma.teamMember.createMany({
      data: teamIds.map((teamId, index) => ({
        teamId,
        userId: userIds[index],
        role: 'admin',
      })),
    });
    await prisma.hackathonRegistration.createMany({
      data: teamIds.map((teamId) => ({ hackathonId, teamId, trackId })),
    });
    await prisma.gitHubRepository.create({
      data: {
        teamId: teamIds[0],
        fullName: repositoryFullName,
        url: `https://github.com/${repositoryFullName}`,
        webhookConfigured: true,
      },
    });
  }, 60_000);

  afterAll(async () => {
    socket?.disconnect();
    if (prisma) {
      await prisma.gitHubWebhookDelivery.deleteMany({
        where: { deliveryId: { startsWith: 'load-delivery-' } },
      });
      await prisma.submission.deleteMany({ where: { hackathonId } });
      await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
      await prisma.hackathon.deleteMany({ where: { id: hackathonId } });
      await prisma.user.deleteMany({
        where: { id: { in: [organizerId, ...userIds] } },
      });
    }
    if (app) await app.close();
  }, 60_000);

  it('measures 100 workspaces, 20 ops/s, 100 finals, double click and realtime p95', async () => {
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP test listener');
    }
    const tokens = userIds.map((userId, index) =>
      jwt.sign(
        {
          sub: userId,
          githubUsername: userId,
          jti: e2eFixtureId(`load-jti-${index}`),
        },
        { expiresIn: '1h' },
      ),
    );
    socket = io(`http://127.0.0.1:${address.port}`, {
      auth: { token: tokens[0] },
      transports: ['websocket'],
      reconnection: false,
    });
    await waitForSocket(socket, 'connect');
    const joined = waitForSocket(socket, 'joined:leaderboard');
    socket.emit('join:leaderboard', hackathonId);
    await joined;

    const readLatencies: number[] = [];
    for (let offset = 0; offset < 100; offset += 20) {
      const batchStarted = Date.now();
      await Promise.all(
        teamIds.slice(offset, offset + 20).map(async (teamId, relative) => {
          const started = performance.now();
          await request(app.getHttpServer())
            .get(`/teams/${teamId}`)
            .set('Authorization', `Bearer ${tokens[offset + relative]}`)
            .expect(200);
          readLatencies.push(performance.now() - started);
        }),
      );
      const remaining = 1_000 - (Date.now() - batchStarted);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    }

    const mutationLatencies: number[] = [];
    const payload = (index: number) => ({
      teamId: teamIds[index],
      hackathonId,
      trackId,
      projectName: `Load final ${index}`,
      description: `Bounded isolated final submission number ${index}.`,
      githubUrl: `https://github.com/example/load-${index}`,
      demoUrl: `https://example.com/load-${index}`,
      slidesUrl: `https://example.com/load-${index}/slides`,
      participantBlockchainEvidenceUrl: `https://example.com/load-${index}/proof`,
      walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
    });
    for (let offset = 0; offset < 100; offset += 20) {
      const batchStarted = Date.now();
      await Promise.all(
        Array.from({ length: 20 }, (_, relative) => offset + relative).map(
          async (index) => {
            const started = performance.now();
            await request(app.getHttpServer())
              .post('/submissions')
              .set('Authorization', `Bearer ${tokens[index]}`)
              .send(payload(index))
              .expect(201);
            mutationLatencies.push(performance.now() - started);
          },
        ),
      );
      const remaining = 1_000 - (Date.now() - batchStarted);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    }

    const doubleClick = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/submissions')
          .set('Authorization', `Bearer ${tokens[100]}`)
          .send(payload(100)),
      ),
    );
    expect(doubleClick.map((response) => response.status)).toEqual([201, 201]);
    expect(doubleClick[0].body.id).toBe(doubleClick[1].body.id);

    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('Missing isolated webhook secret');
    const realtimeLatencies: number[] = [];
    const sentAt = new Map<string, number>();
    const socketEvents = new Promise<void>((resolve) => {
      socket!.on(
        'leaderboard:invalidated',
        (event: { updatedAt?: string }) => {
          if (!event.updatedAt || !sentAt.has(event.updatedAt)) return;
          realtimeLatencies.push(performance.now() - sentAt.get(event.updatedAt)!);
          if (realtimeLatencies.length === 20) resolve();
        },
      );
    });
    const webhookLatencies: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => index).map(async (index) => {
        const updatedAt = new Date(Date.now() + index).toISOString();
        const body = Buffer.from(
          JSON.stringify({
            action: 'completed',
            repository: { full_name: repositoryFullName },
            workflow_run: {
              id: 80_000 + index,
              run_attempt: 1,
              head_sha: String(index).padStart(40, 'a'),
              head_branch: 'main',
              event: 'push',
              head_repository: { full_name: repositoryFullName },
              status: 'completed',
              conclusion: 'success',
              updated_at: updatedAt,
            },
          }),
        );
        const signature = `sha256=${createHmac('sha256', webhookSecret)
          .update(body)
          .digest('hex')}`;
        sentAt.set(updatedAt, performance.now());
        const started = performance.now();
        await request(app.getHttpServer())
          .post('/webhooks/github')
          .set('content-type', 'application/json')
          .set('x-github-event', 'workflow_run')
          .set('x-github-delivery', `load-delivery-${index}-${hackathonId}`)
          .set('x-hub-signature-256', signature)
          .send(body.toString('utf8'))
          .expect(200);
        webhookLatencies.push(performance.now() - started);
      }),
    );
    await Promise.race([
      socketEvents,
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error('Timed out waiting for load socket events')),
          10_000,
        ),
      ),
    ]);

    const metrics = {
      workspaceCount: await prisma.team.count({ where: { hackathonId } }),
      finalCount: await prisma.submission.count({ where: { hackathonId } }),
      mintCalls: mint.mock.calls.length,
      readP95Ms: percentile(readLatencies, 0.95),
      mutationP95Ms: percentile(mutationLatencies, 0.95),
      webhookP95Ms: percentile(webhookLatencies, 0.95),
      eventToSocketP95Ms: percentile(realtimeLatencies, 0.95),
    };
    console.log(`PHASE8_LOAD_METRICS ${JSON.stringify(metrics)}`);
    const resultsDirectory = resolve(process.cwd(), 'test-results');
    mkdirSync(resultsDirectory, { recursive: true });
    writeFileSync(
      resolve(resultsDirectory, 'phase8-load-metrics.json'),
      `${JSON.stringify(metrics, null, 2)}\n`,
      'utf8',
    );

    expect(metrics.workspaceCount).toBe(101);
    expect(metrics.finalCount).toBe(101);
    expect(metrics.mintCalls).toBe(101);
    expect(metrics.readP95Ms).toBeLessThan(500);
    expect(metrics.mutationP95Ms).toBeLessThan(1_000);
    expect(metrics.eventToSocketP95Ms).toBeLessThan(5_000);
  }, 60_000);
});
