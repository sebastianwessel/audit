import type {
  EvaluatorFailureDiagnostic,
  EvaluatorFailureDiagnosticSink,
} from '../../src/features/model-operations/model-operations.js';
import { EvaluatorFailureDiagnosticSchema } from '../../src/features/model-operations/model-operations.schema.js';
import {
  ArtifactStoreError,
  writeJsonArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';

/** Private, opt-in evaluator diagnostic storage; never part of published results. */
export type EvaluatorFailureDiagnosticsStore = Readonly<{
  save: (diagnostic: EvaluatorFailureDiagnostic) => Promise<void>;
}>;

/**
 * Persists only schema-validated, source-free diagnostics under the caller's
 * feature-owned private work root. The caller must not project this store into
 * a checkpoint, score, report, or reuse decision.
 */
export function createEvaluatorFailureDiagnosticsStore(input: {
  outputRoot: string;
  evaluationRunId: string;
  privateWorkPath: string;
}): EvaluatorFailureDiagnosticsStore {
  return Object.freeze({
    save: async (diagnostic) => {
      if (diagnostic.evaluationRunId !== input.evaluationRunId) {
        throw new ArtifactStoreError(
          'artifact-write-failed',
          'An evaluator diagnostic belongs to a different evaluation run.',
        );
      }
      await writeJsonArtifact(
        input.outputRoot,
        `${input.privateWorkPath}/diagnostics/${diagnostic.diagnosticId}.json`,
        EvaluatorFailureDiagnosticSchema,
        diagnostic,
      );
    },
  });
}

/** Binds one evaluator-private store to one source-free stage protocol. */
export function createEvaluatorFailureDiagnosticSink(input: {
  store: EvaluatorFailureDiagnosticsStore;
  evaluationRunId: string;
  protocolFingerprint: string;
  now: () => string;
}): EvaluatorFailureDiagnosticSink {
  return Object.freeze({
    evaluationRunId: input.evaluationRunId,
    protocolFingerprint: input.protocolFingerprint,
    now: input.now,
    write: input.store.save,
  });
}
