import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { SolanaService } from '../solana/solana.service';
import { AiQueueService } from '../ai/queue/ai-queue.service';
import { EventsGateway } from '../../events/events.gateway';
import { AccessPolicyService } from '../access/access-policy.service';

describe('SubmissionsService', () => {
  let service: SubmissionsService;
  let prisma: PrismaService;
  let solanaService: SolanaService;
  let aiQueue: AiQueueService;
  let eventsGateway: EventsGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        {
          provide: PrismaService,
          useValue: {
            submission: {
              findFirst: jest.fn(),
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            team: {
              findUnique: jest.fn(),
            },
            hackathon: {
              findUnique: jest.fn(),
            },
            hackathonRegistration: {
              findUnique: jest.fn(),
            },
            track: { findFirst: jest.fn() },
            submissionDraft: { upsert: jest.fn(), findUnique: jest.fn() },
            track: { findFirst: jest.fn() },
            aiJob: {
              findUnique: jest.fn(),
            },
          },
        },
        {
          provide: SolanaService,
          useValue: {
            mintSubmissionCredential: jest.fn(),
            getMintRecoveryState: jest.fn().mockResolvedValue(null),
            getExplorerUrl: jest.fn(),
          },
        },
        {
          provide: AiQueueService,
          useValue: {
            enqueueSubmission: jest.fn(),
          },
        },
        {
          provide: EventsGateway,
          useValue: {
            emitToTeam: jest.fn(),
            emitToHackathon: jest.fn(),
          },
        },
        {
          provide: AccessPolicyService,
          useValue: {
            requireSubmissionRead: jest.fn(),
            requireSubmissionMember: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SubmissionsService>(SubmissionsService);
    prisma = module.get<PrismaService>(PrismaService);
    solanaService = module.get<SolanaService>(SolanaService);
    aiQueue = module.get<AiQueueService>(AiQueueService);
    eventsGateway = module.get<EventsGateway>(EventsGateway);
    jest.spyOn(prisma.team, 'findUnique').mockResolvedValue({
      id: 'team-1',
      name: 'Team 1',
      hackathonId: 'hack-1',
      members: [{ userId: 'user-1' }],
    } as any);
    jest.spyOn(prisma.hackathon, 'findUnique').mockResolvedValue({
      id: 'hack-1',
      name: 'Hack 1',
      endDate: new Date(Date.now() + 86_400_000),
    } as any);
    jest
      .spyOn(prisma.hackathonRegistration, 'findUnique')
      .mockResolvedValue({ id: 'registration-1' } as any);
    jest.spyOn(prisma.submission, 'findFirst').mockResolvedValue(null);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('allows a pre-start draft without a wallet and uses the team repository as an editable default', async () => {
    jest.spyOn(prisma.team, 'findUnique').mockResolvedValue({
      id: 'team-1', hackathonId: 'hack-1', members: [{ userId: 'user-1' }], repository: { url: 'https://github.com/org/team-1' },
    } as any);
    const upsert = jest.spyOn((prisma as any).submissionDraft, 'upsert').mockResolvedValue({ id: 'draft-1' });
    await expect(service.saveDraft({ teamId: 'team-1', hackathonId: 'hack-1', projectName: 'Early idea' }, 'user-1'))
      .resolves.toEqual({ id: 'draft-1' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({
      payload: expect.objectContaining({ githubUrl: 'https://github.com/org/team-1' }),
    }) }));
  });

  it('rejects a draft for an unpublished, unregistered, or foreign team', async () => {
    const draft = { teamId: 'team-1', hackathonId: 'hack-1' };
    jest.spyOn(prisma.hackathon, 'findUnique').mockResolvedValueOnce({ id: 'hack-1', isPublished: false, endDate: new Date(Date.now() + 1_000) } as any);
    await expect(service.saveDraft(draft, 'user-1')).rejects.toThrow('not published');
    jest.spyOn(prisma.hackathonRegistration, 'findUnique').mockResolvedValueOnce(null);
    await expect(service.saveDraft(draft, 'user-1')).rejects.toThrow('not registered');
    await expect(service.saveDraft(draft, 'other-user')).rejects.toThrow(ForbiddenException);
  });

  it('rejects a draft exactly at the deadline', async () => {
    const now = new Date('2030-01-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    jest.spyOn(prisma.hackathon, 'findUnique').mockResolvedValueOnce({ id: 'hack-1', isPublished: true, endDate: now } as any);
    await expect(service.saveDraft({ teamId: 'team-1', hackathonId: 'hack-1' }, 'user-1')).rejects.toThrow('deadline');
    jest.useRealTimers();
  });

  it('validates a draft track belongs to the active hackathon', async () => {
    jest.spyOn((prisma as any).track, 'findFirst').mockResolvedValue(null);
    await expect(service.saveDraft({ teamId: 'team-1', hackathonId: 'hack-1', trackId: 'other-event-track' }, 'user-1')).rejects.toThrow('Track is not active');
  });

  it('should reject invalid wallet address', async () => {
    await expect(
      service.create({
        teamId: 'team-1',
        hackathonId: 'hack-1',
        projectName: 'Test Project',
        description: 'A test description for the project',
        githubUrl: 'https://github.com/test/repo',
        demoUrl: 'https://test.vercel.app',
        walletAddress: 'invalid',
      }, 'user-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('recovers an existing submission on retry instead of creating or minting twice', async () => {
    jest.spyOn(prisma.submission, 'findFirst').mockResolvedValue({
      id: 'existing-id',
      teamId: 'team-1',
      hackathonId: 'hack-1',
    } as any);

    await expect(
      service.create({
        teamId: 'team-1',
        hackathonId: 'hack-1',
        projectName: 'Test Project',
        description: 'A test description for the project',
        githubUrl: 'https://github.com/test/repo',
        demoUrl: 'https://test.vercel.app',
        walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      }, 'user-1'),
    ).resolves.toEqual(expect.objectContaining({ id: 'existing-id', receivedStatus: 'RECEIVED' }));
    expect(prisma.submission.create).not.toHaveBeenCalled();
  });

  it('does not overwrite the immutable final snapshot when a retry payload changes', async () => {
    const snapshot = { projectName: 'Original', receiptVersion: 1 };
    jest.spyOn(prisma.submission, 'findFirst').mockResolvedValue({ id: 'existing-id', status: 'pending_nft', createdAt: new Date(), finalSnapshot: snapshot } as any);
    await expect(service.create({ teamId: 'team-1', hackathonId: 'hack-1', projectName: 'Changed later', description: 'A test description for the project', githubUrl: 'https://github.com/test/changed', demoUrl: 'https://test.vercel.app', videoUrl: 'https://video.example.com', slidesUrl: 'https://slides.example.com', participantBlockchainEvidenceUrl: 'https://proof.example.com', walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s' } as any, 'user-1')).resolves.toEqual(expect.objectContaining({ id: 'existing-id' }));
    expect(prisma.submission.update).not.toHaveBeenCalled();
    expect(snapshot.projectName).toBe('Original');
  });

  it('rejects finalization before start and exactly at end', async () => {
    const now = new Date('2030-01-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    const payload: any = { teamId: 'team-1', hackathonId: 'hack-1', projectName: 'Project', description: 'Description long enough', githubUrl: 'https://github.com/a/b', demoUrl: 'https://demo.example.com', videoUrl: 'https://video.example.com', slidesUrl: 'https://slides.example.com', participantBlockchainEvidenceUrl: 'https://proof.example.com', walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s' };
    jest.spyOn(prisma.hackathon, 'findUnique').mockResolvedValueOnce({ id: 'hack-1', name: 'Hack', startDate: new Date('2030-01-01T00:00:01.000Z'), endDate: new Date('2030-01-02'), isPublished: true } as any);
    await expect(service.create(payload, 'user-1')).rejects.toThrow('not open');
    jest.spyOn(prisma.hackathon, 'findUnique').mockResolvedValueOnce({ id: 'hack-1', name: 'Hack', startDate: new Date('2029-12-31'), endDate: now, isPublished: true } as any);
    await expect(service.create(payload, 'user-1')).rejects.toThrow('already ended');
    jest.useRealTimers();
  });

  it('recovers the persisted ID when a concurrent create gets P2002', async () => {
    const payload: any = { teamId: 'team-1', hackathonId: 'hack-1', projectName: 'Project', description: 'Description long enough', githubUrl: 'https://github.com/a/b', demoUrl: 'https://demo.example.com', videoUrl: 'https://video.example.com', slidesUrl: 'https://slides.example.com', participantBlockchainEvidenceUrl: 'https://proof.example.com', walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s' };
    jest.spyOn(prisma.submission, 'create').mockRejectedValue(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' }));
    jest.spyOn(prisma.submission, 'findFirst').mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'race-winner', status: 'pending_nft', createdAt: new Date() } as any);
    // Exercise the public retry invariant without minting a second credential.
    await expect(service.create(payload, 'user-1')).resolves.toEqual(expect.objectContaining({ id: 'race-winner' }));
  });

  it('keeps a recoverable ID when mint or receipt status persistence fails', async () => {
    const payload: any = { teamId: 'team-1', hackathonId: 'hack-1', projectName: 'Project', description: 'Description long enough', githubUrl: 'https://github.com/a/b', demoUrl: 'https://demo.example.com', videoUrl: 'https://video.example.com', slidesUrl: 'https://slides.example.com', participantBlockchainEvidenceUrl: 'https://proof.example.com', walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s' };
    jest.spyOn(prisma.submission, 'create').mockResolvedValue({ id: 'saved-first', status: 'pending_nft', createdAt: new Date() } as any);
    jest.spyOn(solanaService, 'mintSubmissionCredential').mockRejectedValue(new Error('mint unavailable'));
    jest.spyOn(prisma.submission, 'update').mockRejectedValue(new Error('database unavailable'));
    await expect(service.create(payload, 'user-1')).resolves.toEqual(expect.objectContaining({ id: 'saved-first', mintStatus: 'FAILED' }));
  });

  it('should create submission successfully', async () => {
    jest.spyOn(prisma.submission, 'findFirst').mockResolvedValue(null);
    jest
      .spyOn(prisma.team, 'findUnique')
      .mockResolvedValue({
        id: 'team-1',
        name: 'Team 1',
        hackathonId: 'hack-1',
        members: [{ userId: 'user-1' }],
      } as any);
    jest
      .spyOn(prisma.hackathon, 'findUnique')
      .mockResolvedValue({
        id: 'hack-1',
        name: 'Hack 1',
        endDate: new Date(Date.now() + 86_400_000),
      } as any);
    jest.spyOn(prisma.submission, 'create').mockResolvedValue({
      id: 'sub-123',
      status: 'pending_nft',
      createdAt: new Date(),
    } as any);
    jest.spyOn(solanaService, 'mintSubmissionCredential').mockResolvedValue({
      signature: 'test-signature',
      assetId: 'test-asset',
    });
    jest
      .spyOn(solanaService, 'getExplorerUrl')
      .mockReturnValue('https://explorer.solana.com/tx/test-signature');
    const submissionUpdate = jest
      .spyOn(prisma.submission, 'update')
      .mockResolvedValue({} as any);
    jest.spyOn(aiQueue, 'enqueueSubmission').mockResolvedValue({
      id: 'ai-job-1',
      bullmqJobId: 'ai-f1',
      status: 'QUEUED',
    } as any);

    const result = await service.create({
      teamId: 'team-1',
      hackathonId: 'hack-1',
      projectName: 'Test Project',
      description: 'A test description for the project',
      githubUrl: 'https://github.com/test/repo',
      demoUrl: 'https://test.vercel.app',
      walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
    }, 'user-1');

    expect(result.status).toBe('confirmed');
    expect(result.id).toBeDefined();
    expect(result.aiAnalysisStatus).toBe('queued');
    expect(submissionUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: 'sub-123' },
        data: {
          transactionSignature: 'test-signature',
          nftAssetId: 'test-asset',
          status: 'confirmed',
          mintStatus: 'CONFIRMED',
      },
    });
    expect(submissionUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'sub-123' },
      data: { aiAnalysisJobId: 'ai-job-1', aiStatus: 'QUEUED' },
    });
  });

  it('keeps a confirmed submission successful when queueing fails', async () => {
    jest.spyOn(prisma.submission, 'findFirst').mockResolvedValue(null);
    jest
      .spyOn(prisma.team, 'findUnique')
      .mockResolvedValue({
        id: 'team-1',
        name: 'Team 1',
        hackathonId: 'hack-1',
        members: [{ userId: 'user-1' }],
      } as any);
    jest
      .spyOn(prisma.hackathon, 'findUnique')
      .mockResolvedValue({
        id: 'hack-1',
        name: 'Hack 1',
        endDate: new Date(Date.now() + 86_400_000),
      } as any);
    jest.spyOn(prisma.submission, 'create').mockResolvedValue({
      id: 'sub-123',
      status: 'pending_nft',
      createdAt: new Date(),
    } as any);
    jest
      .spyOn(solanaService, 'mintSubmissionCredential')
      .mockResolvedValue({ signature: 'signature', assetId: 'asset' });
    jest.spyOn(prisma.submission, 'update').mockResolvedValue({} as any);
    jest
      .spyOn(aiQueue, 'enqueueSubmission')
      .mockRejectedValue(new Error('Redis unavailable'));

    const result = await service.create({
      teamId: 'team-1',
      hackathonId: 'hack-1',
      projectName: 'Test Project',
      description: 'A test description for the project',
      githubUrl: 'https://github.com/test/repo',
      demoUrl: 'https://test.vercel.app',
      walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
    }, 'user-1');

    expect(result.status).toBe('confirmed');
    expect(result.aiAnalysisStatus).toBe('not_queued');
  });

  it('does not emit a mint failure or demote a confirmed proof when post-mint delivery fails', async () => {
    jest.spyOn(prisma.submission, 'create').mockResolvedValue({ id: 'sub-post-mint', status: 'pending_nft', createdAt: new Date() } as any);
    jest.spyOn(solanaService, 'mintSubmissionCredential').mockResolvedValue({ signature: 'signature', assetId: 'asset' });
    jest.spyOn(solanaService, 'getMintRecoveryState').mockResolvedValue({ status: 'confirmed', signature: 'signature', nftAssetId: 'asset' } as any);
    jest.spyOn(prisma.submission, 'update').mockResolvedValue({} as any);
    jest.spyOn(aiQueue, 'enqueueSubmission').mockRejectedValue(new Error('AI unavailable'));
    jest.spyOn(eventsGateway, 'emitToTeam').mockImplementation(() => { throw new Error('socket unavailable'); });

    const result = await service.create({
      teamId: 'team-1', hackathonId: 'hack-1', projectName: 'Project', description: 'Description long enough',
      githubUrl: 'https://github.com/test/repo', demoUrl: 'https://demo.example.com',
      walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
    } as any, 'user-1');

    expect(result).toEqual(expect.objectContaining({ status: 'confirmed', mintStatus: 'CONFIRMED', aiAnalysisStatus: 'not_queued' }));
    expect((prisma.submission.update as jest.Mock).mock.calls.some((call) => call[0].data.status === 'nft_failed')).toBe(false);
    expect((eventsGateway.emitToTeam as jest.Mock).mock.calls.some((call) => call[1] === 'submission:nft-failed')).toBe(false);
  });

  it('rejects a submission from a user outside the team', async () => {
    await expect(
      service.create(
        {
          teamId: 'team-1',
          hackathonId: 'hack-1',
          projectName: 'Test Project',
          description: 'A test description for the project',
          githubUrl: 'https://github.com/test/repo',
          demoUrl: 'https://test.vercel.app',
          walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
        },
        'outsider',
      ),
    ).rejects.toThrow('You are not a member of this team');
    expect(prisma.submission.create).not.toHaveBeenCalled();
  });

  it.each(['inactive-track', 'track-from-another-hackathon'])(
    'rejects a submission using an inactive or cross-event track (%s)',
    async (trackId) => {
      jest.spyOn(prisma.hackathon, 'findUnique').mockResolvedValue({
        id: 'hack-1', name: 'Hack 1', startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 86_400_000),
      } as any);
      jest.spyOn((prisma as any).track, 'findFirst').mockResolvedValue(null);

      await expect(service.create({
        teamId: 'team-1', hackathonId: 'hack-1', trackId,
        projectName: 'Test Project', description: 'A test description for the project',
        githubUrl: 'https://github.com/test/repo', demoUrl: 'https://test.vercel.app',
        walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      } as any, 'user-1')).rejects.toThrow('Track is not active for this hackathon');

      expect((prisma as any).track.findFirst).toHaveBeenCalledWith({
        where: { id: trackId, hackathonId: 'hack-1', isActive: true },
      });
      expect(prisma.submission.create).not.toHaveBeenCalled();
    },
  );

  it('keeps legacy no-track final submission callers compatible', async () => {
    jest.spyOn(prisma.hackathon, 'findUnique').mockResolvedValue({
      id: 'hack-1', name: 'Hack 1', startDate: new Date(Date.now() - 60_000), endDate: new Date(Date.now() + 86_400_000),
    } as any);
    jest.spyOn(prisma.hackathonRegistration, 'findUnique').mockResolvedValue({ id: 'registration-1', trackId: null } as any);
    jest.spyOn(prisma.submission, 'create').mockResolvedValue({ id: 'sub-legacy', createdAt: new Date() } as any);
    jest.spyOn(solanaService, 'mintSubmissionCredential').mockResolvedValue({ signature: 'signature', assetId: 'asset' });
    jest.spyOn(solanaService, 'getExplorerUrl').mockReturnValue('https://explorer.solana.com/tx/signature');
    jest.spyOn(prisma.submission, 'update').mockResolvedValue({} as any);
    jest.spyOn(aiQueue, 'enqueueSubmission').mockResolvedValue({ id: 'ai-job', bullmqJobId: 'ai-1', status: 'QUEUED' } as any);

    await expect(service.create({
      teamId: 'team-1', hackathonId: 'hack-1', projectName: 'Legacy project',
      description: 'A legacy-compatible submission description', githubUrl: 'https://github.com/test/repo',
      demoUrl: 'https://test.vercel.app', walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
    } as any, 'user-1')).resolves.toEqual(expect.objectContaining({ id: 'sub-legacy', status: 'confirmed' }));
    expect((prisma as any).track.findFirst).not.toHaveBeenCalled();
  });

  it('returns persisted AI status and structured results', async () => {
    jest.spyOn(prisma.submission, 'findUnique').mockResolvedValue({
      aiAnalysisJobId: 'ai-job-1',
      aiAnalysisCompleted: true,
    } as any);
    jest.spyOn(prisma.aiJob, 'findUnique').mockResolvedValue({
      id: 'ai-job-1',
      bullmqJobId: 'ai-queue-1',
      status: 'COMPLETED',
      attempts: 1,
      maxAttempts: 3,
      queuedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
      analysis: {
        id: 'analysis-1',
        architectureVersion: 'ai-orchestrator-v1',
        analysisVersion: 'analysis-v1',
        promptVersion: 'submission-analysis-v1',
        schemaVersion: '1.0',
        provider: 'omniroute',
        protocol: 'anthropic',
        requestedModel: 'azync-analysis-v1',
        resolvedModel: 'claude-sonnet-4.5',
        output: { summary: {} },
        validationReport: { valid: true },
        inputTokens: 10,
        outputTokens: 20,
        latencyMs: 100,
        costUsd: null,
        createdAt: new Date(),
      },
    } as any);

    const result = await service.getAiAnalysisStatus('sub-123');

    expect(result.status).toBe('completed');
    expect(result.completed).toBe(true);
    expect(result.results?.id).toBe('analysis-1');
  });

  it('re-reads the completion marker when the worker commit lands between status reads', async () => {
    jest
      .spyOn(prisma.submission, 'findUnique')
      .mockResolvedValueOnce({
        aiAnalysisJobId: 'ai-job-race',
        aiAnalysisCompleted: false,
      } as any)
      .mockResolvedValueOnce({
        aiAnalysisJobId: 'ai-job-race',
        aiAnalysisCompleted: true,
      } as any);
    jest.spyOn(prisma.aiJob, 'findUnique').mockResolvedValue({
      id: 'ai-job-race',
      status: 'COMPLETED',
      attempts: 1,
      maxAttempts: 3,
      analysis: {
        id: 'analysis-race',
        architectureVersion: 'ai-orchestrator-v1',
        analysisVersion: 'analysis-v1',
        promptVersion: 'submission-analysis-v1',
        schemaVersion: '1.0',
        provider: 'omniroute',
        protocol: 'anthropic',
        requestedModel: 'azync-analysis-v1',
        resolvedModel: 'deterministic-test-model',
        output: { summary: {} },
      },
    } as any);

    const result = await service.getAiAnalysisStatus('sub-race');

    expect(result.completed).toBe(true);
    expect(result.results?.id).toBe('analysis-race');
    expect(prisma.submission.findUnique).toHaveBeenCalledTimes(2);
  });

  it('should throw NotFoundException when submission not found', async () => {
    jest.spyOn(prisma.submission, 'findUnique').mockResolvedValue(null);

    await expect(service.findOne('non-existent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('serializes every Solana BigInt without leaking one into HTTP responses', async () => {
    jest.spyOn(prisma.submission, 'findUnique').mockResolvedValue({
      id: 'sub-123',
      transactionSignature: 'signature',
      solanaTransaction: { id: 'tx-1', leafIndex: 17n, slot: 1234567890123456789n, lastValidBlockHeight: 491156990n },
      aiAnalyses: [],
    } as any);

    const result = await service.findOne('sub-123');

    expect(result.solanaTransaction?.slot).toBe('1234567890123456789');
    expect(result.solanaTransaction?.leafIndex).toBe('17');
    expect(result.solanaTransaction?.lastValidBlockHeight).toBe('491156990');
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
