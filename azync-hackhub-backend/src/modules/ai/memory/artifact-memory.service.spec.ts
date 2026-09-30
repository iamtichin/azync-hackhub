import type { PrismaService } from '../../prisma/prisma.service';
import { ArtifactMemoryService } from './artifact-memory.service';

describe('ArtifactMemoryService', () => {
  it('supersedes the previous version and stores immutable content', async () => {
    const previous = {
      id: 'artifact-old',
      contentHash: 'old-hash',
      artifactKey: 'github:README.md',
    };
    const created = {
      id: 'artifact-new',
      contentHash: 'new-hash',
      artifactKey: 'github:README.md',
    };
    const tx = {
      aiArtifactVersion: {
        findFirst: jest.fn().mockResolvedValue(previous),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue(created),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    } as unknown as PrismaService;
    const service = new ArtifactMemoryService(prisma);

    await expect(
      service.ingest('submission-1', [
        {
          artifactKey: 'github:README.md',
          type: 'README',
          source: 'github_api',
          reference: 'https://github.com/a/b/blob/new/README.md',
          path: 'README.md',
          sourceRevision: 'new',
          contentHash: 'new-hash',
          content: '# New',
          metadata: {},
        },
      ]),
    ).resolves.toEqual([created]);
    expect(tx.aiArtifactVersion.update).toHaveBeenCalledWith({
      where: { id: 'artifact-old' },
      data: { status: 'SUPERSEDED' },
    });
    expect(tx.aiArtifactVersion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ supersedesId: 'artifact-old' }),
      }),
    );
  });

  it('creates a current revision-B artifact when its content is unchanged from revision A', async () => {
    const revisionA = {
      id: 'artifact-a', artifactKey: 'github:README.md', contentHash: 'same-hash',
      sourceRevision: 'commit-a', status: 'CURRENT', content: '# README', path: 'README.md',
      type: 'README', metadata: {},
    };
    const revisionB = { ...revisionA, id: 'artifact-b', sourceRevision: 'commit-b' };
    const tx = {
      aiArtifactVersion: {
        findFirst: jest.fn().mockResolvedValue(revisionA),
        update: jest.fn().mockResolvedValue({}),
        upsert: jest.fn().mockResolvedValue(revisionB),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) } as unknown as PrismaService;
    const service = new ArtifactMemoryService(prisma);

    await service.ingest('submission-1', [{
      artifactKey: 'github:README.md', type: 'README', source: 'github_api',
      reference: 'https://github.com/a/b/blob/commit-b/README.md', path: 'README.md',
      sourceRevision: 'commit-b', contentHash: 'same-hash', content: '# README', metadata: {},
    }]);

    expect(tx.aiArtifactVersion.update).toHaveBeenCalledWith({
      where: { id: 'artifact-a' }, data: { status: 'SUPERSEDED' },
    });
    expect(tx.aiArtifactVersion.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { submissionId_artifactKey_sourceRevision_contentHash: expect.objectContaining({ sourceRevision: 'commit-b', contentHash: 'same-hash' }) },
      create: expect.objectContaining({ sourceRevision: 'commit-b', supersedesId: 'artifact-a' }),
    }));
  });

  it('loads a complete commit-B artifact set after later commits supersede it', async () => {
    const revisionB = [
      {
        id: 'manifest-b', sourceRevision: 'commit-b', status: 'SUPERSEDED',
        source: 'github_api', type: 'REPOSITORY_MANIFEST', path: null,
        content: '{"entries":["README.md","src/main.ts"]}', metadata: {},
      },
      {
        id: 'readme-b', sourceRevision: 'commit-b', status: 'SUPERSEDED',
        source: 'github_api', type: 'README', path: 'README.md',
        content: '# README', metadata: { truncated: false },
      },
      {
        id: 'excerpt-b', sourceRevision: 'commit-b', status: 'SUPERSEDED',
        source: 'github_api', type: 'SOURCE_EXCERPT', path: 'src/main.ts',
        content: 'export const main = true;', metadata: { endLine: 1, truncated: false },
      },
    ];
    const prisma = {
      aiArtifactVersion: { findMany: jest.fn().mockResolvedValue(revisionB) },
    } as unknown as PrismaService;

    const result = await new ArtifactMemoryService(prisma).loadGitHubRevision(
      'submission-1',
      'commit-b',
    );

    expect(prisma.aiArtifactVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ status: 'CURRENT' }),
      }),
    );
    expect(result).toMatchObject({
      found: true,
      repositoryData: {
        readme: { path: 'README.md', text: '# README' },
        selectedSourceExcerpts: [{ path: 'src/main.ts', text: 'export const main = true;' }],
      },
    });
  });
});
