import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { e2eFixtureId } from '../support/e2e-environment';

describe('Phase 8 auth, scope and event recovery boundaries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let jwt: JwtService;

  const ownerId = e2eFixtureId('p8-owner');
  const outsiderOwnerId = e2eFixtureId('p8-outsider-owner');
  const memberId = e2eFixtureId('p8-member');
  const soloId = e2eFixtureId('p8-solo');
  const judgeId = e2eFixtureId('p8-judge');
  const eventId = e2eFixtureId('p8-event');
  const unpublishedEventId = e2eFixtureId('p8-unpublished-event');
  const trackId = e2eFixtureId('p8-track');
  const inactiveTrackId = e2eFixtureId('p8-inactive-track');
  const foreignTrackId = e2eFixtureId('p8-foreign-track');
  const teamId = e2eFixtureId('p8-team');
  const soloTeamId = e2eFixtureId('p8-solo-team');
  const raceTeamId = e2eFixtureId('p8-race-team');
  const submissionId = e2eFixtureId('p8-submission');
  const draftId = e2eFixtureId('p8-draft');

  const bearer = (userId: string, jti = e2eFixtureId(`p8-jti-${userId}`)) =>
    `Bearer ${jwt.sign(
      { sub: userId, githubUsername: userId, jti },
      { expiresIn: '1h' },
    )}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    jwt = app.get(JwtService);

    await prisma.user.createMany({
      data: [ownerId, outsiderOwnerId, memberId, soloId, judgeId].map(
        (id, index) => ({
          id,
          githubId: e2eFixtureId(`p8-github-${index}`),
          githubUsername: id,
          name: `Phase 8 user ${index}`,
        }),
      ),
    });

    const now = Date.now();
    await prisma.hackathon.create({
      data: {
        id: eventId,
        organizerId: ownerId,
        name: 'Phase 8 published event',
        isPublished: true,
        startDate: new Date(now - 60_000),
        endDate: new Date(now + 60 * 60_000),
        rules: [{ id: 'original-rule', name: 'Original', description: 'Keep it' }],
        rubric: [
          {
            id: 'original-rubric',
            name: 'Original',
            description: 'Keep it',
            weight: 1,
            minScore: 0,
            maxScore: 10,
          },
        ],
        tracks: {
          create: [
            { id: trackId, name: 'Active track' },
            { id: inactiveTrackId, name: 'Inactive track', isActive: false },
          ],
        },
      },
    });
    await prisma.hackathon.create({
      data: {
        id: unpublishedEventId,
        organizerId: outsiderOwnerId,
        name: 'Phase 8 unpublished event',
        isPublished: false,
        startDate: new Date(now - 60_000),
        endDate: new Date(now + 60 * 60_000),
        tracks: { create: { id: foreignTrackId, name: 'Foreign track' } },
      },
    });
    await prisma.team.create({
      data: {
        id: teamId,
        name: 'Phase 8 team',
        hackathonId: eventId,
        members: { create: { userId: memberId, role: 'admin' } },
        registrations: { create: { hackathonId: eventId, trackId } },
      },
    });
    await prisma.team.create({
      data: {
        id: soloTeamId,
        name: 'Phase 8 solo team',
        hackathonId: eventId,
        members: { create: { userId: soloId, role: 'admin' } },
      },
    });
    await prisma.team.create({
      data: {
        id: raceTeamId,
        name: 'Phase 8 registration race',
        hackathonId: eventId,
        members: { create: { userId: memberId, role: 'admin' } },
      },
    });
    await prisma.submission.create({
      data: {
        id: submissionId,
        teamId,
        hackathonId: eventId,
        trackId,
        projectName: 'Private Phase 8 final',
        description: 'Private final used to verify guessed-ID access boundaries.',
        githubUrl: 'https://github.com/example/phase8-private',
        demoUrl: 'https://example.com/phase8-private',
        walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
        finalSnapshot: { receiptVersion: 2, projectName: 'Private Phase 8 final' },
        finalizedAt: new Date(),
        receiptVersion: 2,
      },
    });
    await prisma.submissionDraft.create({
      data: {
        id: draftId,
        teamId,
        hackathonId: eventId,
        payload: { projectName: 'Private draft' },
        updatedById: memberId,
      },
    });
  }, 15_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.revokedSession.deleteMany({
        where: { userId: { in: [ownerId, outsiderOwnerId, memberId, soloId, judgeId] } },
      });
      await prisma.submission.deleteMany({ where: { id: submissionId } });
      await prisma.team.deleteMany({
        where: { id: { in: [teamId, soloTeamId, raceTeamId] } },
      });
      await prisma.hackathon.deleteMany({
        where: { id: { in: [eventId, unpublishedEventId] } },
      });
      await prisma.user.deleteMany({
        where: {
          id: { in: [ownerId, outsiderOwnerId, memberId, soloId, judgeId] },
        },
      });
    }
    if (app) await app.close();
  });

  it('rejects missing, malformed, expired and revoked JWT sessions', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);

    const expired = jwt.sign(
      {
        sub: ownerId,
        githubUsername: ownerId,
        jti: e2eFixtureId('p8-expired-jti'),
      },
      { expiresIn: -1 },
    );
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);

    const jti = e2eFixtureId('p8-revoked-jti');
    const valid = bearer(ownerId, jti);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', valid)
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', valid)
      .expect(201);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', valid)
      .expect(401);
  });

  it('blocks guessed private IDs across roster, planning, draft, final, analysis and chat', async () => {
    const solo = bearer(soloId);
    const privatePaths = [
      `/teams/${teamId}`,
      `/teams/${teamId}/members`,
      `/teams/${teamId}/planning/tasks`,
      `/submissions/draft?teamId=${teamId}&hackathonId=${eventId}`,
      `/submissions/${submissionId}`,
      `/submissions/${submissionId}/ai-analysis`,
      `/submissions/${submissionId}/ai-chat/sessions`,
      `/submissions/${submissionId}/ai-chat/sessions/guessed/messages`,
    ];
    for (const path of privatePaths) {
      const response = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', solo);
      expect([403, 404]).toContain(response.status);
      expect(JSON.stringify(response.body)).not.toContain('Private Phase 8');
    }

    await request(app.getHttpServer())
      .patch(`/hackathons/${eventId}`)
      .set('Authorization', bearer(outsiderOwnerId))
      .send({ name: 'Unauthorized rewrite' })
      .expect(403);

    await prisma.hackathonJudge.create({
      data: { hackathonId: eventId, userId: judgeId },
    });
    await prisma.hackathonJudge.delete({
      where: { hackathonId_userId: { hackathonId: eventId, userId: judgeId } },
    });
    await request(app.getHttpServer())
      .get(`/submissions/${submissionId}`)
      .set('Authorization', bearer(judgeId))
      .expect(403);
  });

  it('rejects invalid event configuration, track scope and duplicate registration without garbage records', async () => {
    const owner = bearer(ownerId);
    const member = bearer(memberId);
    const beforeCount = await prisma.hackathon.count();

    await request(app.getHttpServer())
      .post('/hackathons')
      .set('Authorization', owner)
      .send({
        name: 'Invalid dates',
        startDate: '2026-10-02T00:00:00.000Z',
        endDate: '2026-10-01T00:00:00.000Z',
      })
      .expect(400);
    expect(await prisma.hackathon.count()).toBe(beforeCount);

    await request(app.getHttpServer())
      .patch(`/hackathons/${eventId}`)
      .set('Authorization', owner)
      .send({
        rules: [
          { id: 'duplicate', name: 'One', description: 'One' },
          { id: 'duplicate', name: 'Two', description: 'Two' },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/hackathons/${eventId}`)
      .set('Authorization', owner)
      .send({
        rubric: [
          {
            id: 'a',
            name: 'A',
            description: 'A',
            weight: 0.6,
            minScore: 0,
            maxScore: 10,
          },
          {
            id: 'b',
            name: 'B',
            description: 'B',
            weight: 0.6,
            minScore: 0,
            maxScore: 10,
          },
        ],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/hackathons/${eventId}/register`)
      .set('Authorization', member)
      .send({ teamId })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/hackathons/${eventId}/register`)
      .set('Authorization', bearer(soloId))
      .send({ teamId: soloTeamId, trackId: inactiveTrackId })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/hackathons/${eventId}/register`)
      .set('Authorization', bearer(soloId))
      .send({ teamId: soloTeamId, trackId: foreignTrackId })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/hackathons/${unpublishedEventId}/register`)
      .set('Authorization', bearer(soloId))
      .send({ teamId: soloTeamId })
      .expect(400);
    await request(app.getHttpServer())
      .get(`/hackathons/${unpublishedEventId}`)
      .expect(404);

    const stored = await prisma.hackathon.findUniqueOrThrow({
      where: { id: eventId },
      select: { name: true, rules: true, rubric: true },
    });
    expect(stored).toMatchObject({ name: 'Phase 8 published event' });
    expect(stored.rules).toEqual([
      { id: 'original-rule', name: 'Original', description: 'Keep it' },
    ]);
    expect(await prisma.hackathonRegistration.count({ where: { teamId: soloTeamId } })).toBe(0);
  });

  it('turns concurrent duplicate registration into one success and one useful client error', async () => {
    const member = bearer(memberId);
    const register = () =>
      request(app.getHttpServer())
        .post(`/hackathons/${eventId}/register`)
        .set('Authorization', member)
        .send({ teamId: raceTeamId, trackId });

    const responses = await Promise.all([register(), register()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
    expect(
      await prisma.hackathonRegistration.count({
        where: { hackathonId: eventId, teamId: raceTeamId },
      }),
    ).toBe(1);
  });
});
