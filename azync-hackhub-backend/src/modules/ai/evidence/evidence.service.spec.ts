import type { PrismaService } from '../../prisma/prisma.service';
import type { ArtifactMemoryService } from '../memory/artifact-memory.service';
import type { DemoEvidenceCollector } from './demo-evidence.collector';
import { EvidenceService } from './evidence.service';
import type { GitHubEvidenceCollector } from './github-evidence.collector';
import type { SolanaEvidenceCollector } from './solana-evidence.collector';

describe('EvidenceService incremental collection', () => {
  it('reuses GitHub evidence and artifacts when HEAD is unchanged', async () => {
    const githubEvidence = {
      id: 'evidence-github',
      source: 'github_api',
      status: 'VERIFIED',
    };
    const prisma = {
      aiContextSession: {
        findUnique: jest.fn().mockResolvedValue({
          latestRevision: 'commit-1',
          snapshots: [{ evidenceLinks: [{ evidence: githubEvidence }] }],
        }),
      },
      evidence: {
        upsert: jest
          .fn()
          .mockImplementation(({ create }) => Promise.resolve(create)),
      },
    } as unknown as PrismaService;
    const github = { collect: jest.fn() } as unknown as GitHubEvidenceCollector;
    const solana = {
      collect: jest.fn().mockResolvedValue([]),
    } as unknown as SolanaEvidenceCollector;
    const demo = {
      collect: jest.fn().mockResolvedValue({
        type: 'DEMO_URL',
        source: 'http_probe',
        status: 'VERIFIED',
        reference: 'https://demo.example',
        sourceRevision: null,
        locator: {},
        facts: {},
        contentHash: 'demo-hash',
        errorCode: null,
        expiresAt: null,
      }),
    } as unknown as DemoEvidenceCollector;
    const memory = {
      loadGitHubRevision: jest.fn().mockResolvedValue({
        found: true,
        artifacts: [{ id: 'artifact-1' }],
        repositoryData: {
          readme: null,
          packageManifest: null,
          selectedSourceExcerpts: [],
        },
      }),
      ingest: jest.fn(),
    } as unknown as ArtifactMemoryService;
    const service = new EvidenceService(prisma, github, solana, demo, memory);

    const result = await service.collect(
      {
        id: 'submission-1',
        githubUrl: 'https://github.com/a/b',
        demoUrl: 'https://demo.example',
        walletAddress: 'wallet',
        transactionSignature: null,
        nftAssetId: null,
      },
      'commit-1',
    );

    expect(result.collectionMode).toBe('GITHUB_REUSED');
    expect(result.evidence).toEqual(expect.arrayContaining([githubEvidence]));
    expect(github.collect).not.toHaveBeenCalled();
    expect(memory.ingest).not.toHaveBeenCalled();
  });
});
