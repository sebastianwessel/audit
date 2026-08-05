import { hasExactPlanObligations } from '../attack-planning/index.js';
import type { EvidenceMap } from './evidence-map/contract.js';
import { mappedControlFactIdsForObligation } from './evidence-map/contract.js';
import type { SourcePosture } from './source-posture/contract.js';
import type {
  PlanObligationReconciliation,
  SourcePostureReconciliation,
  VerifiableHypothesis,
} from './verification/contract.js';

/** Validates only declared posture coverage and neutral-map provenance. */
export function hasCompletePostureReconciliation(
  reconciliations: readonly SourcePostureReconciliation[],
  hypothesis: VerifiableHypothesis,
  sourcePosture: SourcePosture,
  evidenceMap: EvidenceMap,
): boolean {
  const requiredAssessments = sourcePosture.assessments.filter((assessment) =>
    hypothesis.planObligations.some(
      (obligation) => obligation.obligationId === assessment.obligationId,
    ),
  );
  if (
    reconciliations.length !== requiredAssessments.length ||
    reconciliations.some((reconciliation) => reconciliation.disposition === 'unresolved')
  ) {
    return false;
  }
  const reconciledAssessmentIds = reconciliations.map(
    (reconciliation) => reconciliation.assessmentId,
  );
  if (
    new Set(reconciledAssessmentIds).size !== reconciledAssessmentIds.length ||
    !requiredAssessments.every((assessment) =>
      reconciledAssessmentIds.includes(assessment.assessmentId),
    )
  ) {
    return false;
  }
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  return reconciliations.every((reconciliation) => {
    const assessment = requiredAssessments.find(
      (candidate) => candidate.assessmentId === reconciliation.assessmentId,
    );
    if (assessment === undefined) return false;
    const permittedEvidence = assessment.evidenceMapFactIds.flatMap(
      (factId) => facts.get(factId)?.evidence ?? [],
    );
    return reconciliation.evidence.every((evidence) =>
      permittedEvidence.some(
        (mapEvidence) =>
          mapEvidence.path === evidence.path && mapEvidence.startLine === evidence.startLine,
      ),
    );
  });
}

/**
 * Detects source-scoped disagreement between independent model judgments.
 * This remains provenance only; it never infers a security conclusion.
 */
export function hasCandidateBlindPostureContradiction(
  hypothesis: VerifiableHypothesis,
  sourcePosture: SourcePosture,
): boolean {
  return sourcePosture.assessments.some(
    (assessment) =>
      assessment.conclusion === 'risk-contradicted' &&
      hypothesis.planObligations.some(
        (obligation) => obligation.obligationId === assessment.obligationId,
      ),
  );
}

/** Validates only approved-obligation coverage and map-selected provenance. */
export function hasCompletePlanObligationReconciliation(
  reconciliations: readonly PlanObligationReconciliation[],
  hypothesis: VerifiableHypothesis,
  evidenceMap: EvidenceMap,
): boolean {
  if (
    !hasExactPlanObligations(
      reconciliations.map((reconciliation) => reconciliation.planObligation),
      hypothesis.planObligations,
    ) ||
    reconciliations.some((reconciliation) => reconciliation.disposition === 'unresolved')
  ) {
    return false;
  }
  return reconciliations.every((reconciliation) => {
    const permittedEvidence = evidenceMap.facts
      .filter((fact) =>
        fact.planObligations.some(
          (obligation) => obligation.obligationId === reconciliation.planObligation.obligationId,
        ),
      )
      .flatMap((fact) => fact.evidence);
    return reconciliation.evidence.every((evidence) =>
      permittedEvidence.some(
        (mapEvidence) =>
          mapEvidence.path === evidence.path && mapEvidence.startLine === evidence.startLine,
      ),
    );
  });
}

/** Every neutral relevant control must be considered with source evidence. */
export function hasCompleteMappedControlConsideration(
  consideredFactIds: readonly string[],
  controlEvidence: readonly { path: string; startLine: number }[],
  hypothesis: VerifiableHypothesis,
  evidenceMap: EvidenceMap,
): boolean {
  const requiredFactIds = hypothesis.planObligations.flatMap((obligation) =>
    mappedControlFactIdsForObligation(evidenceMap, obligation.obligationId),
  );
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  return requiredFactIds.every((factId) => {
    const fact = facts.get(factId);
    return (
      fact !== undefined &&
      consideredFactIds.includes(factId) &&
      fact.evidence.some((factEvidence) =>
        controlEvidence.some(
          (verifierEvidence) =>
            verifierEvidence.path === factEvidence.path &&
            verifierEvidence.startLine === factEvidence.startLine,
        ),
      )
    );
  });
}
