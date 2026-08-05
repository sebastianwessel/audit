import { AgentLoopBudgetError, isHarnessError, ModelError } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/audit-harness.js';
import {
  type AuditErrorCode,
  AuditRuntimeError,
} from '../../../shared/errors/audit-runtime-error.js';
import { isContextLengthExceeded } from './context-overflow.js';
import {
  errorCauseChain,
  ModelOutputValidationError,
  type ModelRetryGuidance,
  outputValidationRetryGuidance,
  ValidationRepairNoProgressError,
} from './retry-guidance.js';

export type StageRetryAttempt = Readonly<{
  ordinal: number;
  guidance: ModelRetryGuidance;
}>;

/**
 * Coordinates semantic same-scope repair without exposing rejected content.
 * The Harness owns transient provider retry, backoff, and Retry-After handling;
 * this lifecycle retries only output repair and required source inspection.
 */
export async function invokeWithStageRetry<Result>(
  execution: HarnessExecutionConfiguration,
  invoke: (attempt: StageRetryAttempt) => Promise<Result>,
  options: Readonly<{ onRecoverableFailure?: (error: unknown) => void }> = {},
): Promise<Result> {
  const seenValidationSignatures = new Set<string>();
  let sourceInspectionRetried = false;
  let guidance: ModelRetryGuidance = { kind: 'initial' };
  let ordinal = 0;
  for (;;) {
    ordinal += 1;
    try {
      return await invoke({ ordinal, guidance });
    } catch (error) {
      if (!(error instanceof Error) || isContextLengthExceeded(error) || isProviderStop(error)) {
        throw error;
      }
      const validationGuidance = validationRetryGuidance(error);
      if (validationGuidance !== undefined) {
        if (execution.modelRetry !== 'default') throw error;
        if (seenValidationSignatures.has(validationGuidance.signature)) {
          throw new ValidationRepairNoProgressError(validationGuidance);
        }
        seenValidationSignatures.add(validationGuidance.signature);
        options.onRecoverableFailure?.(error);
        guidance = validationGuidance;
        continue;
      }
      const inspectionGuidance = sourceInspectionRetryGuidance(error);
      if (inspectionGuidance !== undefined) {
        if (execution.modelRetry !== 'default') throw error;
        if (sourceInspectionRetried) throw error;
        sourceInspectionRetried = true;
        options.onRecoverableFailure?.(error);
        guidance = inspectionGuidance;
        continue;
      }
      throw error;
    }
  }
}

/** Converts an untrusted provider failure into the stable content-free error code. */
export function stageErrorCode(error: unknown): AuditErrorCode | string {
  for (const cause of errorCauseChain(error)) {
    if (isContextLengthExceeded(cause)) return 'provider-context-overflow';
    if (isProviderStop(cause)) return 'provider-cancelled';
    if (cause instanceof AgentLoopBudgetError) return 'agent-loop-budget-exceeded';
    if (cause instanceof ModelOutputValidationError) return 'provider-response-invalid';
    if (cause instanceof ModelError) return normalizedModelErrorCode(cause.meta?.reason);
    if (isHarnessError(cause) && cause.code === 'VALIDATION_ERROR') {
      const guidance = outputValidationRetryGuidance(cause.meta);
      return guidance?.kind === 'output-validation'
        ? `${guidance.signature}-${guidance.schemaPathLabels.length}`
        : 'validation-output-shape';
    }
  }
  return error instanceof AuditRuntimeError ? error.code : 'provider-failure';
}

/** The harness owns provider normalization; this maps only its closed, content-free token. */
function normalizedModelErrorCode(reason: unknown): AuditErrorCode {
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

/**
 * Converts only Zod's static schema path components into a canonical diagnostic
 * basis. Values, messages, source paths, and model content are never retained.
 */
function validationRetryGuidance(
  error: unknown,
): Extract<ModelRetryGuidance, { kind: 'output-validation' }> | undefined {
  for (const cause of errorCauseChain(error)) {
    if (cause instanceof ModelOutputValidationError) return cause.retryGuidance;
    const guidance =
      isHarnessError(cause) && cause.code === 'VALIDATION_ERROR'
        ? outputValidationRetryGuidance(cause.meta)
        : undefined;
    if (guidance?.kind === 'output-validation') return guidance;
  }
  return undefined;
}

/** Traverses framework wrappers without retaining or exposing their messages or metadata. */
function sourceInspectionRetryGuidance(error: unknown): ModelRetryGuidance | undefined {
  return error instanceof AuditRuntimeError && error.code === 'coverage-incomplete'
    ? { kind: 'source-inspection' }
    : undefined;
}
