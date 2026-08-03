import type { PlanObligationReference } from '../../attack-planning/plan.schema.js';
import type { SourcePosture } from './contract.js';

export type SourcePostureProvenance = Readonly<{
  sourcePostureAssessmentIds: readonly string[];
  evidenceMapFactIds: readonly string[];
}>;

/**
 * Projects the posture-owned provenance for exact approved obligation bindings.
 * It does not interpret a posture conclusion or source semantics.
 */
export function deriveSourcePostureProvenance(
  obligations: readonly PlanObligationReference[],
  sourcePosture: SourcePosture,
): SourcePostureProvenance {
  const obligationIds = new Set(obligations.map((obligation) => obligation.obligationId));
  const assessments = sourcePosture.assessments.filter((assessment) =>
    obligationIds.has(assessment.obligationId),
  );
  return {
    sourcePostureAssessmentIds: uniqueSorted(
      assessments.map((assessment) => assessment.assessmentId),
    ),
    evidenceMapFactIds: uniqueSorted(
      assessments.flatMap((assessment) => assessment.evidenceMapFactIds),
    ),
  };
}

export function mergeUniqueIdentifiers(...values: readonly (readonly string[])[]): string[] {
  return uniqueSorted(values.flat());
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
