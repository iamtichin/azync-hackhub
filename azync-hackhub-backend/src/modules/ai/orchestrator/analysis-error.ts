export type AnalysisErrorCode =
  | 'AI_NOT_CONFIGURED'
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_AI_OUTPUT'
  | 'VALIDATION_FAILED'
  | 'SUBMISSION_NOT_FOUND'
  | 'ENQUEUE_FAILED'
  | 'JOB_STATE_RECONCILIATION_REQUIRED'
  | 'INTERNAL_ERROR';

export class AnalysisError extends Error {
  constructor(
    public readonly code: AnalysisErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly repairable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AnalysisError';
  }
}

export function sanitizeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Unknown error';

  return error.message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/(?:sk|ghp|github_pat)_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .slice(0, 1_000);
}
