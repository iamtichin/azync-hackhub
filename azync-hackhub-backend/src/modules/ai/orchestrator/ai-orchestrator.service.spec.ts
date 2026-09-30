import type { Evidence } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AiConfigService } from '../config/ai-config.service';
import type { EvidenceService } from '../evidence/evidence.service';
import type { AIProvider } from '../providers/ai-provider.interface';
import { AnalysisBusinessValidator } from '../validation/analysis-business.validator';
import { AiOrchestratorService } from './ai-orchestrator.service';
import type { AiContextService } from '../context/ai-context.service';

describe('AiOrchestratorService', () => {
  it('repairs invalid output once and atomically completes the job', async () => {
    const output = JSON.stringify({
      summary: {
        problem: 'Hackathon review currently takes too much manual effort.',
        solution: 'The project supplies an evidence-backed review assistant.',
        targetUsers: 'Hackathon judges',
      },
      technologies: ['TypeScript'],
      requirements: [
        {
          requirementId: 'public-repository',
          status: 'PASS',
          confidence: 0.9,
          reason: 'The immutable GitHub snapshot is publicly accessible.',
          evidenceIds: ['evidence-1'],
        },
      ],
      rubricAnalysis: [
        {
          rubricId: 'technical-execution',
          suggestedScore: 8,
          confidence: 0.8,
          reason: 'The repository snapshot supports the implementation claim.',
          evidenceIds: ['evidence-1'],
        },
      ],
      concerns: [],
      judgeQuestions: [],
    });
    const providerAnalyze = jest
      .fn()
      .mockResolvedValueOnce({ text: 'not-json' })
      .mockResolvedValueOnce({
        text: output,
        provider: 'omniroute',
        protocol: 'anthropic',
        requestedModel: 'azync-analysis-v1',
        resolvedModel: 'claude-sonnet-4.5',
        inputTokens: 100,
        outputTokens: 200,
        latencyMs: 500,
        costUsd: null,
        gatewayCorrelationId: 'correlation-1',
        gatewaySessionId: 'session-1',
        selectedConnectionId: 'connection-1',
      });
    const provider = {
      analyze: providerAnalyze,
    } as unknown as AIProvider;
    const evidence = {
      id: 'evidence-1',
      type: 'GITHUB_REPOSITORY',
      status: 'VERIFIED',
      source: 'github_api',
      reference: 'https://github.com/example/project/tree/commit',
      facts: { commit: 'commit' },
      contentHash: 'hash',
      collectedAt: new Date('2026-09-04T00:00:00.000Z'),
    } as unknown as Evidence;
    let analysisUpsertArgument: unknown;
    let jobUpdateArgument: unknown;
    const analysisUpsert = jest.fn((argument: unknown) => {
      analysisUpsertArgument = argument;
      return Promise.resolve({ id: 'analysis-1' });
    });
    const jobUpdate = jest.fn((argument: unknown) => {
      jobUpdateArgument = argument;
      return Promise.resolve({});
    });
    const tx = {
      aiAnalysis: {
        upsert: analysisUpsert,
      },
      aiAnalysisEvidence: { createMany: jest.fn().mockResolvedValue({}) },
      aiContextSnapshot: { update: jest.fn().mockResolvedValue({}) },
      aiContextSession: { update: jest.fn().mockResolvedValue({}) },
      aiJob: { update: jobUpdate },
      submission: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      aiJob: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'job-1',
          submissionId: 'submission-1',
          status: 'QUEUED',
          startedAt: null,
          analysis: null,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      submission: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'submission-1',
          projectName: 'Project',
          description: 'An evidence-backed submission review assistant.',
          githubUrl: 'https://github.com/example/project',
          demoUrl: 'https://example.com',
          videoUrl: null,
          walletAddress: 'wallet',
          transactionSignature: null,
          nftAssetId: null,
          aiAnalyses: [],
          hackathon: {
            rules: [
              {
                id: 'public-repository',
                name: 'Public repository',
                description: 'Repository must be public.',
              },
            ],
            rubric: [
              {
                id: 'technical-execution',
                name: 'Technical execution',
                description: 'Quality of implementation.',
                weight: 1,
                minScore: 0,
                maxScore: 10,
              },
            ],
          },
        }),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const config = {
      readiness: jest.fn().mockReturnValue({ ready: true, missing: [] }),
    } as unknown as AiConfigService;
    const evidenceService = {
      collect: jest.fn().mockResolvedValue({
        evidence: [evidence],
        repositoryData: {
          readme: null,
          packageManifest: null,
          selectedSourceExcerpts: [],
        },
        artifacts: [],
        collectionMode: 'FULL',
      }),
    } as unknown as EvidenceService;
    const contextService = {
      prepare: jest.fn().mockResolvedValue({
        id: 'context-snapshot-1',
        refreshMode: 'FULL',
        changeManifest: {},
      }),
    } as unknown as AiContextService;
    const service = new AiOrchestratorService(
      prisma,
      config,
      evidenceService,
      contextService,
      new AnalysisBusinessValidator(),
      provider,
    );

    await expect(
      service.processJob({
        aiJobId: 'job-1',
        submissionId: 'submission-1',
        requestFingerprint: 'a'.repeat(64),
        sourceRevision: 'commit-1',
      }),
    ).resolves.toBe('analysis-1');

    expect(providerAnalyze).toHaveBeenCalledTimes(2);
    expect(analysisUpsert).toHaveBeenCalledTimes(1);
    expect(analysisUpsertArgument).toMatchObject({
      create: {
        validationReport: { valid: true, repairAttempted: true },
      },
    });
    expect(tx.aiAnalysisEvidence.createMany).toHaveBeenCalledWith({
      data: [{ analysisId: 'analysis-1', evidenceId: 'evidence-1' }],
      skipDuplicates: true,
    });
    expect(jobUpdate).toHaveBeenCalledTimes(1);
    expect(jobUpdateArgument).toMatchObject({
      data: { status: 'COMPLETED' },
    });
    expect(tx.submission.update).toHaveBeenCalledWith({
      where: { id: 'submission-1' },
      data: {
        aiAnalysisCompleted: true,
        aiAnalysisJobId: 'job-1',
        aiStatus: 'COMPLETED',
      },
    });
  });

  it.each([
    [true, 'RETRYING'],
    [false, 'FAILED'],
  ])('keeps the submission status aligned when recordFailure retrying=%s', async (retrying, aiStatus) => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      aiJob: {
        update: jest.fn().mockResolvedValue({ submissionId: 'submission-1' }),
      },
      submission: { updateMany },
    } as unknown as PrismaService;
    const service = new AiOrchestratorService(
      prisma,
      {} as AiConfigService,
      {} as EvidenceService,
      {} as AiContextService,
      new AnalysisBusinessValidator(),
      {} as AIProvider,
    );

    await service.recordFailure('job-1', 'PROVIDER_UNAVAILABLE', 'Unavailable', retrying);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'submission-1', aiAnalysisJobId: 'job-1' },
      data: { aiStatus },
    });
  });
});
