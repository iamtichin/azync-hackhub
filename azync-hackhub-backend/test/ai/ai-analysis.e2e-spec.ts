import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { AiConfigService } from '../../src/modules/ai/config/ai-config.service';
import { AI_PROVIDER } from '../../src/modules/ai/constants/ai.constants';
import { DemoEvidenceCollector } from '../../src/modules/ai/evidence/demo-evidence.collector';
import type { EvidenceDraft } from '../../src/modules/ai/evidence/evidence.types';
import { GitHubEvidenceCollector } from '../../src/modules/ai/evidence/github-evidence.collector';
import { SolanaEvidenceCollector } from '../../src/modules/ai/evidence/solana-evidence.collector';
import type {
  AIProvider,
  AIProviderRequest,
  AIProviderResult,
} from '../../src/modules/ai/providers/ai-provider.interface';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { SolanaService } from '../../src/modules/solana/solana.service';
import { e2eFixtureId } from '../support/e2e-environment';

const githubEvidence: EvidenceDraft = {
  type: 'GITHUB_REPOSITORY',
  source: 'github_api',
  status: 'VERIFIED',
  reference: 'https://github.com/example/azync-test',
  sourceRevision: '0123456789abcdef',
  locator: { owner: 'example', repo: 'azync-test' },
  facts: { public: true, commitSha: '0123456789abcdef' },
  contentHash: 'a'.repeat(64),
  errorCode: null,
  expiresAt: null,
};

function verifiedEvidenceId(prompt: string): string {
  const match = prompt.match(
    /<verified_evidence>([\s\S]*?)<\/verified_evidence>/,
  );
  if (!match) throw new Error('Verified evidence context was not supplied');
  const parsed: unknown = JSON.parse(match[1]);
  if (!Array.isArray(parsed)) throw new Error('Evidence context is invalid');
  const verified = parsed.find(
    (item): item is Record<string, unknown> =>
      item !== null &&
      typeof item === 'object' &&
      (item as Record<string, unknown>).status === 'VERIFIED',
  );
  if (!verified || typeof verified.id !== 'string') {
    throw new Error('No verified evidence ID was supplied');
  }
  return verified.id;
}

class DeterministicAiProvider implements AIProvider {
  analyze(input: AIProviderRequest): Promise<AIProviderResult> {
    const evidenceId = verifiedEvidenceId(input.userPrompt);
    return Promise.resolve({
      text: JSON.stringify({
        summary: {
          problem: 'Hackathon submissions require consistent manual review.',
          solution: 'Azync provides an evidence-backed analysis workflow.',
          targetUsers: 'Hackathon judges',
        },
        technologies: ['TypeScript', 'Solana'],
        requirements: [
          {
            requirementId: 'public-repository',
            status: 'PASS',
            confidence: 0.95,
            reason:
              'The immutable GitHub evidence confirms a public repository.',
            evidenceIds: [evidenceId],
          },
        ],
        rubricAnalysis: [
          {
            rubricId: 'technical-execution',
            suggestedScore: 8,
            confidence: 0.85,
            reason:
              'The repository snapshot supports the implementation claim.',
            evidenceIds: [evidenceId],
          },
        ],
        concerns: [],
        judgeQuestions: [
          'Can the team demonstrate the complete judge workflow?',
        ],
      }),
      provider: 'omniroute',
      protocol: 'anthropic',
      requestedModel: 'azync-analysis-v1',
      resolvedModel: 'deterministic-test-model',
      inputTokens: 100,
      outputTokens: 80,
      latencyMs: 5,
      costUsd: 0,
      gatewayCorrelationId: 'e2e-correlation',
      gatewaySessionId: input.jobId,
      selectedConnectionId: 'e2e-provider',
    });
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

describe('AI analysis flow (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const hackathonId = e2eFixtureId('hack-ai-e2e');
  const trackId = e2eFixtureId('track-ai-e2e');
  const teamId = e2eFixtureId('team-ai-e2e');
  const userId = e2eFixtureId('user-ai-e2e');
  let submissionId: string | undefined;

  beforeAll(async () => {
    try {
      const github = {
        resolveHeadRevision: jest.fn().mockResolvedValue('e2e-head-revision'),
        collect: jest.fn().mockResolvedValue({
          records: [githubEvidence],
          repositoryData: {
            readme: {
              path: 'README.md',
              text: '# Azync deterministic E2E fixture',
              truncated: false,
            },
            packageManifest: { dependencies: { typescript: '^5' } },
            selectedSourceExcerpts: [],
          },
        }),
      };
      const solana = {
        resolveFinalityRevision: jest.fn().mockResolvedValue(null),
        collect: jest.fn().mockResolvedValue([
          {
            ...githubEvidence,
            type: 'SOLANA_TRANSACTION',
            source: 'solana_rpc',
            status: 'UNAVAILABLE',
            reference: 'test-signature',
            contentHash: null,
            errorCode: 'NOT_FOUND',
          } satisfies EvidenceDraft,
        ]),
      };
      const demo = {
        collect: jest.fn().mockResolvedValue({
          ...githubEvidence,
          type: 'DEMO_URL',
          source: 'http_probe',
          reference: 'https://example.com',
        } satisfies EvidenceDraft),
      };
      const solanaService = {
        mintSubmissionCredential: jest.fn().mockResolvedValue({
          signature: 'test-signature',
          assetId: 'test-asset',
        }),
        getExplorerUrl: jest.fn(
          (signature: string) => `https://explorer.test/tx/${signature}`,
        ),
      };

      const module: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(SolanaService)
        .useValue(solanaService)
        .overrideProvider(AI_PROVIDER)
        .useValue(new DeterministicAiProvider())
        .overrideProvider(AiConfigService)
        .useValue({ readiness: () => ({ ready: true, missing: [] }) })
        .overrideProvider(GitHubEvidenceCollector)
        .useValue(github)
        .overrideProvider(SolanaEvidenceCollector)
        .useValue(solana)
        .overrideProvider(DemoEvidenceCollector)
        .useValue(demo)
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: {
            switchToHttp: () => { getRequest: () => { user?: { id: string } } };
          }) => {
            context.switchToHttp().getRequest().user = { id: userId };
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
      await prisma.submission.deleteMany({
        where: { teamId },
      });
      await prisma.team.deleteMany({
        where: { id: teamId },
      });
      await prisma.hackathon.deleteMany({
        where: { id: hackathonId },
      });
      await prisma.user.deleteMany({
        where: { id: userId },
      });
      await prisma.user.create({
        data: {
          id: userId,
          githubId: e2eFixtureId('github-ai-e2e'),
          githubUsername: e2eFixtureId('username-ai-e2e'),
          name: 'AI E2E User',
        },
      });
      await prisma.hackathon.create({
        data: {
          id: hackathonId,
          name: 'AI E2E Hackathon',
          isPublished: true,
          startDate: new Date('2026-09-01'),
          endDate: new Date('2026-09-30'),
          tracks: { create: { id: trackId, name: 'AI' } },
          rules: [
            {
              id: 'public-repository',
              name: 'Public repository',
              description: 'The source repository must be publicly verifiable.',
            },
          ],
          rubric: [
            {
              id: 'technical-execution',
              name: 'Technical execution',
              description: 'Quality and completeness of implementation.',
              weight: 1,
              minScore: 0,
              maxScore: 10,
            },
          ],
        },
      });
      await prisma.team.create({
        data: {
          id: teamId,
          name: 'AI E2E Team',
          hackathonId,
          members: { create: { userId, role: 'admin' } },
          registrations: { create: { hackathonId } },
        },
      });
    } catch (error) {
      if (app) await app.close();
      throw error;
    }
  }, 60_000);

  afterAll(async () => {
    try {
      if (prisma) {
        await prisma.submission.deleteMany({ where: { teamId } });
        await prisma.team.deleteMany({ where: { id: teamId } });
        await prisma.hackathon.deleteMany({ where: { id: hackathonId } });
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    } finally {
      if (app) await app.close();
    }
  }, 30_000);

  it('creates, queues, processes, persists, and serves an analysis', async () => {
    const created = await request(app.getHttpServer())
      .post('/submissions')
      .send({
          teamId,
          hackathonId,
          trackId,
          projectName: 'Azync E2E Project',
          description: 'A deterministic end-to-end AI analysis test submission.',
          githubUrl: 'https://github.com/example/azync-test',
          demoUrl: 'https://example.com',
          videoUrl: 'https://example.com/demo-video',
          slidesUrl: 'https://example.com/slides',
          participantBlockchainEvidenceUrl: 'https://example.com/blockchain-evidence',
        walletAddress: '7EqQdEUwTCgDiseM8LxrfZgq8Y8pT8h1C3L2tK9X8t3s',
      })
      .expect(201);
    const createdBody = created.body as Record<string, unknown>;
    expect(typeof createdBody.id).toBe('string');
    submissionId = String(createdBody.id);
    expect(createdBody.aiAnalysisStatus).toBe('queued');

    let statusBody: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const status = await request(app.getHttpServer())
        .get(`/submissions/${submissionId}/ai-analysis`)
        .expect(200);
      statusBody = status.body as Record<string, unknown>;
      if (statusBody.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(statusBody.status).toBe('completed');
    expect(statusBody.completed).toBe(true);
    const results = statusBody.results as Record<string, unknown>;
    expect(results.provider).toBe('omniroute');
    const output = results.output as Record<string, unknown>;
    expect(output.technologies).toEqual(['TypeScript', 'Solana']);

    const stored = await prisma.submission.findUnique({
      where: { id: submissionId },
      include: { evidence: true, aiJobs: true, aiAnalyses: true },
    });
    expect(stored?.aiAnalysisCompleted).toBe(true);
    expect(stored?.evidence.length).toBeGreaterThan(0);
    expect(stored?.aiJobs[0]?.status).toBe('COMPLETED');
    expect(stored?.aiAnalyses).toHaveLength(1);
  }, 60_000);
});
