import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PublicKey } from '@solana/web3.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SolanaService } from '../solana/solana.service';
import { EventsGateway } from '../../events/events.gateway';
import { sanitizeErrorMessage } from '../ai/orchestrator/analysis-error';
import { AiQueueService } from '../ai/queue/ai-queue.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { SaveSubmissionDraftDto } from './dto/save-submission-draft.dto';
import { AccessPolicyService } from '../access/access-policy.service';

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly solanaService: SolanaService,
    private readonly aiQueue: AiQueueService,
    private readonly eventsGateway: EventsGateway,
    private readonly access: AccessPolicyService,
  ) {}

  async create(dto: CreateSubmissionDto, userId: string) {
    // 1. Validate Solana wallet address
    try {
      new PublicKey(dto.walletAddress);
    } catch {
      throw new BadRequestException('Invalid Solana wallet address');
    }

    // 2. Resolve the scope before revealing submission state.
    const [team, hackathon] = await Promise.all([
      this.prisma.team.findUnique({
        where: { id: dto.teamId },
        include: { members: true, repository: true },
      }),
      this.prisma.hackathon.findUnique({ where: { id: dto.hackathonId } }),
    ]);
    if (!team || !hackathon) {
      throw new BadRequestException('Invalid team or hackathon ID');
    }
    if (team.hackathonId !== dto.hackathonId) {
      throw new BadRequestException('Team does not belong to this hackathon');
    }
    if (!team.members.some((member) => member.userId === userId)) {
      throw new ForbiddenException('You are not a member of this team');
    }
    if (hackathon.isPublished === false) {
      throw new BadRequestException('Hackathon is not published');
    }
    const now = new Date();
    // Drafts are permitted before opening; final receipts are not. This is
    // intentionally explicit rather than treating pre-start as an open window.
    if (now < hackathon.startDate) {
      throw new BadRequestException('Final submission is not open yet; save a draft until the hackathon starts');
    }
    if (now >= hackathon.endDate) {
      throw new BadRequestException('Hackathon has already ended');
    }
    const registration = await this.prisma.hackathonRegistration.findUnique({
      where: {
        hackathonId_teamId: {
          hackathonId: dto.hackathonId,
          teamId: dto.teamId,
        },
      },
    });
    if (!registration) {
      throw new BadRequestException('Team is not registered for this hackathon');
    }
    const trackId = dto.trackId ?? registration.trackId;
    // HTTP DTO validation requires an explicit track. Keep this compatibility
    // branch for internal legacy callers while migrations backfill registrations.
    if (trackId) {
      const track = await this.prisma.track.findFirst({ where: { id: trackId, hackathonId: dto.hackathonId, isActive: true } });
      if (!track) throw new BadRequestException('Track is not active for this hackathon');
    }
    const githubUrl = dto.githubUrl || team.repository?.url;
    if (!githubUrl) throw new BadRequestException('GitHub URL is required; a team repository may be used as the editable default');

    // 3. Check duplicate
    const existing = await this.prisma.submission.findFirst({
      where: { teamId: dto.teamId, hackathonId: dto.hackathonId },
    });
    if (existing) return this.persistedReceipt(existing);

    // 4. Save submission (status: pending_nft)
    const snapshot = {
      schemaVersion: 1, receiptVersion: 2, teamId: dto.teamId, hackathonId: dto.hackathonId,
      projectName: dto.projectName, description: dto.description, githubUrl,
      demoUrl: dto.demoUrl, videoUrl: dto.videoUrl, slidesUrl: dto.slidesUrl,
      participantBlockchainEvidenceUrl: dto.participantBlockchainEvidenceUrl,
      walletAddress: dto.walletAddress, trackId, acceptedAt: now.toISOString(),
    };
    let submission: any;
    try {
      const data = {
        ...dto, githubUrl, trackId, status: 'pending_nft', receivedStatus: 'RECEIVED',
        mintStatus: 'PENDING', aiStatus: 'NOT_QUEUED', finalSnapshot: snapshot,
        finalizedAt: now,
      };
      // A final receipt and its editable predecessor must never coexist.  The
      // database transaction makes this true even when two browser clicks race.
      if (typeof (this.prisma as any).$transaction === 'function') {
        submission = await (this.prisma as any).$transaction(async (tx: any) => {
          const created = await tx.submission.create({ data });
          await tx.submissionDraft.deleteMany({ where: { teamId: dto.teamId, hackathonId: dto.hackathonId } });
          return created;
        });
      } else {
        submission = await this.prisma.submission.create({ data });
        await (this.prisma as any).submissionDraft?.deleteMany?.({ where: { teamId: dto.teamId, hackathonId: dto.hackathonId } });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const recovered = await this.prisma.submission.findFirst({ where: { teamId: dto.teamId, hackathonId: dto.hackathonId } });
        if (recovered) return this.persistedReceipt(recovered);
      }
      throw error;
    }

    // Only minting is allowed to choose a mint failure state. The Solana
    // service commits proof atomically; later side effects cannot undo it.
    let minted: { signature: string; assetId: string };
    try {
      minted = await this.solanaService.mintSubmissionCredential(
          submission.id,
          dto.walletAddress,
          {
            hackathonName: hackathon.name,
            teamName: team.name,
            projectName: dto.projectName,
            githubUrl,
            demoUrl: dto.demoUrl,
            submittedAt: submission.createdAt,
            finalSnapshot: snapshot,
          },
        );
      const { signature, assetId } = minted;

      // 6. Update submission with NFT proof
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: {
          transactionSignature: signature,
          nftAssetId: assetId,
          status: 'confirmed',
          mintStatus: 'CONFIRMED',
        },
      });

      this.logger.log(
        `✅ Submission ${submission.id} confirmed with NFT ${signature}`,
      );

      // Emit real-time events
      this.eventsGateway.emitToTeam(dto.teamId, 'submission:confirmed', {
        submissionId: submission.id,
        status: 'confirmed',
        transactionSignature: signature,
        nftAssetId: assetId,
      });
      this.eventsGateway.emitToHackathon(dto.hackathonId, 'submission:new', {
        submissionId: submission.id,
        teamId: dto.teamId,
        projectName: dto.projectName,
      });

      const aiAnalysisStatus = await this.queueAiAnalysis(submission.id);

      return {
        id: submission.id,
        status: 'confirmed', receivedStatus: 'RECEIVED', mintStatus: 'CONFIRMED', aiStatus: aiAnalysisStatus.toUpperCase(),
        transactionSignature: signature,
        nftAssetId: assetId,
        explorerUrl: this.solanaService.getExplorerUrl(signature),
        aiAnalysisStatus,
        createdAt: submission.createdAt,
      };
    } catch (error) {
      const errorMessage = sanitizeErrorMessage(error);
      // Once Solana has a signed transaction, the outcome is ambiguous until
      // reconciliation. Do not label it failed or allow a replacement mint.
      const recovery = await this.solanaService.getMintRecoveryState(submission.id);
      // SolanaService has already committed both proof and Submission in one
      // transaction. A later local persistence/event/queue exception belongs
      // to delivery recovery, never to mint recovery.
      if (recovery?.status === 'confirmed' && recovery.signature && recovery.nftAssetId) {
        this.logger.warn(`Confirmed mint delivery failed for ${submission.id}: ${errorMessage}`);
        return this.completeMintedSubmission(submission, dto, recovery.signature, recovery.nftAssetId);
      }
      this.logger.error(`NFT minting failed for submission ${submission.id}: ${errorMessage}`);
      const pendingReconciliation = ['minting', 'submitted', 'reconciliation_required'].includes(recovery?.status ?? '');
      try {
        await this.prisma.submission.update({
          where: { id: submission.id },
          data: pendingReconciliation
            ? { status: 'mint_pending_reconciliation', mintStatus: 'RECONCILIATION_REQUIRED' }
            : { status: 'nft_failed', mintStatus: 'FAILED' },
        });
      } catch { /* receipt remains recoverable by its ID */ }

      // Emit failure event
      try {
        this.eventsGateway.emitToTeam(dto.teamId, 'submission:nft-failed', {
          submissionId: submission.id,
          error: errorMessage,
        });
      } catch { /* notification failure never changes a receipt */ }

      // Receipt creation succeeded. Return its persisted ID/status so retries
      // recover the same record rather than creating a second final snapshot.
      return { ...this.persistedReceipt(submission), mintStatus: pendingReconciliation ? 'RECONCILIATION_REQUIRED' : 'FAILED', mintError: errorMessage };
    }
  }

  async saveDraft(input: SaveSubmissionDraftDto, userId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: input.teamId }, include: { members: true, repository: true } });
    if (!team || team.hackathonId !== input.hackathonId) throw new BadRequestException('Invalid team or hackathon ID');
    if (!team.members.some((member) => member.userId === userId)) throw new ForbiddenException('You are not a member of this team');
    const [hackathon, registration] = await Promise.all([
      this.prisma.hackathon.findUnique({ where: { id: input.hackathonId } }),
      this.prisma.hackathonRegistration.findUnique({ where: { hackathonId_teamId: { hackathonId: input.hackathonId, teamId: input.teamId } } }),
    ]);
    if (!hackathon || hackathon.isPublished === false) throw new BadRequestException('Hackathon is not published');
    if (!registration) throw new BadRequestException('Team is not registered for this hackathon');
    if (new Date() >= hackathon.endDate) throw new BadRequestException('Draft editing is closed after the hackathon deadline');
    if (input.trackId) {
      const track = await this.prisma.track.findFirst({
        where: { id: input.trackId, hackathonId: input.hackathonId, isActive: true },
      });
      if (!track) throw new BadRequestException('Track is not active for this hackathon');
    }
    const payload = {
      teamId: input.teamId, hackathonId: input.hackathonId, trackId: input.trackId ?? null,
      projectName: input.projectName ?? null, description: input.description ?? null,
      githubUrl: input.githubUrl || team.repository?.url || null, demoUrl: input.demoUrl ?? null,
      videoUrl: input.videoUrl ?? null, slidesUrl: input.slidesUrl ?? null,
      participantBlockchainEvidenceUrl: input.participantBlockchainEvidenceUrl ?? null,
      githubUrlPolicy: 'Team repository is an editable default; the final receipt captures the submitted URL.',
    };
    return this.prisma.submissionDraft.upsert({
      where: { teamId_hackathonId: { teamId: input.teamId, hackathonId: input.hackathonId } },
      create: { teamId: input.teamId, hackathonId: input.hackathonId, payload, updatedById: userId },
      update: { payload, updatedById: userId },
    });
  }

  async getDraft(teamId: string, hackathonId: string, userId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, include: { members: true, repository: true } });
    if (!team || team.hackathonId !== hackathonId) throw new NotFoundException('Team not found');
    if (!team.members.some((member) => member.userId === userId)) throw new ForbiddenException('You are not a member of this team');
    const draft = await this.prisma.submissionDraft.findUnique({ where: { teamId_hackathonId: { teamId, hackathonId } } });
    return draft ?? { teamId, hackathonId, payload: { githubUrl: team.repository?.url ?? null, githubUrlPolicy: 'Team repository is an editable default; the final receipt captures the submitted URL.' } };
  }

  private persistedReceipt(submission: any) {
    return {
      id: submission.id, status: submission.status, receivedStatus: submission.receivedStatus ?? 'RECEIVED',
      mintStatus: submission.mintStatus ?? (submission.status === 'confirmed' ? 'CONFIRMED' : 'PENDING'),
      aiStatus: submission.aiStatus ?? 'NOT_QUEUED', createdAt: submission.createdAt,
    };
  }

  /**
   * Complete best-effort delivery for a proof that is already committed by
   * SolanaService. Every operation here is deliberately non-authoritative:
   * its failure is reported through AI status/logging but cannot demote mint.
   */
  private async completeMintedSubmission(
    submission: any,
    dto: { teamId: string; hackathonId: string; projectName: string },
    signature: string,
    assetId: string,
  ) {
    try {
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: { transactionSignature: signature, nftAssetId: assetId, status: 'confirmed', mintStatus: 'CONFIRMED' },
      });
    } catch (error) {
      this.logger.warn(`Confirmed mint delivery update failed for ${submission.id}: ${sanitizeErrorMessage(error)}`);
    }
    try {
      this.eventsGateway.emitToTeam(dto.teamId, 'submission:confirmed', {
        submissionId: submission.id, status: 'confirmed', transactionSignature: signature, nftAssetId: assetId,
      });
      this.eventsGateway.emitToHackathon(dto.hackathonId, 'submission:new', {
        submissionId: submission.id, teamId: dto.teamId, projectName: dto.projectName,
      });
    } catch (error) {
      this.logger.warn(`Confirmed mint notification failed for ${submission.id}: ${sanitizeErrorMessage(error)}`);
    }
    const aiAnalysisStatus = await this.queueAiAnalysis(submission.id);
    return {
      id: submission.id, status: 'confirmed', receivedStatus: 'RECEIVED', mintStatus: 'CONFIRMED',
      aiStatus: aiAnalysisStatus.toUpperCase(), transactionSignature: signature, nftAssetId: assetId,
      explorerUrl: this.solanaService.getExplorerUrl(signature), aiAnalysisStatus, createdAt: submission.createdAt,
    };
  }

  async findOne(id: string, userId: string) {
    await this.access.requireSubmissionRead(id, userId);
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        team: true,
        hackathon: true,
        solanaTransaction: true,
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    const { aiAnalyses, solanaTransaction, ...details } = submission;
    return {
      ...details,
      solanaTransaction: solanaTransaction
        ? {
            ...solanaTransaction,
            leafIndex: solanaTransaction.leafIndex?.toString() ?? null,
            slot: solanaTransaction.slot?.toString() ?? null,
            lastValidBlockHeight: solanaTransaction.lastValidBlockHeight?.toString() ?? null,
          }
        : null,
      aiAnalysis: aiAnalyses[0] ?? null,
      explorerUrl: submission.transactionSignature
        ? this.solanaService.getExplorerUrl(submission.transactionSignature)
        : null,
    };
  }

  async retryMint(id: string, userId: string) {
    await this.access.requireSubmissionMember(id, userId);
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: { team: true, hackathon: true },
    });

    if (!submission) {
      throw new NotFoundException('Submission not found');
    }

    if (submission.status === 'confirmed') {
      throw new BadRequestException('NFT already minted successfully');
    }

    // Reconcile an already-observed on-chain signature before considering a new mint.
    const reconciled = await this.solanaService.reconcileSubmissionCredential(
      submission.id,
    );
    const { signature, assetId } =
      reconciled ??
      (await this.solanaService.mintSubmissionCredential(
        submission.id,
        submission.walletAddress,
        {
          hackathonName: submission.hackathon.name,
          teamName: submission.team.name,
          projectName: submission.projectName,
          githubUrl: submission.githubUrl,
          demoUrl: submission.demoUrl,
          submittedAt: submission.createdAt,
          finalSnapshot: submission.finalSnapshot as Record<string, unknown>,
        },
      ));

    // SolanaService has atomically committed the proof. This is a redundant
    // delivery update, so an outage here must return the durable receipt rather
    // than make the caller believe the mint failed.
    try {
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: {
          transactionSignature: signature,
          nftAssetId: assetId,
          status: 'confirmed',
          mintStatus: 'CONFIRMED',
        },
      });
    } catch (error) {
      this.logger.warn(`Confirmed retry delivery update failed for ${submission.id}: ${sanitizeErrorMessage(error)}`);
    }

    this.logger.log(`✅ Retry successful for submission ${submission.id}`);

    const aiAnalysisStatus = await this.queueAiAnalysis(submission.id);

    return {
      id: submission.id,
      status: 'confirmed',
      transactionSignature: signature,
      nftAssetId: assetId,
      explorerUrl: this.solanaService.getExplorerUrl(signature),
      aiAnalysisStatus,
    };
  }

  async getAiAnalysisStatus(id: string, userId: string) {
    await this.access.requireSubmissionRead(id, userId);
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      select: {
        aiAnalysisJobId: true,
        aiAnalysisCompleted: true,
      },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    if (!submission.aiAnalysisJobId) {
      return { status: 'not_queued', completed: false, results: null };
    }

    const job = await this.prisma.aiJob.findUnique({
      where: { id: submission.aiAnalysisJobId },
      include: { analysis: true },
    });
    if (!job) {
      return {
        jobId: submission.aiAnalysisJobId,
        status: 'not_found',
        completed: false,
        results: null,
      };
    }

    // The worker commits the job and submission completion marker in one
    // transaction. Those two rows are read separately here, so that commit
    // can land between the reads and briefly produce COMPLETED + false. Once
    // a job is completed it cannot move backwards; re-read the marker and
    // current job pointer before presenting an authoritative result.
    let analysisCompleted = submission.aiAnalysisCompleted;
    if (job.status === 'COMPLETED' && !analysisCompleted) {
      const refreshed = await this.prisma.submission.findUnique({
        where: { id },
        select: { aiAnalysisJobId: true, aiAnalysisCompleted: true },
      });
      analysisCompleted = Boolean(
        refreshed?.aiAnalysisCompleted && refreshed.aiAnalysisJobId === job.id,
      );
    }

    return {
      jobId: job.id,
      queueJobId: job.bullmqJobId,
      status: job.status.toLowerCase(),
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      failedAt: job.failedAt,
      completed: analysisCompleted && job.status === 'COMPLETED',
      error:
        job.status === 'FAILED'
          ? {
              code: job.errorCode,
              message: job.errorMessage,
              details: job.validationReport,
              attempts: job.attempts,
              failedAt: job.failedAt,
            }
          : null,
      // An analysis payload is authoritative only after the same job completed
      // and the submission completion marker committed. This prevents a stale
      // previous result (or a partially persisted one) being presented during
      // a queued/failed refresh.
      results:
        job.status === 'COMPLETED' && analysisCompleted && job.analysis
        ? {
            id: job.analysis.id,
            architectureVersion: job.analysis.architectureVersion,
            analysisVersion: job.analysis.analysisVersion,
            promptVersion: job.analysis.promptVersion,
            schemaVersion: job.analysis.schemaVersion,
            provider: job.analysis.provider,
            protocol: job.analysis.protocol,
            requestedModel: job.analysis.requestedModel,
            resolvedModel: job.analysis.resolvedModel,
            output: job.analysis.output,
            validationReport: job.analysis.validationReport,
            metrics: {
              inputTokens: job.analysis.inputTokens,
              outputTokens: job.analysis.outputTokens,
              latencyMs: job.analysis.latencyMs,
              costUsd: job.analysis.costUsd?.toString() ?? null,
            },
            createdAt: job.analysis.createdAt,
          }
        : null,
    };
  }

  async refreshAiAnalysis(id: string, userId: string) {
    await this.access.requireSubmissionRead(id, userId);
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!submission) throw new NotFoundException('Submission not found');
    const status = await this.queueAiAnalysis(id);
    const current = await this.prisma.submission.findUnique({
      where: { id },
      select: { aiAnalysisJobId: true },
    });
    return {
      submissionId: id,
      status,
      aiJobId: current?.aiAnalysisJobId ?? null,
    };
  }

  private async queueAiAnalysis(
    submissionId: string,
  ): Promise<'queued' | 'completed' | 'not_queued'> {
    try {
      const job = await this.aiQueue.enqueueSubmission(submissionId);
      await this.prisma.submission.update({
        where: { id: submissionId },
        data: { aiAnalysisJobId: job.id, aiStatus: job.status === 'COMPLETED' ? 'COMPLETED' : 'QUEUED' },
      });
      this.logger.log(
        JSON.stringify({
          event: 'ai_job_queued',
          submissionId,
          aiJobId: job.id,
          bullmqJobId: job.bullmqJobId,
        }),
      );
      return job.status === 'COMPLETED' ? 'completed' : 'queued';
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'ai_job_enqueue_failed',
          submissionId,
          error: sanitizeErrorMessage(error),
        }),
      );
      try { await this.prisma.submission.update({ where: { id: submissionId }, data: { aiStatus: 'NOT_QUEUED' } }); } catch { /* receipt state must remain readable */ }
      return 'not_queued';
    }
  }
}
