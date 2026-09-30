import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_ANALYSIS_QUEUE,
  ANALYZE_SUBMISSION_JOB,
  type AnalyzeSubmissionJobData,
} from '../ai-queue.constants';
import {
  AI_ANALYSIS_VERSION,
  AI_ARCHITECTURE_VERSION,
  AI_PROMPT_VERSION,
  AI_SCHEMA_VERSION,
} from '../constants/ai.constants';
import { canonicalJson, sha256 } from '../evidence/evidence.utils';
import { GitHubEvidenceCollector } from '../evidence/github-evidence.collector';
import { SolanaEvidenceCollector } from '../evidence/solana-evidence.collector';
import {
  AnalysisError,
  sanitizeErrorMessage,
} from '../orchestrator/analysis-error';

@Injectable()
export class AiQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly github: GitHubEvidenceCollector,
    private readonly solana: SolanaEvidenceCollector,
    @InjectQueue(AI_ANALYSIS_QUEUE)
    private readonly queue: Queue<AnalyzeSubmissionJobData>,
  ) {}

  async enqueueSubmission(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { hackathon: true },
    });
    if (!submission) {
      throw new AnalysisError('SUBMISSION_NOT_FOUND', 'Submission not found');
    }

    const [sourceRevision, solanaFinality] = await Promise.all([
      this.github.resolveHeadRevision(submission.githubUrl),
      this.solana.resolveFinalityRevision(submission.transactionSignature),
    ]);
    // Demo evidence expires hourly. This bucket deliberately creates a new
    // refresh request after expiry even if GitHub's HEAD did not change.
    const demoFreshnessBucket = new Date();
    demoFreshnessBucket.setMinutes(0, 0, 0);
    const requestFingerprint = sha256(
      canonicalJson({
        submission: {
          id: submission.id,
          teamId: submission.teamId,
          hackathonId: submission.hackathonId,
          trackId: submission.trackId,
          projectName: submission.projectName,
          description: submission.description,
          githubUrl: submission.githubUrl,
          demoUrl: submission.demoUrl,
          videoUrl: submission.videoUrl,
          slidesUrl: submission.slidesUrl,
          participantBlockchainEvidenceUrl:
            submission.participantBlockchainEvidenceUrl,
          transactionSignature: submission.transactionSignature,
          nftAssetId: submission.nftAssetId,
          walletAddress: submission.walletAddress,
          finalSnapshot: submission.finalSnapshot,
        },
        rulesVersion: submission.hackathon.rulesVersion,
        rubricVersion: submission.hackathon.rubricVersion,
        sourceRevision,
        evidenceFreshness: {
          demoBucket: demoFreshnessBucket.toISOString(),
          solanaFinality,
        },
        architectureVersion: AI_ARCHITECTURE_VERSION,
        analysisVersion: AI_ANALYSIS_VERSION,
        promptVersion: AI_PROMPT_VERSION,
        schemaVersion: AI_SCHEMA_VERSION,
      }),
    );
    const idempotencyKey = sha256(
      `${submissionId}|${requestFingerprint}|${AI_ANALYSIS_VERSION}`,
    );
    const bullmqJobId = `ai-${idempotencyKey}`;
    const maxAttempts = Number(this.config.get('AI_JOB_ATTEMPTS') ?? 3);

    const aiJob = await this.prisma.aiJob.upsert({
      where: { idempotencyKey },
      create: {
        submissionId,
        bullmqJobId,
        idempotencyKey,
        architectureVersion: AI_ARCHITECTURE_VERSION,
        analysisVersion: AI_ANALYSIS_VERSION,
        promptVersion: AI_PROMPT_VERSION,
        schemaVersion: AI_SCHEMA_VERSION,
        requestFingerprint,
        sourceRevision,
        maxAttempts,
      },
      update: {},
    });

    if (aiJob.status === 'COMPLETED') return aiJob;
    if (['QUEUED', 'PROCESSING', 'RETRYING'].includes(aiJob.status)) {
      // A DB row may have committed immediately before a process crash. Only
      // consider it already enqueued when BullMQ has non-terminal work.
      const retained = await this.queue.getJob(aiJob.bullmqJobId);
      if (retained) {
        const state = await retained.getState();
        if (state === 'completed') {
          // The worker says it completed but the DB did not record the result.
          // Re-running could duplicate side effects, so require an operator or
          // recovery worker to reconcile the durable analysis first.
          throw this.reconciliationRequired(aiJob.id, state);
        }
        if (state !== 'failed') return aiJob;
        // The DB status was written before the worker's terminal failure, so
        // it cannot be treated as evidence of live work. Remove BullMQ's
        // retained failed id before creating its replacement below.
        await retained.remove();
      }
    }

    const data: AnalyzeSubmissionJobData = {
      aiJobId: aiJob.id,
      submissionId,
      requestFingerprint,
      sourceRevision,
    };
    try {
      // BullMQ de-duplicates terminal job IDs. Clear a terminal record before
      // adding a new attempt, never while a non-terminal job might still run.
      if (aiJob.status === 'FAILED') {
        const retained = await this.queue.getJob(aiJob.bullmqJobId);
        if (retained) {
          const state = await retained.getState();
          if (state === 'completed') {
            throw this.reconciliationRequired(aiJob.id, state);
          }
          if (state !== 'failed') {
            throw new Error(`FAILED_DB_JOB_NOT_FAILED_IN_QUEUE:${state}`);
          }
          await retained.remove();
        }
      }
      await this.queue.add(ANALYZE_SUBMISSION_JOB, data, {
        jobId: aiJob.bullmqJobId,
        attempts: maxAttempts,
      });
      return await this.prisma.aiJob.update({
        where: { id: aiJob.id },
        data: {
          status: 'QUEUED',
          attempts: 0,
          errorCode: null,
          errorMessage: null,
          startedAt: null,
          completedAt: null,
          failedAt: null,
        },
      });
    } catch (error) {
      if (error instanceof AnalysisError) throw error;
      await this.prisma.aiJob.update({
        where: { id: aiJob.id },
        data: {
          status: 'FAILED',
          errorCode: 'ENQUEUE_FAILED',
          errorMessage: sanitizeErrorMessage(error),
          failedAt: new Date(),
        },
      });
      throw new AnalysisError(
        'ENQUEUE_FAILED',
        'Failed to enqueue AI analysis',
        true,
        false,
        {
          cause: error,
        },
      );
    }
  }

  private reconciliationRequired(aiJobId: string, bullmqState: string) {
    return new AnalysisError(
      'JOB_STATE_RECONCILIATION_REQUIRED',
      `AI job ${aiJobId} has a stale database state but ${bullmqState} in BullMQ`,
      false,
      true,
    );
  }
}
