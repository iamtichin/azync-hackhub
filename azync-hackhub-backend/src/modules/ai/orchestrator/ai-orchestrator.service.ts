import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Evidence } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../prisma/prisma.service';
import { AiConfigService } from '../config/ai-config.service';
import {
  AI_ANALYSIS_VERSION,
  AI_ARCHITECTURE_VERSION,
  AI_PROVIDER,
  AI_PROMPT_VERSION,
  AI_SCHEMA_VERSION,
} from '../constants/ai.constants';
import { EvidenceService } from '../evidence/evidence.service';
import { canonicalJson, sha256 } from '../evidence/evidence.utils';
import {
  buildRepairPrompt,
  buildSubmissionAnalysisPrompt,
  SUBMISSION_ANALYZER_SYSTEM_PROMPT,
} from '../prompts/submission-analysis.prompt';
import type {
  AIProvider,
  AIProviderResult,
} from '../providers/ai-provider.interface';
import {
  HackathonRuleSchema,
  RubricCriterionSchema,
  SubmissionAnalysisResponseSchema,
  type HackathonRule,
  type RubricCriterion,
  type SubmissionAnalysisResponse,
} from '../schemas/submission-analysis.schema';
import { AnalysisBusinessValidator } from '../validation/analysis-business.validator';
import { AnalysisError } from './analysis-error';
import type { AnalyzeSubmissionJobData } from '../ai-queue.constants';
import { AiContextService } from '../context/ai-context.service';

const RuleArraySchema = z.array(HackathonRuleSchema).max(100);
const RubricArraySchema = z.array(RubricCriterionSchema).max(50);

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AiConfigService,
    private readonly evidenceService: EvidenceService,
    private readonly contextService: AiContextService,
    private readonly businessValidator: AnalysisBusinessValidator,
    @Inject(AI_PROVIDER) private readonly provider: AIProvider,
  ) {}

  async processJob(data: AnalyzeSubmissionJobData): Promise<string> {
    const existing = await this.prisma.aiJob.findUnique({
      where: { id: data.aiJobId },
      include: { analysis: true },
    });
    if (!existing || existing.submissionId !== data.submissionId) {
      throw new AnalysisError('SUBMISSION_NOT_FOUND', 'AI job not found');
    }
    if (existing.status === 'COMPLETED' && existing.analysis)
      return existing.analysis.id;
    if (!this.config.readiness().ready) {
      throw new AnalysisError(
        'AI_NOT_CONFIGURED',
        'AI provider is not configured',
      );
    }

    const claimed = await this.prisma.aiJob.updateMany({
      where: {
        id: data.aiJobId,
        status: { in: ['QUEUED', 'RETRYING', 'PROCESSING'] },
      },
      data: {
        status: 'PROCESSING',
        startedAt: existing.startedAt ?? new Date(),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) {
      throw new AnalysisError(
        'INTERNAL_ERROR',
        'AI job is not in a processable state',
      );
    }
    await this.prisma.submission.updateMany({
      where: {
        id: existing.submissionId,
        aiAnalysisJobId: data.aiJobId,
      },
      data: { aiStatus: 'PROCESSING' },
    });

    const submission = await this.prisma.submission.findUnique({
      where: { id: data.submissionId },
      include: {
        hackathon: true,
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!submission)
      throw new AnalysisError('SUBMISSION_NOT_FOUND', 'Submission not found');
    const rules = RuleArraySchema.parse(submission.hackathon.rules);
    const rubric = RubricArraySchema.parse(submission.hackathon.rubric);

    const collection = await this.evidenceService.collect(
      {
        id: submission.id,
        githubUrl: submission.githubUrl,
        demoUrl: submission.demoUrl,
        walletAddress: submission.walletAddress,
        transactionSignature: submission.transactionSignature,
        nftAssetId: submission.nftAssetId,
        participantBlockchainEvidenceUrl:
          submission.participantBlockchainEvidenceUrl,
      },
      data.sourceRevision,
    );
    const promptEvidence = collection.evidence.map((item) =>
      this.toPromptEvidence(item),
    );
    const collectedRevision =
      collection.evidence.find((item) => item.type === 'GITHUB_REPOSITORY')
        ?.sourceRevision ?? data.sourceRevision;
    const contextSnapshot = await this.contextService.prepare({
      submission,
      rulesVersion: submission.hackathon.rulesVersion,
      rubricVersion: submission.hackathon.rubricVersion,
      sourceRevision: collectedRevision,
      evidence: collection.evidence,
      artifacts: collection.artifacts,
      collectionMode: collection.collectionMode,
    });
    const inputHash = sha256(
      canonicalJson({
        requestFingerprint: data.requestFingerprint,
        evidence: promptEvidence.map((item) => ({
          id: item.id,
          status: item.status,
          contentHash: item.contentHash,
        })),
        artifacts: collection.artifacts.map((item) => ({
          artifactKey: item.artifactKey,
          contentHash: item.contentHash,
        })),
        promptVersion: AI_PROMPT_VERSION,
        schemaVersion: AI_SCHEMA_VERSION,
      }),
    );
    const userPrompt = buildSubmissionAnalysisPrompt({
      submission,
      rules,
      rubric,
      verifiedEvidence: promptEvidence,
      repositoryData: collection.repositoryData,
      refreshMode: contextSnapshot.refreshMode as 'FULL' | 'DELTA',
      changeManifest: contextSnapshot.changeManifest,
      previousValidatedAnalysis: submission.aiAnalyses[0]?.output ?? null,
    });

    let providerResult = await this.provider.analyze({
      systemPrompt: SUBMISSION_ANALYZER_SYSTEM_PROMPT,
      userPrompt,
      jobId: data.aiJobId,
      temperature: 0,
      maxOutputTokens: 8000,
    });
    let validated = this.validateOutput(
      providerResult.text,
      rules,
      rubric,
      collection.evidence,
    );
    let repairAttempted = false;
    if (!validated.success) {
      repairAttempted = true;
      providerResult = await this.provider.analyze({
        systemPrompt: SUBMISSION_ANALYZER_SYSTEM_PROMPT,
        userPrompt: `${userPrompt}\n${buildRepairPrompt(validated.errors, providerResult.text)}`,
        jobId: data.aiJobId,
        temperature: 0,
        maxOutputTokens: 8000,
      });
      validated = this.validateOutput(
        providerResult.text,
        rules,
        rubric,
        collection.evidence,
      );
    }
    if (!validated.success) {
      throw new AnalysisError(
        'INVALID_AI_OUTPUT',
        `AI output failed validation: ${validated.errors.slice(0, 5).join('; ')}`,
        true,
      );
    }

    const analysis = await this.persistResult(
      data.aiJobId,
      submission.id,
      inputHash,
      validated.data,
      providerResult,
      collection.evidence,
      repairAttempted,
      contextSnapshot.id,
      submission.aiAnalyses[0]?.id ?? null,
      contextSnapshot.refreshMode,
      contextSnapshot.changeManifest,
    );
    this.logger.log(
      JSON.stringify({
        event: 'ai_job_completed',
        aiJobId: data.aiJobId,
        submissionId: submission.id,
        requestedModel: providerResult.requestedModel,
        resolvedModel: providerResult.resolvedModel,
        protocol: providerResult.protocol,
        latencyMs: providerResult.latencyMs,
      }),
    );
    return analysis.id;
  }

  async recordFailure(
    aiJobId: string,
    code: string,
    message: string,
    retrying: boolean,
  ): Promise<void> {
    const job = await this.prisma.aiJob.update({
      where: { id: aiJobId },
      data: {
        status: retrying ? 'RETRYING' : 'FAILED',
        errorCode: code,
        errorMessage: message,
        validationReport: { valid: false, errors: [message] },
        failedAt: retrying ? null : new Date(),
      },
    });
    await this.prisma.submission.updateMany({
      where: { id: job.submissionId, aiAnalysisJobId: aiJobId },
      data: { aiStatus: retrying ? 'RETRYING' : 'FAILED' },
    });
    this.logger.warn(
      JSON.stringify({
        event: retrying ? 'ai_job_retrying' : 'ai_job_failed',
        aiJobId,
        errorCode: code,
        error: message,
      }),
    );
  }

  private validateOutput(
    text: string,
    rules: HackathonRule[],
    rubric: RubricCriterion[],
    evidence: Evidence[],
  ):
    | { success: true; data: SubmissionAnalysisResponse }
    | { success: false; errors: string[] } {
    let json: unknown;
    try {
      json = JSON.parse(this.unwrapJson(text));
    } catch {
      return { success: false, errors: ['Response is not complete JSON'] };
    }
    const parsed = SubmissionAnalysisResponseSchema.safeParse(json);
    if (!parsed.success) {
      return {
        success: false,
        errors: parsed.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      };
    }
    const errors = this.businessValidator.validate(
      parsed.data,
      rules,
      rubric,
      new Set(evidence.map((item) => item.id)),
      new Set(
        evidence
          .filter((item) => item.status === 'VERIFIED')
          .map((item) => item.id),
      ),
    );
    return errors.length
      ? { success: false, errors }
      : { success: true, data: parsed.data };
  }

  private unwrapJson(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : trimmed;
  }

  private async persistResult(
    jobId: string,
    submissionId: string,
    inputHash: string,
    output: SubmissionAnalysisResponse,
    result: AIProviderResult,
    evidence: Evidence[],
    repairAttempted: boolean,
    contextSnapshotId: string,
    previousAnalysisId: string | null,
    refreshMode: string,
    changeManifest: Prisma.JsonValue,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const analysis = await tx.aiAnalysis.upsert({
        where: {
          submissionId_inputHash_promptVersion_schemaVersion: {
            submissionId,
            inputHash,
            promptVersion: AI_PROMPT_VERSION,
            schemaVersion: AI_SCHEMA_VERSION,
          },
        },
        create: {
          submissionId,
          jobId,
          architectureVersion: AI_ARCHITECTURE_VERSION,
          analysisVersion: AI_ANALYSIS_VERSION,
          promptVersion: AI_PROMPT_VERSION,
          schemaVersion: AI_SCHEMA_VERSION,
          inputHash,
          provider: result.provider,
          protocol: result.protocol,
          requestedModel: result.requestedModel,
          resolvedModel: result.resolvedModel,
          output,
          validationReport: { valid: true, repairAttempted },
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          costUsd: result.costUsd,
          gatewayCorrelationId: result.gatewayCorrelationId,
          gatewaySessionId: result.gatewaySessionId,
          selectedConnectionId: result.selectedConnectionId,
          previousAnalysisId,
          refreshMode,
          changeManifest: changeManifest as Prisma.InputJsonValue,
        },
        update: {},
      });
      await tx.aiAnalysisEvidence.createMany({
        data: evidence.map((item) => ({
          analysisId: analysis.id,
          evidenceId: item.id,
        })),
        skipDuplicates: true,
      });
      await tx.aiContextSnapshot.update({
        where: { id: contextSnapshotId },
        data: { analysisId: analysis.id },
      });
      await tx.aiContextSession.update({
        where: { submissionId },
        data: { lastAnalyzedAt: new Date() },
      });
      await tx.aiJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          inputHash,
          requestedModel: result.requestedModel,
          resolvedModel: result.resolvedModel,
          protocol: result.protocol,
          gatewayCorrelationId: result.gatewayCorrelationId,
          gatewaySessionId: result.gatewaySessionId,
          selectedConnectionId: result.selectedConnectionId,
          validationReport: { valid: true, repairAttempted },
          completedAt: new Date(),
          failedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });
      await tx.submission.update({
        where: { id: submissionId },
        data: {
          aiAnalysisCompleted: true,
          aiAnalysisJobId: jobId,
          aiStatus: 'COMPLETED',
        },
      });
      return analysis;
    });
  }

  private toPromptEvidence(evidence: Evidence): Record<string, unknown> {
    return {
      id: evidence.id,
      type: evidence.type,
      status: evidence.status,
      source: evidence.source,
      reference: evidence.reference,
      facts: evidence.facts,
      contentHash: evidence.contentHash,
      collectedAt: evidence.collectedAt.toISOString(),
    };
  }
}
