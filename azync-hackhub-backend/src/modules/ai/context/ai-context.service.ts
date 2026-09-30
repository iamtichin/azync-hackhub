import { Injectable } from '@nestjs/common';
import { Prisma, type AiArtifactVersion, type Evidence } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { canonicalJson, sha256 } from '../evidence/evidence.utils';

export interface ContextSubmission {
  id: string;
  hackathonId: string;
  projectName: string;
  description: string;
  githubUrl: string;
  demoUrl: string;
}

@Injectable()
export class AiContextService {
  constructor(private readonly prisma: PrismaService) {}

  async prepare(input: {
    submission: ContextSubmission;
    rulesVersion: string;
    rubricVersion: string;
    sourceRevision: string | null;
    evidence: Evidence[];
    artifacts: AiArtifactVersion[];
    collectionMode: 'FULL' | 'GITHUB_REUSED';
  }) {
    const evidenceState = input.evidence
      .map((item) => ({
        evidenceId: item.id,
        type: item.type,
        status: item.status,
        reference: item.reference,
        sourceRevision: item.sourceRevision,
        contentHash: item.contentHash,
      }))
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
    const artifactState = input.artifacts
      .map((item) => ({
        artifactId: item.id,
        artifactKey: item.artifactKey,
        type: item.type,
        path: item.path,
        sourceRevision: item.sourceRevision,
        contentHash: item.contentHash,
      }))
      .sort((a, b) => a.artifactKey.localeCompare(b.artifactKey));
    const context = {
      submission: {
        id: input.submission.id,
        hackathonId: input.submission.hackathonId,
        projectName: input.submission.projectName,
        description: input.submission.description,
        githubUrl: input.submission.githubUrl,
        demoUrl: input.submission.demoUrl,
      },
      rulesVersion: input.rulesVersion,
      rubricVersion: input.rubricVersion,
      sourceRevision: input.sourceRevision,
      evidence: evidenceState,
      artifacts: artifactState,
    };
    const snapshotHash = sha256(canonicalJson(context));

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.aiContextSession.upsert({
        where: { submissionId: input.submission.id },
        create: {
          submissionId: input.submission.id,
          hackathonId: input.submission.hackathonId,
          latestRevision: input.sourceRevision,
        },
        update: { status: 'ACTIVE' },
        include: {
          snapshots: { orderBy: { version: 'desc' }, take: 1 },
        },
      });
      const previous = session.snapshots[0];
      if (previous?.snapshotHash === snapshotHash) return previous;

      const previousContext = previous?.context as
        | {
            evidence?: typeof evidenceState;
            artifacts?: typeof artifactState;
          }
        | undefined;
      const previousById = new Map(
        (previousContext?.evidence ?? []).map((item) => [
          item.evidenceId,
          item,
        ]),
      );
      const currentIds = new Set(evidenceState.map((item) => item.evidenceId));
      const previousArtifacts = new Map(
        (previousContext?.artifacts ?? []).map((item) => [
          item.artifactKey,
          item,
        ]),
      );
      const currentArtifactKeys = new Set(
        artifactState.map((item) => item.artifactKey),
      );
      const delta = {
        fromVersion: previous?.version ?? null,
        addedEvidenceIds: evidenceState
          .filter((item) => !previousById.has(item.evidenceId))
          .map((item) => item.evidenceId),
        changedEvidenceIds: evidenceState
          .filter((item) => {
            const old = previousById.get(item.evidenceId);
            return old && canonicalJson(old) !== canonicalJson(item);
          })
          .map((item) => item.evidenceId),
        removedEvidenceIds: [...previousById.keys()].filter(
          (id) => !currentIds.has(id),
        ),
        rulesChanged:
          !!previous &&
          (previous.rulesVersion !== input.rulesVersion ||
            previous.rubricVersion !== input.rubricVersion),
        revisionChanged:
          !!previous && previous.sourceRevision !== input.sourceRevision,
        addedArtifactKeys: artifactState
          .filter((item) => !previousArtifacts.has(item.artifactKey))
          .map((item) => item.artifactKey),
        changedArtifactKeys: artifactState
          .filter((item) => {
            const old = previousArtifacts.get(item.artifactKey);
            return old && old.contentHash !== item.contentHash;
          })
          .map((item) => item.artifactKey),
        removedArtifactKeys: [...previousArtifacts.keys()].filter(
          (key) => !currentArtifactKeys.has(key),
        ),
        githubCollectionReused: input.collectionMode === 'GITHUB_REUSED',
      };
      const rulesChanged = delta.rulesChanged;
      const refreshMode = !previous || rulesChanged ? 'FULL' : 'DELTA';
      const version = session.contextVersion + 1;
      const snapshot = await tx.aiContextSnapshot.create({
        data: {
          sessionId: session.id,
          version,
          sourceRevision: input.sourceRevision,
          snapshotHash,
          rulesVersion: input.rulesVersion,
          rubricVersion: input.rubricVersion,
          context: context as Prisma.InputJsonValue,
          delta: delta as Prisma.InputJsonValue,
          parentSnapshotId: previous?.id ?? null,
          refreshMode,
          changeManifest: delta as Prisma.InputJsonValue,
          evidenceLinks: {
            create: input.evidence.map((item) => ({ evidenceId: item.id })),
          },
          artifactLinks: {
            create: input.artifacts.map((item) => ({ artifactId: item.id })),
          },
        },
      });
      await tx.aiContextSession.update({
        where: { id: session.id },
        data: {
          contextVersion: version,
          latestRevision: input.sourceRevision,
          latestSnapshotHash: snapshotHash,
        },
      });
      return snapshot;
    });
  }
}
