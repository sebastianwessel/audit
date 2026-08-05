import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';

import type { AuditCheckpointExecution } from './audit.schema.js';

/** Makes the ownership choice explicit at the durable audit boundary. */
export function auditCheckpointExecutionForModelObservation(
  modelObservation: ModelStageObservation | undefined,
): AuditCheckpointExecution {
  return modelObservation === undefined
    ? { kind: 'deterministic' }
    : { kind: 'provider', modelObservation };
}

/** Converts an opaque persistence callback failure into the one stable audit error. */
export async function persistAuditCheckpoint(
  callback: () => Promise<void> | undefined,
): Promise<void> {
  try {
    await callback();
  } catch {
    throw new AuditRuntimeError(
      'checkpoint-persistence-failed',
      'A required audit checkpoint could not be persisted.',
    );
  }
}

export function isCheckpointPersistenceError(error: unknown): error is AuditRuntimeError {
  return error instanceof AuditRuntimeError && error.code === 'checkpoint-persistence-failed';
}
