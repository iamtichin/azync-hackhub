import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AiArtifactVersion, type Evidence } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EVIDENCE_COLLECTOR_VERSION } from '../constants/ai.constants';
import { DemoEvidenceCollector } from './demo-evidence.collector';
import type {
  EvidenceDraft,
  RepositoryPromptData,
  SubmissionEvidenceInput,
} from './evidence.types';
import { createEvidenceSnapshotKey } from './evidence.utils';
import { GitHubEvidenceCollector } from './github-evidence.collector';
import { SolanaEvidenceCollector } from './solana-evidence.collector';
import { ArtifactMemoryService } from '../memory/artifact-memory.service';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubEvidenceCollector,
    private readonly solana: SolanaEvidenceCollector,
    private readonly demo: DemoEvidenceCollector,
    private readonly artifacts: ArtifactMemoryService,
  ) {}

  async collect(
    submission: SubmissionEvidenceInput,
    sourceRevision: string | null = null,
  ): Promise<{
    evidence: Evidence[];
    repositoryData: RepositoryPromptData;
    artifacts: AiArtifactVersion[];
    collectionMode: 'FULL' | 'GITHUB_REUSED';
  }> {
    const cached = sourceRevision
      ? await this.loadReusableGitHub(submission.id, sourceRevision)
      : null;
    const [githubResult, solanaRecords, demoRecord] = await Promise.all([
      cached
        ? Promise.resolve(null)
        : this.github.collect(submission.githubUrl),
      this.solana.collect(submission),
      this.demo.collect(submission.demoUrl),
    ]);
    const githubDrafts: EvidenceDraft[] = githubResult?.records ?? [];
    const drafts: EvidenceDraft[] = [
      ...(cached ? [] : githubDrafts),
      ...solanaRecords,
      demoRecord,
    ];
    const evidence = await Promise.all(
      drafts.map((draft) => {
        const snapshotKey = createEvidenceSnapshotKey(submission.id, draft);
        const data = {
          submissionId: submission.id,
          snapshotKey,
          type: draft.type,
          source: draft.source,
          status: draft.status,
          reference: draft.reference,
          sourceRevision: draft.sourceRevision,
          locator: draft.locator as Prisma.InputJsonValue,
          facts: draft.facts as Prisma.InputJsonValue,
          contentHash: draft.contentHash,
          collectorVersion: EVIDENCE_COLLECTOR_VERSION,
          errorCode: draft.errorCode,
          expiresAt: draft.expiresAt,
        };
        return this.prisma.evidence.upsert({
          where: { snapshotKey },
          create: data,
          update: data,
        });
      }),
    );
    const artifactVersions = cached
      ? cached.artifacts
      : await this.artifacts.ingest(
          submission.id,
          githubResult?.artifacts ?? [],
        );
    const allEvidence: Evidence[] = cached
      ? [...cached.evidence, ...evidence]
      : evidence;

    this.logger.log(
      JSON.stringify({
        event: 'ai_evidence_collected',
        submissionId: submission.id,
        total: allEvidence.length,
        verified: allEvidence.filter((item) => item.status === 'VERIFIED')
          .length,
        unavailable: allEvidence.filter((item) => item.status === 'UNAVAILABLE')
          .length,
        collectionMode: cached ? 'GITHUB_REUSED' : 'FULL',
      }),
    );

    return {
      evidence: allEvidence,
      repositoryData: cached?.repositoryData ?? githubResult!.repositoryData,
      artifacts: artifactVersions,
      collectionMode: cached ? 'GITHUB_REUSED' : 'FULL',
    };
  }

  private async loadReusableGitHub(
    submissionId: string,
    sourceRevision: string,
  ): Promise<{
    evidence: Evidence[];
    artifacts: AiArtifactVersion[];
    repositoryData: RepositoryPromptData;
  } | null> {
    const contextSession = await this.prisma.aiContextSession.findUnique({
      where: { submissionId },
      include: {
        snapshots: {
          orderBy: { version: 'desc' },
          take: 1,
          include: { evidenceLinks: { include: { evidence: true } } },
        },
      },
    });
    if (contextSession?.latestRevision !== sourceRevision) return null;
    const memory = await this.artifacts.loadGitHubRevision(
      submissionId,
      sourceRevision,
    );
    if (!memory.found) return null;
    const evidence = (contextSession.snapshots[0]?.evidenceLinks ?? [])
      .map((link) => link.evidence)
      .filter((item) => item.source === 'github_api');
    if (evidence.length === 0) return null;
    return { evidence, ...memory };
  }
}
