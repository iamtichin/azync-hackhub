import {
  AI_ANALYSIS_DEFAULT_JOB_OPTIONS,
  AI_ANALYSIS_QUEUE,
  ANALYZE_SUBMISSION_JOB,
  createAiAnalysisDefaultJobOptions,
} from './ai-queue.constants';

describe('AI queue constants', () => {
  it('uses stable queue and job names', () => {
    expect(AI_ANALYSIS_QUEUE).toBe('ai-analysis');
    expect(ANALYZE_SUBMISSION_JOB).toBe('analyze-submission');
  });

  it('keeps bounded job history and retries transient failures', () => {
    expect(AI_ANALYSIS_DEFAULT_JOB_OPTIONS).toEqual({
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 604_800, count: 10_000 },
      removeOnFail: { age: 2_592_000, count: 10_000 },
    });
  });

  it('supports a validated attempt override', () => {
    expect(createAiAnalysisDefaultJobOptions('5').attempts).toBe(5);
    expect(() => createAiAnalysisDefaultJobOptions('0')).toThrow(
      'AI_JOB_ATTEMPTS',
    );
  });
});
