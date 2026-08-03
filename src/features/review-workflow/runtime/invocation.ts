import { AgentLoopBudgetError, isHarnessError } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
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
        isProviderStop(error)
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
export function stageErrorCode(error: unknown): string {
  if (isContextLengthExceeded(error)) return 'provider-context-overflow';
  if (isProviderStop(error)) return 'provider-cancelled';
  if (error instanceof AgentLoopBudgetError) return 'agent-loop-budget-exceeded';
  if (isHarnessError(error) && error.code === 'VALIDATION_ERROR') {
    const paths = validationIssuePathLabels(error.meta);
    return paths.length === 0
      ? 'validation-output-shape'
      : `validation-output-${paths.join('+')}`.slice(0, 64);
  }
  return error instanceof SecurityReviewerError ? error.code : 'provider-failure';
}

/** Timeout and cancellation are terminal stop signals, never application retry candidates. */
function isProviderStop(error: unknown): boolean {
  return isHarnessError(error) && (error.category === 'cancelled' || error.category === 'timeout');
}

/**
 * Converts only Zod's static schema path components into a short diagnostic
 * label. Values, messages, source paths, and model content are never retained.
 */
function validationIssuePathLabels(meta: unknown): string[] {
  if (!isRecord(meta) || meta.where !== 'agent_output' || !Array.isArray(meta.issues)) return [];
  const labels = meta.issues.flatMap((issue) => {
    if (!isRecord(issue) || !Array.isArray(issue.path)) return [];
    const path = issue.path
      .filter((segment): segment is string => typeof segment === 'string')
      .slice(0, 3)
      .join('.');
    return path.length === 0 ? [] : [path];
  });
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right)).slice(0, 3);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
