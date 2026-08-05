import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';
import type { AuditReport } from './audit.schema.js';

/**
 * Builds audit-run observations only from independently retained phase
 * observations. Countercheck remains evaluation-only, but its cost must never
 * disappear from an evaluator-owned audit run.
 */
export function modelStagesForAudit(
  input: AuditReport | AuditReport['coverage'],
): readonly ModelStageObservation[] {
  const coverage = Array.isArray(input) ? input : input.coverage;
  return [
    ...coverage.flatMap((entry) =>
      entry.evidenceMapObservation === undefined ? [] : [entry.evidenceMapObservation],
    ),
    ...coverage.flatMap((entry) => entry.evidenceMapRepairObservations ?? []),
    ...coverage.flatMap((entry) =>
      entry.sourcePostureObservation === undefined ? [] : [entry.sourcePostureObservation],
    ),
    ...coverage.flatMap((entry) =>
      entry.modelObservation === undefined ? [] : [entry.modelObservation],
    ),
    ...coverage.flatMap((entry) =>
      entry.candidateGroundingObservation === undefined
        ? []
        : [entry.candidateGroundingObservation],
    ),
    ...coverage.flatMap((entry) => entry.verificationObservations ?? []),
    ...coverage.flatMap((entry) => entry.countercheckObservations ?? []),
  ];
}
