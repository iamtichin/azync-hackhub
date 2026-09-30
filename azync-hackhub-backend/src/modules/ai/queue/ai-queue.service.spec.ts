import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AnalyzeSubmissionJobData } from '../ai-queue.constants';
import { AiQueueService } from './ai-queue.service';
import type { GitHubEvidenceCollector } from '../evidence/github-evidence.collector';
import type { SolanaEvidenceCollector } from '../evidence/solana-evidence.collector';

describe('AiQueueService', () => {
  it('creates a deterministic DB job and enqueues only identifiers', async () => {
    const submission = {
      id: 'submission-1',
      projectName: 'Project',
      description: 'Description',
      githubUrl: 'https://github.com/a/b',
      demoUrl: 'https://example.com',
      videoUrl: null,
      transactionSignature: 'signature',
      walletAddress: 'wallet',
      hackathon: { rulesVersion: 'rules-v1', rubricVersion: 'rubric-v1' },
    };
    const storedJob = {
      id: 'job-1',
      submissionId: submission.id,
      status: 'QUEUED',
    };
    const prisma = {
      submission: { findUnique: jest.fn().mockResolvedValue(submission) },
      aiJob: {
        upsert: jest.fn((args) =>
          Promise.resolve({ ...storedJob, bullmqJobId: args.create.bullmqJobId }),
        ),
        update: jest.fn().mockResolvedValue(storedJob),
      },
    } as unknown as PrismaService;
    let enqueued:
      | {
          name: string;
          payload: AnalyzeSubmissionJobData;
          options: { jobId: string };
        }
      | undefined;
    const queueAdd = jest.fn(
      (
        name: string,
        payload: AnalyzeSubmissionJobData,
        options: { jobId: string },
      ) => {
        enqueued = { name, payload, options };
        return Promise.resolve({ id: 'bull-job' });
      },
    );
    const queue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: queueAdd,
    } as unknown as Queue<AnalyzeSubmissionJobData>;
    const config = {
      get: jest.fn().mockReturnValue('3'),
    } as unknown as ConfigService;
    const github = {
      resolveHeadRevision: jest.fn().mockResolvedValue('commit-abc'),
    } as unknown as GitHubEvidenceCollector;
    const solana = {
      resolveFinalityRevision: jest.fn().mockResolvedValue('devnet:signature:finalized:OK'),
    } as unknown as SolanaEvidenceCollector;
    const service = new AiQueueService(prisma, config, github, solana, queue);

    await service.enqueueSubmission(submission.id);

    expect(enqueued).toBeDefined();
    if (!enqueued) throw new Error('Queue was not called');
    expect(enqueued.name).toBe('analyze-submission');
    expect(Object.keys(enqueued.payload).sort()).toEqual([
      'aiJobId',
      'requestFingerprint',
      'sourceRevision',
      'submissionId',
    ]);
    expect(enqueued.payload.requestFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(enqueued.options.jobId).toMatch(/^ai-[a-f0-9]{64}$/);
    expect(JSON.stringify(enqueued.payload)).not.toContain('Description');
    expect(enqueued.payload.sourceRevision).toBe('commit-abc');
    expect(prisma.aiJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ sourceRevision: 'commit-abc' }),
      }),
    );
  });

  it('changes the fingerprint when the repository HEAD changes', async () => {
    const fingerprints: string[] = [];
    const prisma = {
      submission: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'submission-1',
          projectName: 'P',
          description: 'D',
          githubUrl: 'https://github.com/a/b',
          demoUrl: 'https://example.com',
          videoUrl: null,
          transactionSignature: null,
          walletAddress: 'wallet',
          hackathon: { rulesVersion: 'r1', rubricVersion: 'u1' },
        }),
      },
      aiJob: {
        upsert: jest.fn((arg) => {
          fingerprints.push(arg.create.requestFingerprint);
          return Promise.resolve({
            id: `job-${fingerprints.length}`,
            status: 'QUEUED',
            bullmqJobId: arg.create.bullmqJobId,
          });
        }),
        update: jest.fn().mockResolvedValue({ id: 'job', status: 'QUEUED' }),
      },
    } as unknown as PrismaService;
    const queue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest.fn().mockResolvedValue({}),
    } as unknown as Queue<AnalyzeSubmissionJobData>;
    const config = {
      get: jest.fn().mockReturnValue('3'),
    } as unknown as ConfigService;
    const github = {
      resolveHeadRevision: jest
        .fn()
        .mockResolvedValueOnce('commit-a')
        .mockResolvedValueOnce('commit-b'),
    } as unknown as GitHubEvidenceCollector;
    const solana = {
      resolveFinalityRevision: jest.fn().mockResolvedValue(null),
    } as unknown as SolanaEvidenceCollector;
    const service = new AiQueueService(prisma, config, github, solana, queue);
    await service.enqueueSubmission('submission-1');
    await service.enqueueSubmission('submission-1');
    expect(fingerprints[0]).not.toBe(fingerprints[1]);
  });

  it('changes the fingerprint when credential finality changes without a GitHub commit', async () => {
    const fingerprints: string[] = [];
    const submission = {
      id: 'submission-1', teamId: 'team-1', hackathonId: 'hack-1', trackId: 'track-1',
      projectName: 'P', description: 'D', githubUrl: 'https://github.com/a/b',
      demoUrl: 'https://example.com', videoUrl: 'https://video.example.com',
      slidesUrl: 'https://slides.example.com', participantBlockchainEvidenceUrl: 'https://explorer.solana.com/tx/project',
      transactionSignature: 'signature', nftAssetId: 'asset', walletAddress: 'wallet', finalSnapshot: { receiptVersion: 1 },
      hackathon: { rulesVersion: 'r1', rubricVersion: 'u1' },
    };
    const prisma = {
      submission: { findUnique: jest.fn().mockResolvedValue(submission) },
      aiJob: {
        upsert: jest.fn((arg) => {
          fingerprints.push(arg.create.requestFingerprint);
          return Promise.resolve({ id: `job-${fingerprints.length}`, status: 'QUEUED', bullmqJobId: arg.create.bullmqJobId });
        }),
        update: jest.fn().mockResolvedValue({ status: 'QUEUED' }),
      },
    } as unknown as PrismaService;
    const queue = { getJob: jest.fn().mockResolvedValue(undefined), add: jest.fn().mockResolvedValue({}) } as unknown as Queue<AnalyzeSubmissionJobData>;
    const github = { resolveHeadRevision: jest.fn().mockResolvedValue('commit-unchanged') } as unknown as GitHubEvidenceCollector;
    const solana = {
      resolveFinalityRevision: jest.fn().mockResolvedValueOnce('devnet:signature:confirmed:OK').mockResolvedValueOnce('devnet:signature:finalized:OK'),
    } as unknown as SolanaEvidenceCollector;
    const config = { get: jest.fn().mockReturnValue('3') } as unknown as ConfigService;
    const service = new AiQueueService(prisma, config, github, solana, queue);

    await service.enqueueSubmission('submission-1');
    await service.enqueueSubmission('submission-1');

    expect(fingerprints[0]).not.toBe(fingerprints[1]);
  });

  it.each(['QUEUED', 'PROCESSING', 'RETRYING'])(
    'reconciles a stale %s DB job with a retained BullMQ failure',
    async (status) => {
    const submission = {
      id: 'submission-1', teamId: 'team-1', hackathonId: 'hack-1', trackId: null,
      projectName: 'P', description: 'D', githubUrl: 'https://github.com/a/b',
      demoUrl: 'https://example.com', videoUrl: null, slidesUrl: null,
      participantBlockchainEvidenceUrl: null, transactionSignature: null,
      nftAssetId: null, walletAddress: 'wallet', finalSnapshot: { version: 1 },
      hackathon: { rulesVersion: 'r1', rubricVersion: 'u1' },
    };
    const failedJob = { id: 'job-1', bullmqJobId: 'ai-retained', status };
    const prisma = {
      submission: { findUnique: jest.fn().mockResolvedValue(submission) },
      aiJob: {
        upsert: jest.fn().mockResolvedValue(failedJob),
        update: jest.fn().mockResolvedValue({ ...failedJob, status: 'QUEUED' }),
      },
    } as unknown as PrismaService;
    const retained = { getState: jest.fn().mockResolvedValue('failed'), remove: jest.fn().mockResolvedValue(undefined) };
    const queue = {
      getJob: jest.fn().mockResolvedValue(retained),
      add: jest.fn().mockResolvedValue({ id: 'ai-retained' }),
    } as unknown as Queue<AnalyzeSubmissionJobData>;
    const github = { resolveHeadRevision: jest.fn().mockResolvedValue('commit-a') } as unknown as GitHubEvidenceCollector;
    const solana = { resolveFinalityRevision: jest.fn().mockResolvedValue(null) } as unknown as SolanaEvidenceCollector;
    const config = { get: jest.fn().mockReturnValue('3') } as unknown as ConfigService;

    await new AiQueueService(prisma, config, github, solana, queue).enqueueSubmission('submission-1');

    expect(retained.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'analyze-submission',
      expect.any(Object),
      expect.objectContaining({ jobId: 'ai-retained', attempts: 3 }),
    );
    expect(prisma.aiJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'QUEUED',
        attempts: 0,
        startedAt: null,
        completedAt: null,
        failedAt: null,
      }),
    }));
    },
  );

  it.each(['QUEUED', 'FAILED'])(
    'requires reconciliation rather than returning or requeueing a %s DB job with a completed BullMQ job',
    async (status) => {
      const submission = {
        id: 'submission-1', teamId: 'team-1', hackathonId: 'hack-1', trackId: null,
        projectName: 'P', description: 'D', githubUrl: 'https://github.com/a/b',
        demoUrl: 'https://example.com', videoUrl: null, slidesUrl: null,
        participantBlockchainEvidenceUrl: null, transactionSignature: null,
        nftAssetId: null, walletAddress: 'wallet', finalSnapshot: null,
        hackathon: { rulesVersion: 'r1', rubricVersion: 'u1' },
      };
      const aiJob = { id: 'job-1', bullmqJobId: 'ai-retained', status };
      const prisma = {
        submission: { findUnique: jest.fn().mockResolvedValue(submission) },
        aiJob: { upsert: jest.fn().mockResolvedValue(aiJob), update: jest.fn() },
      } as unknown as PrismaService;
      const retained = { getState: jest.fn().mockResolvedValue('completed'), remove: jest.fn() };
      const queue = {
        getJob: jest.fn().mockResolvedValue(retained), add: jest.fn(),
      } as unknown as Queue<AnalyzeSubmissionJobData>;
      const github = { resolveHeadRevision: jest.fn().mockResolvedValue('commit-a') } as unknown as GitHubEvidenceCollector;
      const solana = { resolveFinalityRevision: jest.fn().mockResolvedValue(null) } as unknown as SolanaEvidenceCollector;
      const config = { get: jest.fn().mockReturnValue('3') } as unknown as ConfigService;

      await expect(
        new AiQueueService(prisma, config, github, solana, queue).enqueueSubmission('submission-1'),
      ).rejects.toMatchObject({ code: 'JOB_STATE_RECONCILIATION_REQUIRED', repairable: true });
      expect(retained.remove).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
      expect(prisma.aiJob.update).not.toHaveBeenCalled();
    },
  );
});
