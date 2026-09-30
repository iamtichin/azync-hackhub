import { Injectable } from '@nestjs/common';
import { Prisma, type AiArtifactVersion } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ArtifactDraft,
  RepositoryPromptData,
} from '../evidence/evidence.types';

@Injectable()
export class ArtifactMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    submissionId: string,
    drafts: ArtifactDraft[],
  ): Promise<AiArtifactVersion[]> {
    return this.prisma.$transaction(async (tx) => {
      const versions: AiArtifactVersion[] = [];
      for (const draft of drafts) {
        const current = await tx.aiArtifactVersion.findFirst({
          where: {
            submissionId,
            artifactKey: draft.artifactKey,
            status: 'CURRENT',
          },
          orderBy: { createdAt: 'desc' },
        });
        // A content-identical file still needs a version for the new commit:
        // snapshot links are immutable and loading by revision must recover a
        // complete README/source set after A -> B without content changes.
        if (
          current?.contentHash === draft.contentHash &&
          current.sourceRevision === draft.sourceRevision
        ) {
          versions.push(current);
          continue;
        }
        if (current) {
          await tx.aiArtifactVersion.update({
            where: { id: current.id },
            data: { status: 'SUPERSEDED' },
          });
        }
        const version = await tx.aiArtifactVersion.upsert({
          where: {
            submissionId_artifactKey_sourceRevision_contentHash: {
              submissionId,
              artifactKey: draft.artifactKey,
              sourceRevision: draft.sourceRevision,
              contentHash: draft.contentHash,
            },
          },
          create: {
            submissionId,
            artifactKey: draft.artifactKey,
            type: draft.type,
            source: draft.source,
            reference: draft.reference,
            path: draft.path,
            sourceRevision: draft.sourceRevision,
            contentHash: draft.contentHash,
            content: draft.content,
            metadata: draft.metadata as Prisma.InputJsonValue,
            status: 'CURRENT',
            supersedesId: current?.id ?? null,
          },
          update: {
            status: 'CURRENT',
            sourceRevision: draft.sourceRevision,
            reference: draft.reference,
            metadata: draft.metadata as Prisma.InputJsonValue,
          },
        });
        versions.push(version);
      }

      const currentKeys = drafts.map((item) => item.artifactKey);
      if (currentKeys.length > 0) {
        await tx.aiArtifactVersion.updateMany({
          where: {
            submissionId,
            source: 'github_api',
            status: 'CURRENT',
            artifactKey: { notIn: currentKeys },
          },
          data: { status: 'DELETED' },
        });
      }
      return versions;
    });
  }

  async loadGitHubRevision(
    submissionId: string,
    sourceRevision: string,
  ): Promise<{
    found: boolean;
    artifacts: AiArtifactVersion[];
    repositoryData: RepositoryPromptData;
  }> {
    const artifacts = await this.prisma.aiArtifactVersion.findMany({
      where: {
        submissionId,
        source: 'github_api',
        sourceRevision,
      },
      orderBy: [{ type: 'asc' }, { path: 'asc' }],
    });
    const manifest = artifacts.find(
      (item) => item.type === 'REPOSITORY_MANIFEST',
    );
    const readme = artifacts.find((item) => item.type === 'README');
    const packageManifest = artifacts.find(
      (item) => item.type === 'PACKAGE_MANIFEST',
    );
    const selectedSourceExcerpts = artifacts
      .filter((item) => item.type === 'SOURCE_EXCERPT' && item.path)
      .map((item) => ({
        path: item.path!,
        startLine: 1,
        endLine: Number(
          (item.metadata as Record<string, unknown>).endLine ??
            item.content.split('\n').length,
        ),
        text: item.content,
        truncated: Boolean(
          (item.metadata as Record<string, unknown>).truncated,
        ),
      }));
    return {
      found: Boolean(manifest),
      artifacts,
      repositoryData: {
        readme: readme?.path
          ? {
              path: readme.path,
              text: readme.content,
              truncated: Boolean(
                (readme.metadata as Record<string, unknown>).truncated,
              ),
            }
          : null,
        packageManifest: packageManifest
          ? JSON.parse(packageManifest.content)
          : null,
        selectedSourceExcerpts,
      },
    };
  }
}
