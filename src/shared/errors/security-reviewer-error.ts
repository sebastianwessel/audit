export type SecurityReviewerErrorCode =
  | 'invalid-input'
  | 'unsafe-path'
  | 'plan-target-mismatch'
  | 'context-invalid'
  | 'artifact-invalid'
  | 'provider-failure'
  | 'provider-cancelled'
  | 'provider-context-overflow'
  | 'agent-loop-budget-exceeded'
  | 'model-cost-unavailable'
  | 'model-cost-ceiling-reached'
  | 'coverage-incomplete';

export class SecurityReviewerError extends Error {
  public readonly code: SecurityReviewerErrorCode;

  public constructor(code: SecurityReviewerErrorCode, message: string) {
    super(message);
    this.name = 'SecurityReviewerError';
    this.code = code;
  }
}
