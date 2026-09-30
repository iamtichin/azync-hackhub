import { createHash, createHmac, randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { EventsGateway } from '../../src/events/events.gateway';
import { WebhooksController } from '../../src/modules/github/github.controller';
import { GithubService } from '../../src/modules/github/github.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@nestjs/jwt', () => ({ JwtService: class JwtService {} }));
jest.mock('../../src/modules/auth/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class JwtAuthGuard {},
}));

const secret = 'isolated-signed-webhook-test-secret';
const hackathonId = 'isolated-hackathon';
const repositoryFullName = 'fixture/workflow-repo';
const workflowTime = '2026-09-23T10:00:00Z';

type CapturedEvent = {
  room: string;
  event: string;
  data: unknown;
  at: bigint;
  unixMs: number;
};

describe('in-memory signed webhook integration slice (HTTP/controller/service/gateway)', () => {
  let app: INestApplication;
  let receivedAt: bigint | undefined;
  let receivedAtUnixMs: number | undefined;
  let emitted: CapturedEvent[];
  let deliveries: Map<
    string,
    { payloadHash: string; status: string; result?: unknown }
  >;
  let workflowRows: unknown[];
  let resolveEmission: ((event: CapturedEvent) => void) | undefined;
  let emission: Promise<CapturedEvent>;

  beforeEach(async () => {
    receivedAt = undefined;
    receivedAtUnixMs = undefined;
    emitted = [];
    deliveries = new Map();
    workflowRows = [];
    emission = new Promise((resolve) => {
      resolveEmission = resolve;
    });

    // The data boundary is intentionally in memory. Controller, HMAC verification,
    // webhook processing, and the real gateway emission method stay in the path.
    const prisma = {
      gitHubWebhookDelivery: {
        create: jest.fn(async ({ data }: any) => {
          if (deliveries.has(data.deliveryId)) {
            throw new Prisma.PrismaClientKnownRequestError('duplicate', {
              code: 'P2002',
              clientVersion: '5.22.0',
            });
          }
          deliveries.set(data.deliveryId, {
            payloadHash: data.payloadHash,
            status: data.status,
          });
        }),
        findUnique: jest.fn(async ({ where }: any) =>
          deliveries.get(where.deliveryId),
        ),
        update: jest.fn(async ({ where, data }: any) => {
          const row = deliveries.get(where.deliveryId)!;
          Object.assign(row, data);
          return row;
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      gitHubRepository: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.fullName === repositoryFullName
            ? { id: 'fixture-repo', teamId: 'fixture-team' }
            : null,
        ),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      gitHubWorkflowRun: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        create: jest.fn(async ({ data }: any) => {
          workflowRows.push(data);
          return data;
        }),
      },
      team: {
        findUnique: jest.fn(async () => ({ hackathonId })),
      },
    };
    const gateway = new EventsGateway(
      {} as any,
      {
        requirePublishedHackathon: async (id: string) => {
          if (id !== hackathonId) throw new Error('Unexpected hackathon');
        },
      } as any,
      {} as any,
    );
    gateway.server = {
      to: (room: string) => ({
        emit: (event: string, data: unknown) => {
          const capture = {
            room,
            event,
            data,
            at: process.hrtime.bigint(),
            unixMs: Date.now(),
          };
          emitted.push(capture);
          resolveEmission?.(capture);
        },
      }),
    } as any;

    const module = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [
        GithubService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'GITHUB_WEBHOOK_SECRET' ? secret : undefined,
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: EventsGateway, useValue: gateway },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    app.use((req: any, _res: any, next: () => void) => {
      if (req.path === '/webhooks/github') {
        receivedAt = process.hrtime.bigint();
        receivedAtUnixMs = Date.now();
      }
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  function signedPayload() {
    // Keep whitespace in the wire bytes: a normalized JSON signature must fail.
    const body = Buffer.from(
      JSON.stringify(
        {
          action: 'completed',
          repository: { full_name: repositoryFullName },
          workflow_run: {
            id: 412,
            run_attempt: 1,
            head_sha: 'a'.repeat(40),
            head_branch: 'main',
            event: 'push',
            head_repository: { full_name: repositoryFullName },
            status: 'completed',
            conclusion: 'success',
            run_started_at: '2026-09-23T09:59:00Z',
            updated_at: workflowTime,
          },
        },
        null,
        2,
      ),
    );
    return {
      body,
      signature: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    };
  }

  it('records receive, mocked gateway emission, and HTTP completion without asserting a 5s UI budget', async () => {
    const { body, signature } = signedPayload();
    const deliveryId = randomUUID();
    const clientStartedAt = process.hrtime.bigint();
    const response = await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'workflow_run')
      .set('x-github-delivery', deliveryId)
      .set('x-github-hook-id', 'fixture-hook')
      .set('x-hub-signature-256', signature)
      .send(body.toString('utf8'))
      .expect(200);
    const responseAt = process.hrtime.bigint();
    const event = await Promise.race([
      emission,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('No leaderboard invalidation')),
          1000,
        ),
      ),
    ]);

    expect(response.body).toMatchObject({
      deliveryId,
      duplicate: false,
      status: 'processed',
      event: 'workflow_run',
      testStatus: 'PASSED',
    });
    expect(deliveries.get(deliveryId)).toMatchObject({
      status: 'COMPLETED',
      payloadHash: createHash('sha256').update(body).digest('hex'),
    });
    expect(workflowRows).toEqual([
      expect.objectContaining({
        repositoryId: 'fixture-repo',
        runId: '412',
        testStatus: 'PASSED',
      }),
    ]);
    expect(emitted).toHaveLength(1);
    expect(event).toMatchObject({
      room: `hackathon:public:${hackathonId}`,
      event: 'leaderboard:invalidated',
      data: { source: 'ci', updatedAt: '2026-09-23T10:00:00.000Z' },
    });
    expect(receivedAt).toBeDefined();
    expect(clientStartedAt <= receivedAt!).toBe(true);
    expect(receivedAt! <= event.at).toBe(true);
    const elapsedMs = (end: bigint, start: bigint) => Number(end - start) / 1e6;
    // These are process-local monotonic markers. A Playwright test can add its
    // DOM marker; this test only measures the backend part of the path.
    console.log(
      JSON.stringify({
        deliveryId,
        backendReceivedAtUnixMs: receivedAtUnixMs,
        invalidationEmittedAtUnixMs: event.unixMs,
        clientToBackendReceiveMs: elapsedMs(receivedAt!, clientStartedAt),
        backendReceiveToInvalidationEmitMs: elapsedMs(event.at, receivedAt!),
        backendReceiveToHttpCompletionMs: elapsedMs(responseAt, receivedAt!),
      }),
    );
  });

  it('rejects tampered signed bytes before creating delivery or emitting', async () => {
    const { body, signature } = signedPayload();
    await request(app.getHttpServer())
      .post('/webhooks/github')
      .set('content-type', 'application/json')
      .set('x-github-event', 'workflow_run')
      .set('x-github-delivery', randomUUID())
      .set('x-hub-signature-256', signature)
      .send(body.toString('utf8').replace('"success"', '"failure"'))
      .expect(401);
    expect(deliveries.size).toBe(0);
    expect(workflowRows).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it('acknowledges an identical redelivery without a second invalidation', async () => {
    const { body, signature } = signedPayload();
    const deliveryId = randomUUID();
    const post = () =>
      request(app.getHttpServer())
        .post('/webhooks/github')
        .set('content-type', 'application/json')
        .set('x-github-event', 'workflow_run')
        .set('x-github-delivery', deliveryId)
        .set('x-hub-signature-256', signature)
        .send(body.toString('utf8'));
    await post().expect(200);
    await emission;
    const duplicate = await post().expect(200);
    expect(duplicate.body).toMatchObject({
      deliveryId,
      duplicate: true,
      status: 'completed',
    });
    expect(workflowRows).toHaveLength(1);
    expect(emitted).toHaveLength(1);
  });
});
