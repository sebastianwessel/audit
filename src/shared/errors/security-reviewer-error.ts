import { z } from 'zod';

/** Closed, content-free operational codes that may cross product boundaries. */
export const SecurityReviewerErrorCodeSchema = z.enum([
  'invalid-input',
  'unsafe-path',
  'plan-target-mismatch',
  'context-invalid',
  'artifact-invalid',
  'provider-failure',
  'provider-network',
  'provider-rate-limited',
  'provider-unavailable',
  'provider-http-error',
  'provider-response-invalid',
  'provider-cancelled',
  'provider-context-overflow',
  'agent-loop-budget-exceeded',
  'model-cost-unavailable',
  'model-cost-ceiling-reached',
  'coverage-incomplete',
]);

export type SecurityReviewerErrorCode = z.infer<typeof SecurityReviewerErrorCodeSchema>;

/** Keeps retry affordances aligned with the same closed operational vocabulary. */
export function isRetryableSecurityReviewerErrorCode(code: string): boolean {
  return (
    code === 'provider-failure' ||
    code === 'provider-network' ||
    code === 'provider-rate-limited' ||
    code === 'provider-unavailable'
  );
}

export class SecurityReviewerError extends Error {
  public readonly code: SecurityReviewerErrorCode;

  public constructor(code: SecurityReviewerErrorCode, message: string) {
    super(message);
    this.name = 'SecurityReviewerError';
    this.code = code;
  }
}
