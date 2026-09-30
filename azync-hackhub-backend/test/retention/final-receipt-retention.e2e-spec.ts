import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { e2eFixtureId } from '../support/e2e-environment';

describe('Final receipt retention boundaries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const ownerId = e2eFixtureId('retention-owner');
  const outsiderId = e2eFixtureId('retention-outsider');
  const hackathonId = e2eFixtureId('retention-hackathon');
  const trackId = e2eFixtureId('retention-track');
  const teamId = e2eFixtureId('retention-team');
  const submissionId = e2eFixtureId('retention-submission');
  const foreignHackathonId = e2eFixtureId('retention-foreign-hackathon');
  const foreignTrackId = e2eFixtureId('retention-foreign-track');
  const foreignTeamId = e2eFixtureId('retention-foreign-team');
  const foreignSubmissionId = e2eFixtureId('retention-foreign-submission');
  const finalSnapshot = { receiptVersion: 2, projectName: 'Immutable final' };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => {
            getRequest: () => {
              headers: Record<string, string | undefined>;
              user?: { id: string };
            };
          };
        }) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: req.headers['x-e2e-user-id'] ?? ownerId };
          return true;
        },
      })
      .compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          githubId: e2eFixtureId('retention-github-owner'),
          githubUsername: e2eFixtureId('retention-owner-name'),
          name: 'Retention Owner',
        },
        {
          id: outsiderId,
          githubId: e2eFixtureId('retention-github-outsider'),
          githubUsername: e2eFixtureId('retention-outsider-name'),
          name: 'Retention Outsider',
        },
      ],
    });
    await prisma.hackathon.create({
      data: {
        id: hackathonId,
        organizerId: ownerId,
        name: 'Retention event',
        isPublished: true,
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-10-01T00:00:00Z'),
        tracks: { create: { id: trackId, name: 'Retention track' } },
      },
    });
    await prisma.team.create({
      data: {
        id: teamId,
        name: 'Retention team',
        hackathonId,
        members: { create: { userId: ownerId, role: 'admin' } },
        registrations: { create: { hackathonId, trackId } },
      },
    });
    await prisma.submission.create({
      data: {
        id: submissionId,
        teamId,
        hackathonId,
        trackId,
        projectName: 'Immutable final',
        description: 'Receipt retention fixture',
        githubUrl: 'https://github.com/example/retention',
        demoUrl: 'https://example.com/retention',
        walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
        status: 'confirmed',
        mintStatus: 'CONFIRMED',
        finalSnapshot,
        finalizedAt: new Date('2026-09-02T00:00:00Z'),
        receiptVersion: 2,
      },
    });
    await prisma.hackathon.create({
      data: {
        id: foreignHackathonId,
        organizerId: outsiderId,
        name: 'Foreign retention event',
        isPublished: true,
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-10-01T00:00:00Z'),
        tracks: {
          create: { id: foreignTrackId, name: 'Foreign retention track' },
        },
      },
    });
    await prisma.team.create({
      data: {
        id: foreignTeamId,
        name: 'Foreign retention team',
        hackathonId: foreignHackathonId,
        members: { create: { userId: outsiderId, role: 'admin' } },
        registrations: {
          create: {
            hackathonId: foreignHackathonId,
            trackId: foreignTrackId,
          },
        },
      },
    });
    await prisma.submission.create({
      data: {
        id: foreignSubmissionId,
        teamId: foreignTeamId,
        hackathonId: foreignHackathonId,
        trackId: foreignTrackId,
        projectName: 'Foreign final must stay private',
        description: 'Cross-event isolation fixture',
        githubUrl: 'https://github.com/example/foreign-retention',
        demoUrl: 'https://example.com/foreign-retention',
        walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
        status: 'confirmed',
        mintStatus: 'CONFIRMED',
        finalSnapshot: { receiptVersion: 2, projectName: 'Foreign final' },
        finalizedAt: new Date('2026-09-02T00:00:00Z'),
        receiptVersion: 2,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.submission.deleteMany({
        where: { id: { in: [submissionId, foreignSubmissionId] } },
      });
      await prisma.team.deleteMany({
        where: { id: { in: [teamId, foreignTeamId] } },
      });
      await prisma.hackathon.deleteMany({
        where: { id: { in: [hackathonId, foreignHackathonId] } },
      });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, outsiderId] } } });
    }
    if (app) await app.close();
  });

  it('blocks event, team and track mutations that would erase or rewrite a final', async () => {
    await request(app.getHttpServer())
      .delete(`/hackathons/${hackathonId}`)
      .set('x-e2e-user-id', ownerId)
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/teams/${teamId}`)
      .set('x-e2e-user-id', ownerId)
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/hackathons/${hackathonId}/tracks/${trackId}`)
      .set('x-e2e-user-id', ownerId)
      .send({ name: 'Rewritten track' })
      .expect(400);

    const retained = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { finalSnapshot: true, track: { select: { name: true } } },
    });
    expect(retained).toEqual({
      finalSnapshot,
      track: { name: 'Retention track' },
    });
  });

  it('allows safe scope edits without changing the immutable final snapshot', async () => {
    await request(app.getHttpServer())
      .patch(`/hackathons/${hackathonId}`)
      .set('x-e2e-user-id', ownerId)
      .send({ name: 'Retention event renamed' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/teams/${teamId}`)
      .set('x-e2e-user-id', ownerId)
      .send({ name: 'Retention team renamed' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/hackathons/${hackathonId}/tracks/${trackId}`)
      .set('x-e2e-user-id', ownerId)
      .send({ isActive: false })
      .expect(200);

    const retained = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { finalSnapshot: true },
    });
    expect(retained?.finalSnapshot).toEqual(finalSnapshot);
  });

  it('validates organizer filters and checks ownership before returning rows', async () => {
    await request(app.getHttpServer())
      .get(`/hackathons/${hackathonId}/organizer-submissions?status=made-up`)
      .set('x-e2e-user-id', ownerId)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/hackathons/${hackathonId}/organizer-submissions?cursor=missing`)
      .set('x-e2e-user-id', ownerId)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/hackathons/${hackathonId}/organizer-submissions.csv?cursor=ignored`)
      .set('x-e2e-user-id', ownerId)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/hackathons/${hackathonId}/organizer-submissions.csv`)
      .set('x-e2e-user-id', outsiderId)
      .expect(403);

    const page = await request(app.getHttpServer())
      .get(`/hackathons/${hackathonId}/organizer-submissions`)
      .set('x-e2e-user-id', ownerId)
      .expect(200);
    expect(page.body.items.map((item: { id: string }) => item.id)).toEqual([
      submissionId,
    ]);

    const csv = await request(app.getHttpServer())
      .get(`/hackathons/${hackathonId}/organizer-submissions.csv`)
      .set('x-e2e-user-id', ownerId)
      .expect(200);
    expect(csv.text).toContain('Immutable final');
    expect(csv.text).not.toContain('Foreign final must stay private');
  });
});
