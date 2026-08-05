import { z } from 'zod';

/** Closed, content-free operational codes that may cross product boundaries. */
export const AuditRuntimeErrorCodeSchema = z.enum([
  'invalid-input',
  'unsafe-path',
  'plan-target-mismatch',
  'context-invalid',
  'artifact-invalid',
  'checkpoint-persistence-failed',
  'audit-continuation-failed',
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
  'validation-repair-no-progress',
  'finding-identity-conflict',
]);

export type AuditErrorCode = z.infer<typeof AuditRuntimeErrorCodeSchema>;

/** Keeps retry affordances aligned with the same closed operational vocabulary. */
export function isRetryableAuditRuntimeErrorCode(code: string): boolean {
  return (
    code === 'provider-failure' ||
    code === 'provider-network' ||
    code === 'provider-rate-limited' ||
    code === 'provider-unavailable'
  );
}

export class AuditRuntimeError extends Error {
  public readonly code: AuditErrorCode;

  public constructor(code: AuditErrorCode, message: string) {
    super(message);
    this.name = 'AuditRuntimeError';
    this.code = code;
  }
}
