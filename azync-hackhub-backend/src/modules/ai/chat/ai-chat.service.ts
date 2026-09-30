import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER } from '../constants/ai.constants';
import type {
  AIProvider,
  AIProviderResult,
} from '../providers/ai-provider.interface';
import {
  buildJudgeChatPrompt,
  buildJudgeChatRepairPrompt,
  JUDGE_CHAT_SYSTEM_PROMPT,
} from './ai-chat.prompt';
import { AiChatResponseSchema, type AiChatResponse } from './ai-chat.schema';
import {
  buildContextualSuggestions,
  selectGhostSuggestion,
} from './ai-suggestions';
import {
  AnalysisError,
  sanitizeErrorMessage,
} from '../orchestrator/analysis-error';
import {
  AiChatEncryptionService,
  type ChatEncryptionScope,
} from '../crypto/ai-chat-encryption.service';
import { buildEvidenceFallback } from './ai-chat-fallback';

@Injectable()
export class AiChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly provider: AIProvider,
    private readonly encryption: AiChatEncryptionService,
  ) {}

  async createSession(submissionId: string, judgeId: string, title?: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { hackathon: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    await this.assertJudgeAccess(submission.hackathonId, judgeId);
    const context = await this.prisma.aiContextSession.upsert({
      where: { submissionId },
      create: {
        submissionId,
        hackathonId: submission.hackathonId,
      },
      update: {},
    });
    const id = this.encryption.newSessionId();
    const cleanTitle = title?.trim() || null;
    const material = this.encryption.createSessionMaterial({
      id,
      submissionId,
      hackathonId: submission.hackathonId,
      judgeId,
      title: cleanTitle,
    });
    const session = await this.prisma.aiChatSession.create({
      data: {
        id,
        submissionId,
        hackathonId: submission.hackathonId,
        contextSessionId: context.id,
        judgeId,
        ...material,
        contextVersion: context.contextVersion,
        rulesVersion: submission.hackathon.rulesVersion,
        rubricVersion: submission.hackathon.rubricVersion,
      },
    });
    return this.safeSession(session, cleanTitle);
  }

  async listSessions(submissionId: string, judgeId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: { hackathonId: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    await this.assertJudgeAccess(submission.hackathonId, judgeId);
    let sessions = await this.prisma.aiChatSession.findMany({
      where: { submissionId, judgeId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
    for (const session of sessions) {
      await this.encryption.ensureEncrypted(session.id);
    }
    sessions = await this.prisma.aiChatSession.findMany({
      where: { submissionId, judgeId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
    // An organizer can revoke an assignment while legacy encryption is being
    // migrated above. Check again immediately before decrypting titles.
    await this.assertJudgeAccess(submission.hackathonId, judgeId);
    return sessions.map((session) =>
      this.safeSession(session, this.encryption.decryptTitle(session)),
    );
  }

  async listMessages(submissionId: string, sessionId: string, judgeId: string) {
    await this.assertOwnedSession(submissionId, sessionId, judgeId);
    await this.encryption.ensureEncrypted(sessionId);
    const session = await this.getEncryptionScope(sessionId);
    // Do not decrypt a private transcript based only on an authorization
    // decision made before a potentially slow migration/write operation.
    if (session.submissionId !== submissionId || session.judgeId !== judgeId) {
      throw new NotFoundException('AI chat session not found');
    }
    await this.assertJudgeAccess(session.hackathonId, judgeId);
    const messages = await this.prisma.aiChatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: { evidenceLinks: { include: { evidence: true } } },
    });
    return this.encryption.decryptMessages(session, messages);
  }

  async suggestions(submissionId: string, judgeId: string, prefix: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        hackathon: true,
        evidence: { orderBy: { collectedAt: 'desc' } },
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 },
        aiContextSession: true,
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    await this.assertJudgeAccess(submission.hackathonId, judgeId);
    const candidates = buildContextualSuggestions({
      projectName: submission.projectName,
      hackathonName: submission.hackathon.name,
      rules: submission.hackathon.rules,
      rubric: submission.hackathon.rubric,
      analysis: submission.aiAnalyses[0]?.output ?? null,
      evidence: submission.evidence.map((item) => ({
        type: item.type,
        status: item.status,
        facts: item.facts,
      })),
    });
    return {
      ...selectGhostSuggestion(candidates, prefix.slice(0, 500)),
      candidates,
      contextVersion: submission.aiContextSession?.contextVersion ?? 0,
    };
  }

  async sendMessage(
    submissionId: string,
    sessionId: string,
    judgeId: string,
    question: string,
  ) {
    await this.assertOwnedSession(submissionId, sessionId, judgeId);
    await this.encryption.ensureEncrypted(sessionId);
    const session = await this.prisma.aiChatSession.findFirst({
      where: { id: sessionId, submissionId, judgeId, status: 'ACTIVE' },
      include: {
        submission: {
          include: {
            hackathon: true,
            aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 },
            evidence: { orderBy: { collectedAt: 'desc' } },
          },
        },
        contextSession: {
          include: {
            snapshots: {
              orderBy: { version: 'desc' },
              take: 1,
              include: { evidenceLinks: { include: { evidence: true } } },
            },
          },
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 12 },
      },
    });
    if (!session) throw new NotFoundException('AI chat session not found');
    await this.assertJudgeAccess(session.hackathonId, judgeId);
    if (session.hackathonId !== session.submission.hackathonId) {
      throw new ForbiddenException('Chat session scope mismatch');
    }
    const recentMessages = this.encryption.decryptMessages(
      session,
      session.messages,
    );
    const snapshot = session.contextSession.snapshots[0];
    // Evidence collection completes before provider analysis. Keep the
    // collector status on every item and let judge chat use that evidence even
    // when the advisory analysis provider fails. A completed brief is supplied
    // only when it belongs to this exact snapshot.
    const evidence = snapshot
      ? snapshot.evidenceLinks.map((link) => link.evidence)
      : session.submission.evidence;
    const latestAnalysis = session.submission.aiAnalyses[0];
    const snapshotAnalysis =
      snapshot?.analysisId && latestAnalysis?.id === snapshot.analysisId
        ? latestAnalysis.output
        : null;
    const prompt = buildJudgeChatPrompt({
      trustedHackathonContext: {
        id: session.submission.hackathon.id,
        name: session.submission.hackathon.name,
        rulesVersion: session.submission.hackathon.rulesVersion,
        rubricVersion: session.submission.hackathon.rubricVersion,
        rules: session.submission.hackathon.rules,
        rubric: session.submission.hackathon.rubric,
      },
      submissionContent: {
        id: session.submission.id,
        projectName: session.submission.projectName,
        description: session.submission.description,
        githubUrl: session.submission.githubUrl,
        demoUrl: session.submission.demoUrl,
        videoUrl: session.submission.videoUrl,
        slidesUrl: session.submission.slidesUrl,
        participantBlockchainEvidenceUrl:
          session.submission.participantBlockchainEvidenceUrl,
        walletAddress: session.submission.walletAddress,
        transactionSignature: session.submission.transactionSignature,
        nftAssetId: session.submission.nftAssetId,
        finalSnapshot: session.submission.finalSnapshot,
        aiStatus: session.submission.aiStatus,
      },
      evidence: evidence.map((item) => ({
        id: item.id,
        type: item.type,
        status: item.status,
        source: item.source,
        reference: item.reference,
        sourceRevision: item.sourceRevision,
        facts: item.facts,
        errorCode: item.errorCode,
        collectedAt: item.collectedAt,
      })),
      latestAnalysis: snapshotAnalysis,
      recentMessages: recentMessages
        .slice()
        .reverse()
        .map((item) => ({ role: item.role, content: item.content })),
      question,
    });
    const currentVersion = session.contextSession.contextVersion;
    const contextAdvanced = currentVersion > session.contextVersion;
    const userMessageId = this.encryption.newSessionId();
    const encryptedQuestion = this.encryption.encryptMessage(
      session,
      { id: userMessageId, role: 'USER', contextVersion: currentVersion },
      question,
    );
    const storedUserMessage = await this.prisma.aiChatMessage.create({
      data: {
        sessionId,
        role: 'USER',
        contextVersion: currentVersion,
        ...encryptedQuestion,
      },
    });
    const userMessage = this.encryption.decryptMessages(session, [
      storedUserMessage,
    ])[0];
    const persistAssistant = async (
      response: AiChatResponse,
      metadata: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        latencyMs: number;
        correlationId: string | null;
      },
    ) => this.prisma.$transaction(async (tx) => {
      const assistantMessageId = this.encryption.newSessionId();
      const encryptedAnswer = this.encryption.encryptMessage(
        session,
        {
          id: assistantMessageId,
          role: 'ASSISTANT',
          contextVersion: currentVersion,
        },
        response.answer,
      );
      const storedAssistantMessage = await tx.aiChatMessage.create({
        data: {
          sessionId,
          role: 'ASSISTANT',
          contextVersion: currentVersion,
          ...encryptedAnswer,
          model: metadata.model,
          inputTokens: metadata.inputTokens,
          outputTokens: metadata.outputTokens,
          latencyMs: metadata.latencyMs,
          correlationId: metadata.correlationId,
          evidenceLinks: {
            create: response.evidenceIds.map((evidenceId) => ({ evidenceId })),
          },
        },
      });
      await tx.aiChatSession.update({
        where: { id: sessionId },
        data: {
          contextVersion: currentVersion,
          rulesVersion: session.submission.hackathon.rulesVersion,
          rubricVersion: session.submission.hackathon.rubricVersion,
        },
      });
      return {
        assistantMessage: this.encryption.decryptMessages(session, [
          storedAssistantMessage,
        ])[0],
      };
    });
    let providerResult: Awaited<ReturnType<AiChatService['callAndValidate']>>;
    try {
      providerResult = await this.callAndValidate(
        sessionId,
        prompt,
        new Set(evidence.map((item) => item.id)),
      );
    } catch (error) {
      const typed = error instanceof AnalysisError ? error : null;
      const fallback = buildEvidenceFallback({
        question,
        projectName: session.submission.projectName,
        rubric: session.submission.hackathon.rubric,
        evidence,
      });
      const saved = await persistAssistant(fallback, {
        model: 'local-evidence-fallback',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        correlationId: null,
      });
      return {
        ...saved,
        status: 'partial',
        userMessage,
        answer: fallback.answer,
        evidenceIds: fallback.evidenceIds,
        uncertainty: fallback.uncertainty,
        contextVersion: currentVersion,
        contextAdvanced,
        error: {
          code: typed?.code ?? 'PROVIDER_UNAVAILABLE',
          message: sanitizeErrorMessage(error),
          retryable: typed?.retryable ?? true,
        },
      };
    }
    const saved = await persistAssistant(providerResult.response, {
      model: providerResult.result.resolvedModel,
      inputTokens: providerResult.result.inputTokens,
      outputTokens: providerResult.result.outputTokens,
      latencyMs: providerResult.result.latencyMs,
      correlationId: providerResult.result.gatewayCorrelationId,
    });
    return {
      ...saved,
      status: 'completed',
      userMessage,
      answer: providerResult.response.answer,
      evidenceIds: providerResult.response.evidenceIds,
      uncertainty: providerResult.response.uncertainty,
      contextVersion: currentVersion,
      contextAdvanced,
    };
  }

  private async callAndValidate(
    sessionId: string,
    prompt: string,
    validEvidenceIds: Set<string>,
  ): Promise<{ response: AiChatResponse; result: AIProviderResult }> {
    let result = await this.provider.analyze({
      systemPrompt: JUDGE_CHAT_SYSTEM_PROMPT,
      userPrompt: prompt,
      jobId: `judge-chat-${sessionId}`,
      temperature: 0,
      maxOutputTokens: 1800,
    });
    let validation = this.validateResponse(result.text, validEvidenceIds);
    if (!validation.success) {
      result = await this.provider.analyze({
        systemPrompt: JUDGE_CHAT_SYSTEM_PROMPT,
        userPrompt: `${prompt}\n${buildJudgeChatRepairPrompt(validation.errors, result.text)}`,
        jobId: `judge-chat-${sessionId}`,
        temperature: 0,
        maxOutputTokens: 1800,
      });
      validation = this.validateResponse(result.text, validEvidenceIds);
    }
    if (!validation.success) {
      throw new AnalysisError(
        'INVALID_AI_OUTPUT',
        `Invalid judge chat response: ${validation.errors.join('; ')}`,
        true,
      );
    }
    return { response: validation.data, result };
  }

  private validateResponse(text: string, validEvidenceIds: Set<string>) {
    let value: unknown;
    try {
      const trimmed = text.trim();
      const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
      value = JSON.parse(fenced ? fenced[1].trim() : trimmed);
    } catch {
      return { success: false as const, errors: ['Response is not JSON'] };
    }
    const parsed = AiChatResponseSchema.safeParse(value);
    if (!parsed.success) {
      return {
        success: false as const,
        errors: parsed.error.issues.map((item) => item.message),
      };
    }
    const invalid = parsed.data.evidenceIds.filter(
      (id) => !validEvidenceIds.has(id),
    );
    return invalid.length
      ? {
          success: false as const,
          errors: [`Unknown evidence IDs: ${invalid.join(', ')}`],
        }
      : { success: true as const, data: parsed.data };
  }

  private async assertOwnedSession(
    submissionId: string,
    sessionId: string,
    judgeId: string,
  ) {
    const session = await this.prisma.aiChatSession.findFirst({
      where: { id: sessionId, submissionId, judgeId },
      select: { id: true, hackathonId: true },
    });
    if (!session) throw new NotFoundException('AI chat session not found');
    await this.assertJudgeAccess(session.hackathonId, judgeId);
  }

  private async getEncryptionScope(
    sessionId: string,
  ): Promise<ChatEncryptionScope> {
    const session = await this.prisma.aiChatSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        submissionId: true,
        hackathonId: true,
        judgeId: true,
        encryptedDek: true,
        dekIv: true,
        dekAuthTag: true,
        encryptionVersion: true,
      },
    });
    if (!session) throw new NotFoundException('AI chat session not found');
    return session;
  }

  private safeSession<
    T extends ChatEncryptionScope & {
      title: string | null;
      titleCiphertext: string | null;
      titleIv: string | null;
      titleAuthTag: string | null;
    },
  >(session: T, title: string | null) {
    const {
      encryptedDek: _encryptedDek,
      dekIv: _dekIv,
      dekAuthTag: _dekAuthTag,
      encryptionVersion: _encryptionVersion,
      titleCiphertext: _titleCiphertext,
      titleIv: _titleIv,
      titleAuthTag: _titleAuthTag,
      ...safe
    } = session;
    return { ...safe, title };
  }

  private async assertJudgeAccess(hackathonId: string, judgeId: string) {
    const assignment = await this.prisma.hackathonJudge.findUnique({
      where: { hackathonId_userId: { hackathonId, userId: judgeId } },
      select: { id: true },
    });
    if (!assignment) {
      throw new ForbiddenException(
        'User is not assigned as a judge for this hackathon',
      );
    }
  }
}
