import {
  type ModelRetryGuidance,
  ModelRetryGuidanceSchema,
  type OutputValidationRetryGuidance,
  outputValidationGuidanceForPaths,
} from '../../../shared/contracts/model-retry-guidance.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import { errorCauseChain } from '../../../shared/errors/cause-chain.js';

export type { ModelRetryGuidance, OutputValidationRetryGuidance };
export { ModelRetryGuidanceSchema, outputValidationGuidanceForPaths };

/**
 * A model-originated structural projection failure. It deliberately retains
 * only closed schema-path labels and their collision-resistant digest.
 */
export class ModelOutputValidationError extends Error {
  readonly retryGuidance: OutputValidationRetryGuidance;

  constructor(retryGuidance: OutputValidationRetryGuidance) {
    super('The model output failed a canonical structural projection.');
    this.name = 'ModelOutputValidationError';
    this.retryGuidance = retryGuidance;
  }
}

/**
 * Terminal retry state for a repeated structural failure. It retains only the
 * safe descriptor already shown to the model, so evaluator-private diagnostics
 * can explain the terminal stop without retaining rejected output.
 */
export class ValidationRepairNoProgressError extends AuditRuntimeError {
  readonly retryGuidance: OutputValidationRetryGuidance;

  constructor(retryGuidance: OutputValidationRetryGuidance) {
    super(
      'validation-repair-no-progress',
      'Model output validation repeated a prior content-free schema signature.',
    );
    this.name = 'ValidationRepairNoProgressError';
    this.retryGuidance = retryGuidance;
  }
}

/** Extracts only static schema-path names from a Harness validation payload. */
export function outputValidationRetryGuidance(meta: unknown): ModelRetryGuidance | undefined {
  const schemaPathLabels = validationIssuePathLabels(meta);
  if (schemaPathLabels.length === 0) return undefined;
  return outputValidationGuidanceForPaths(schemaPathLabels);
}

/**
 * Rejects a model-authored value that passed its transport schema but failed a
 * feature-owned canonical projection. Only static contract labels cross into
 * the next exact-scope attempt.
 */
export function invalidModelOutput(schemaPathLabels: readonly string[]): never {
  throw new ModelOutputValidationError(outputValidationGuidanceForPaths(schemaPathLabels));
}

/** Extracts the safe correction basis from one direct stage failure. */
export function validationRetryGuidanceForError(
  error: unknown,
): OutputValidationRetryGuidance | undefined {
  for (const cause of errorCauseChain(error)) {
    if (
      cause instanceof ModelOutputValidationError ||
      cause instanceof ValidationRepairNoProgressError
    ) {
      return cause.retryGuidance;
    }
    if (!isRecord(cause) || !('meta' in cause)) continue;
    const guidance = outputValidationRetryGuidance(cause.meta);
    if (guidance?.kind === 'output-validation') return guidance;
  }
  return undefined;
}

/** Traverses wrappers without retaining messages, values, or provider metadata. */
export { errorCauseChain } from '../../../shared/errors/cause-chain.js';

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
