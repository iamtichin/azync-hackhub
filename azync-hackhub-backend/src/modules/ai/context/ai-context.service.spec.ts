import type { Evidence } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { AiContextService } from './ai-context.service';

describe('AiContextService', () => {
  it('creates a versioned snapshot and records its evidence delta', async () => {
    let snapshotCreate: any;
    const tx = {
      aiContextSession: {
        upsert: jest.fn().mockResolvedValue({
          id: 'context-1',
          contextVersion: 0,
          snapshots: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      aiContextSnapshot: {
        create: jest.fn((argument) => {
          snapshotCreate = argument;
          return Promise.resolve({
            id: 'snapshot-1',
            version: 1,
            snapshotHash: argument.data.snapshotHash,
          });
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new AiContextService(prisma);
    await service.prepare({
      submission: {
        id: 'submission-1',
        hackathonId: 'hackathon-1',
        projectName: 'NekoSync',
        description: 'A project',
        githubUrl: 'https://github.com/a/b',
        demoUrl: 'https://example.com',
      },
      rulesVersion: 'rules-v1',
      rubricVersion: 'rubric-v1',
      sourceRevision: 'commit-1',
      evidence: [
        {
          id: 'evidence-1',
          type: 'GITHUB_REPOSITORY',
          status: 'VERIFIED',
          reference: 'https://github.com/a/b/tree/commit-1',
          sourceRevision: 'commit-1',
          contentHash: 'hash-1',
        } as Evidence,
      ],
      artifacts: [],
      collectionMode: 'FULL',
    });
    expect(snapshotCreate.data.version).toBe(1);
    expect(snapshotCreate.data.delta).toMatchObject({
      fromVersion: null,
      addedEvidenceIds: ['evidence-1'],
      revisionChanged: false,
      addedArtifactKeys: [],
    });
    expect(tx.aiContextSession.update).toHaveBeenCalledWith({
      where: { id: 'context-1' },
      data: expect.objectContaining({
        contextVersion: 1,
        latestRevision: 'commit-1',
      }),
    });
  });
});
