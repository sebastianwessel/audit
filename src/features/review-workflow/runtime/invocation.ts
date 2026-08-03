import { AgentLoopBudgetError, isHarnessError, ModelError } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import { sha256 } from '../../../shared/contracts/core.js';
import {
  SecurityReviewerError,
  type SecurityReviewerErrorCode,
} from '../../../shared/errors/security-reviewer-error.js';
import { isContextLengthExceeded } from './context-overflow.js';

/** Replays one failed model invocation without changing its approved stage scope. */
export async function invokeWithStageRetry<Result>(
  execution: HarnessExecutionConfiguration,
  invoke: (attempt: number) => Promise<Result>,
  options: Readonly<{ onRecoverableFailure?: (error: unknown) => void }> = {},
): Promise<Result> {
  const maximumAttempts = execution.modelRetry === 'default' ? 2 : 1;
  let failure: Error | undefined;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      return await invoke(attempt);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        attempt === maximumAttempts ||
        isContextLengthExceeded(error) ||
        isProviderStop(error) ||
        isNonRetryableModelFailure(error)
      )
        throw error;
      options.onRecoverableFailure?.(error);
      failure = error;
    }
  }
  throw (
    failure ?? new SecurityReviewerError('provider-failure', 'Agent invocation did not complete.')
  );
}

/** Converts an untrusted provider failure into the stable content-free error code. */
export function stageErrorCode(error: unknown): SecurityReviewerErrorCode | string {
  if (isContextLengthExceeded(error)) return 'provider-context-overflow';
  if (isProviderStop(error)) return 'provider-cancelled';
  if (error instanceof AgentLoopBudgetError) return 'agent-loop-budget-exceeded';
  if (error instanceof ModelError) return normalizedModelErrorCode(error.meta?.reason);
  if (isHarnessError(error) && error.code === 'VALIDATION_ERROR') {
    const paths = validationIssuePathLabels(error.meta);
    return paths.length === 0
      ? 'validation-output-shape'
      : `validation-output-${paths.length}-${sha256(paths.join('\0')).slice(0, 16)}`;
  }
  return error instanceof SecurityReviewerError ? error.code : 'provider-failure';
}

/** The harness owns provider normalization; this maps only its closed, content-free token. */
function normalizedModelErrorCode(reason: unknown): SecurityReviewerErrorCode {
  switch (reason) {
    case 'network':
      return 'provider-network';
    case 'rate_limited':
      return 'provider-rate-limited';
    case 'provider_unavailable':
      return 'provider-unavailable';
    case 'http_error':
      return 'provider-http-error';
    case 'unstructured_response':
    case 'malformed_response':
    case 'embedding_count_mismatch':
    case 'rerank_result_mismatch':
      return 'provider-response-invalid';
    case 'context_length_exceeded':
      return 'provider-context-overflow';
    default:
      return 'provider-failure';
  }
}

/** Timeout and cancellation are terminal stop signals, never application retry candidates. */
function isProviderStop(error: unknown): boolean {
  return isHarnessError(error) && (error.category === 'cancelled' || error.category === 'timeout');
}

/** A harness-declared non-retryable model failure must not receive a blind second dispatch. */
function isNonRetryableModelFailure(error: unknown): boolean {
  return isHarnessError(error) && error.category === 'model' && !error.retriable;
}

/**
 * Converts only Zod's static schema path components into a canonical diagnostic
 * basis. Values, messages, source paths, and model content are never retained.
 */
function validationIssuePathLabels(meta: unknown): string[] {
  if (!isRecord(meta) || meta.where !== 'agent_output' || !Array.isArray(meta.issues)) return [];
  const labels = meta.issues.flatMap((issue) => {
    if (!isRecord(issue) || !Array.isArray(issue.path)) return [];
    const path = issue.path
      .filter((segment): segment is string => typeof segment === 'string')
      .join('.');
    return path.length === 0 ? [] : [path];
  });
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
