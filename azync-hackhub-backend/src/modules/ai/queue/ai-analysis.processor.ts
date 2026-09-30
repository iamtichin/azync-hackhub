import 'dotenv/config';
import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError, type Worker } from 'bullmq';
import { z } from 'zod';
import {
  AI_ANALYSIS_QUEUE,
  ANALYZE_SUBMISSION_JOB,
  type AnalyzeSubmissionJobData,
} from '../ai-queue.constants';
import { AiOrchestratorService } from '../orchestrator/ai-orchestrator.service';
import {
  AnalysisError,
  sanitizeErrorMessage,
} from '../orchestrator/analysis-error';

const JobDataSchema = z
  .object({
    aiJobId: z.string().min(1),
    submissionId: z.string().min(1),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    sourceRevision: z.string().min(1).max(128).nullable(),
  })
  .strict();

export function parseWorkerConcurrency(value: string | undefined): number {
  const parsed = Number(value ?? 2);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new Error('AI_QUEUE_CONCURRENCY must be an integer between 1 and 20');
  }
  return parsed;
}

@Processor(AI_ANALYSIS_QUEUE, {
  concurrency: parseWorkerConcurrency(process.env.AI_QUEUE_CONCURRENCY),
})
@Injectable()
export class AiAnalysisProcessor
  extends WorkerHost
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AiAnalysisProcessor.name);
  private workerRef: Worker | undefined;
  private closing = false;

  constructor(private readonly orchestrator: AiOrchestratorService) {
    super();
  }

  onApplicationBootstrap(): void {
    // BullExplorer creates the worker during module initialization. Keep the
    // reference only after that point so a partially bootstrapped app can still
    // be closed safely.
    this.workerRef = this.worker;
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    // Nest invokes provider shutdown hooks concurrently. Closing the worker in
    // the processor's destroy hook establishes its connection teardown before
    // the registered Queue is closed during application shutdown. BullMQ's
    // close is idempotent, so BullExplorer's later close shares this promise.
    await this.workerRef?.close();
  }

  async process(job: Job<AnalyzeSubmissionJobData>): Promise<string> {
    if (job.name !== ANALYZE_SUBMISSION_JOB) {
      throw new UnrecoverableError(`Unsupported AI job name: ${job.name}`);
    }
    const parsed = JobDataSchema.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError('Invalid AI job payload');

    try {
      return await this.orchestrator.processJob(parsed.data);
    } catch (error) {
      const analysisError =
        error instanceof AnalysisError
          ? error
          : new AnalysisError(
              'INTERNAL_ERROR',
              'Unexpected AI worker failure',
              true,
              false,
              {
                cause: error,
              },
            );
      const maxAttempts = Number(job.opts.attempts ?? 1);
      const retrying =
        analysisError.retryable && job.attemptsMade + 1 < maxAttempts;
      await this.orchestrator.recordFailure(
        parsed.data.aiJobId,
        analysisError.code,
        sanitizeErrorMessage(analysisError),
        retrying,
      );
      if (!retrying) throw new UnrecoverableError(analysisError.message);
      throw analysisError;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      JSON.stringify({
        event: 'ai_job_failed',
        bullmqJobId: job?.id ?? null,
        attempt: job?.attemptsMade ?? null,
        error: sanitizeErrorMessage(error),
      }),
    );
  }

  @OnWorkerEvent('error')
  onError(error: Error): void {
    // BullMQ emits Redis errors through each Worker. An explicit worker-local
    // listener prevents EventEmitter from turning a late close error into an
    // uncaught exception while retaining visibility for operational failures.
    const event = this.closing ? 'ai_worker_close_error' : 'ai_worker_error';
    this.logger.warn(
      JSON.stringify({
        event,
        error: sanitizeErrorMessage(error),
      }),
    );
  }
}
