import { hasExactPlanObligations } from '../../attack-planning/plan.schema.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import { redactArtifactText } from '../investigation/redaction.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type {
  AuditVerificationResult,
  UnverifiedAuditVerificationResult,
  VerifiableHypothesis,
} from './contract.js';
import { createVerificationEvidenceSelectionBasis, selectionIsInBasis } from './evidence-basis.js';

/**
 * Projects a verifier's selected neutral-map evidence into the canonical
 * result. This is provenance validation only; it does not judge the claim.
 */
export function materializeVerificationResult(
  output: UnverifiedAuditVerificationResult,
  hypothesis: VerifiableHypothesis,
  evidenceMap: EvidenceMap,
  sourcePosture: SourcePosture,
): AuditVerificationResult | undefined {
  if (output.decision !== 'accepted') {
    return {
      decision: output.decision,
      reason: redactArtifactText(output.reason),
      verifiedEvidence: null,
      verifiedPlanObligations: [],
      controlAssessment: null,
      obligationReconciliations: [],
      postureReconciliations: [],
    };
  }
  const evidenceSelectionBasis = createVerificationEvidenceSelectionBasis({
    hypothesis,
    evidenceMap,
    sourcePosture,
  });
  if (
    output.operationEvidence === null ||
    output.unsafeConditionEvidence === null ||
    output.controlAssessment === null ||
    output.obligationReconciliations.some(
      (reconciliation) => reconciliation.disposition === 'unresolved',
    ) ||
    output.postureReconciliations.some(
      (reconciliation) => reconciliation.disposition === 'unresolved',
    )
  ) {
    return undefined;
  }
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const operation = selectedEvidence(
    output.operationEvidence,
    evidenceSelectionBasis.hypothesisSelections,
    facts,
    'operation',
  );
  const unsafeCondition = selectedEvidence(
    output.unsafeConditionEvidence,
    evidenceSelectionBasis.hypothesisSelections,
    facts,
    'unsafe-condition',
  );
  const controlEvidence = output.controlAssessment.evidenceSelections.map((selection) =>
    selectedEvidence(selection, evidenceSelectionBasis.controlSelections, facts, 'source'),
  );
  if (
    operation === undefined ||
    unsafeCondition === undefined ||
    controlEvidence.some((evidence) => evidence === undefined) ||
    !everyRequiredControlHasSelection(
      output.controlAssessment.evidenceSelections,
      evidenceSelectionBasis.requiredControlFactIds,
    )
  ) {
    return undefined;
  }
  const resolvedControlEvidence = controlEvidence.filter(
    (evidence): evidence is NonNullable<typeof evidence> => evidence !== undefined,
  );
  const obligationReconciliations = output.obligationReconciliations.map((reconciliation) => {
    if (
      !hypothesis.planObligations.some(
        (obligation) => obligation.obligationId === reconciliation.planObligation.obligationId,
      )
    ) {
      return undefined;
    }
    const allowedSelections = evidenceSelectionBasis.obligationSelections.find(
      (basis) => basis.planObligation.obligationId === reconciliation.planObligation.obligationId,
    )?.selections;
    if (allowedSelections === undefined) return undefined;
    const evidence = reconciliation.evidenceSelections.map((selection) =>
      selectedEvidence(selection, allowedSelections, facts, 'source'),
    );
    if (evidence.some((item) => item === undefined)) return undefined;
    return {
      planObligation: reconciliation.planObligation,
      disposition: reconciliation.disposition,
      explanation: redactArtifactText(reconciliation.explanation),
      evidence: evidence.filter((item): item is NonNullable<typeof item> => item !== undefined),
    };
  });
  if (
    obligationReconciliations.some((reconciliation) => reconciliation === undefined) ||
    !hasExactPlanObligations(
      output.obligationReconciliations.map((reconciliation) => reconciliation.planObligation),
      hypothesis.planObligations,
    )
  ) {
    return undefined;
  }
  const postureReconciliations = output.postureReconciliations.map((reconciliation) => {
    const basis = evidenceSelectionBasis.postureSelections.find(
      (candidate) => candidate.assessmentId === reconciliation.assessmentId,
    );
    if (basis === undefined) return undefined;
    const evidence = reconciliation.evidenceSelections.map((selection) =>
      selectedEvidence(selection, basis.selections, facts, 'source'),
    );
    if (evidence.some((item) => item === undefined)) return undefined;
    return {
      assessmentId: reconciliation.assessmentId,
      disposition: reconciliation.disposition,
      explanation: redactArtifactText(reconciliation.explanation),
      evidence: evidence.filter((item): item is NonNullable<typeof item> => item !== undefined),
    };
  });
  if (
    postureReconciliations.some((reconciliation) => reconciliation === undefined) ||
    !hasExactlyRequiredPostureReconciliations(
      output.postureReconciliations,
      evidenceSelectionBasis.postureSelections.map((assessment) => assessment.assessmentId),
    )
  ) {
    return undefined;
  }
  return {
    decision: 'accepted',
    reason: redactArtifactText(output.reason),
    verifiedEvidence: [operation, unsafeCondition],
    verifiedPlanObligations: hypothesis.planObligations,
    controlAssessment: {
      conclusion: output.controlAssessment.conclusion,
      explanation: redactArtifactText(output.controlAssessment.explanation),
      evidence: resolvedControlEvidence,
      consideredEvidenceMapFactIds: evidenceSelectionBasis.requiredControlFactIds,
    },
    obligationReconciliations: obligationReconciliations.filter(
      (reconciliation): reconciliation is NonNullable<typeof reconciliation> =>
        reconciliation !== undefined,
    ),
    postureReconciliations: postureReconciliations.filter(
      (reconciliation): reconciliation is NonNullable<typeof reconciliation> =>
        reconciliation !== undefined,
    ),
  };
}

function selectedEvidence(
  selection: { factId: string; evidenceIndex: number },
  allowedSelections: readonly { factId: string; evidenceIndex: number }[],
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
  role: 'operation' | 'unsafe-condition' | 'source',
) {
  if (!selectionIsInBasis(allowedSelections, selection)) return undefined;
  const evidence = facts.get(selection.factId)?.evidence[selection.evidenceIndex];
  return evidence === undefined ? undefined : { ...evidence, role };
}

function everyRequiredControlHasSelection(
  selections: readonly { factId: string }[],
  requiredControlFactIds: readonly string[],
): boolean {
  return requiredControlFactIds.every((factId) =>
    selections.some((selection) => selection.factId === factId),
  );
}

function hasExactlyRequiredPostureReconciliations(
  reconciliations: readonly { assessmentId: string }[],
  requiredAssessmentIds: readonly string[],
): boolean {
  const selectedIds = reconciliations.map((reconciliation) => reconciliation.assessmentId);
  return (
    selectedIds.length === requiredAssessmentIds.length &&
    new Set(selectedIds).size === selectedIds.length &&
    requiredAssessmentIds.every((assessmentId) => selectedIds.includes(assessmentId))
  );
}
