import type { JobsOptions } from 'bullmq';

export const AI_ANALYSIS_QUEUE = 'ai-analysis';
export const ANALYZE_SUBMISSION_JOB = 'analyze-submission';

export interface AnalyzeSubmissionJobData {
  aiJobId: string;
  submissionId: string;
  requestFingerprint: string;
  sourceRevision: string | null;
}

export function createAiAnalysisDefaultJobOptions(
  attemptsValue: string | number | undefined = 3,
): JobsOptions {
  const attempts = Number(attemptsValue);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error('AI_JOB_ATTEMPTS must be an integer between 1 and 10');
  }

  return {
    attempts,
    backoff: {
      type: 'exponential',
      delay: 2_000,
    },
    removeOnComplete: {
      age: 7 * 24 * 60 * 60,
      count: 10_000,
    },
    removeOnFail: {
      age: 30 * 24 * 60 * 60,
      count: 10_000,
    },
  };
}

export const AI_ANALYSIS_DEFAULT_JOB_OPTIONS: Readonly<JobsOptions> =
  Object.freeze(createAiAnalysisDefaultJobOptions());
