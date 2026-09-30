import { UnrecoverableError, type Job } from 'bullmq';
import {
  AiAnalysisProcessor,
  parseWorkerConcurrency,
} from './ai-analysis.processor';
import type { AiOrchestratorService } from '../orchestrator/ai-orchestrator.service';
import { AnalysisError } from '../orchestrator/analysis-error';
import type { AnalyzeSubmissionJobData } from '../ai-queue.constants';

function createJob(overrides: Partial<Job<AnalyzeSubmissionJobData>> = {}) {
  return {
    name: 'analyze-submission',
    data: {
      aiJobId: 'job-1',
      submissionId: 'submission-1',
      requestFingerprint: 'a'.repeat(64),
      sourceRevision: 'commit-1',
    },
    opts: { attempts: 3 },
    attemptsMade: 0,
    ...overrides,
  } as Job<AnalyzeSubmissionJobData>;
}

describe('AiAnalysisProcessor', () => {
  it('parses a bounded worker concurrency', () => {
    expect(parseWorkerConcurrency(undefined)).toBe(2);
    expect(parseWorkerConcurrency('4')).toBe(4);
    expect(() => parseWorkerConcurrency('0')).toThrow('AI_QUEUE_CONCURRENCY');
  });

  it('delegates a valid job to the orchestrator', async () => {
    const orchestrator = {
      processJob: jest.fn().mockResolvedValue('analysis-1'),
      recordFailure: jest.fn(),
    } as unknown as AiOrchestratorService;
    const processor = new AiAnalysisProcessor(orchestrator);

    await expect(processor.process(createJob())).resolves.toBe('analysis-1');
  });

  it('closes its BullMQ worker before queue shutdown', async () => {
    const processor = new AiAnalysisProcessor(
      {} as AiOrchestratorService,
    );
    const worker = { close: jest.fn().mockResolvedValue(undefined) };
    Object.defineProperty(processor, '_worker', { value: worker });

    processor.onApplicationBootstrap();
    await processor.onModuleDestroy();

    expect(worker.close).toHaveBeenCalledTimes(1);
  });

  it('does not require a worker when bootstrap fails before registration', async () => {
    const processor = new AiAnalysisProcessor(
      {} as AiOrchestratorService,
    );

    await expect(processor.onModuleDestroy()).resolves.toBeUndefined();
  });

  it('marks a retryable failure as RETRYING while attempts remain', async () => {
    const failure = new AnalysisError(
      'PROVIDER_UNAVAILABLE',
      'Unavailable',
      true,
    );
    const recordFailure = jest.fn().mockResolvedValue(undefined);
    const orchestrator = {
      processJob: jest.fn().mockRejectedValue(failure),
      recordFailure,
    } as unknown as AiOrchestratorService;
    const processor = new AiAnalysisProcessor(orchestrator);

    await expect(processor.process(createJob())).rejects.toBe(failure);
    expect(recordFailure).toHaveBeenCalledWith(
      'job-1',
      'PROVIDER_UNAVAILABLE',
      'Unavailable',
      true,
    );
  });

  it('stops retrying permanent failures', async () => {
    const recordFailure = jest.fn().mockResolvedValue(undefined);
    const orchestrator = {
      processJob: jest
        .fn()
        .mockRejectedValue(
          new AnalysisError('AUTHENTICATION_FAILED', 'Denied'),
        ),
      recordFailure,
    } as unknown as AiOrchestratorService;
    const processor = new AiAnalysisProcessor(orchestrator);

    await expect(processor.process(createJob())).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(recordFailure).toHaveBeenCalledWith(
      'job-1',
      'AUTHENTICATION_FAILED',
      'Denied',
      false,
    );
  });
});
