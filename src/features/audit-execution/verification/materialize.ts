import {
  hasExactPlanObligations,
  type SourceEvidenceRole,
} from '../../attack-planning/plan.schema.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type {
  AuditVerificationResult,
  UnverifiedAuditVerificationResult,
  VerifiableHypothesis,
} from './contract.js';
import { preservesClaimEvidenceSelectionLineage } from './contract.js';
import {
  createVerificationEvidenceSelectionBasis,
  selectionIsInBasis,
  type VerificationEvidenceSelectionBasis,
} from './evidence-basis.js';

type AcceptedUnverifiedAuditVerificationResult = Extract<
  UnverifiedAuditVerificationResult,
  { decision: 'accepted' }
>;
type ResolvedUnverifiedAuditVerificationResult = Exclude<
  UnverifiedAuditVerificationResult,
  { decision: 'incomplete' }
>;

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
  const evidenceSelectionBasis = createVerificationEvidenceSelectionBasis({
    hypothesis,
    evidenceMap,
    sourcePosture,
  });
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  if (output.decision === 'incomplete') {
    const inspectedEvidence = (output.inspectedEvidenceSelections ?? []).map((selection) =>
      selectedEvidence(selection, allEvidenceSelections(evidenceSelectionBasis), facts, 'source'),
    );
    if (inspectedEvidence.some((evidence) => evidence === undefined)) return undefined;
    return {
      decision: 'incomplete',
      reasonCode: output.reasonCode,
      claimEvidenceBundles: null,
      contradictionEvidence: null,
      inspectedEvidence: inspectedEvidence.filter(
        (evidence): evidence is NonNullable<typeof evidence> => evidence !== undefined,
      ),
      verifiedPlanObligations: [],
      affectedPlanObligations: [],
      controlAssessment: null,
      obligationReconciliations: [],
      postureReconciliations: [],
      ...(output.mapInsufficiencies === undefined
        ? {}
        : { mapInsufficiencies: output.mapInsufficiencies }),
    };
  }
  if (output.decision === 'rejected') {
    const contradictionEvidence = output.contradictionEvidenceSelections.map((selection) =>
      selectedEvidence(
        selection,
        allEvidenceSelections(evidenceSelectionBasis),
        facts,
        'counterevidence',
      ),
    );
    if (
      contradictionEvidence.some((evidence) => evidence === undefined) ||
      !hasExactPlanObligations(output.affectedPlanObligations, hypothesis.planObligations)
    ) {
      return undefined;
    }
    const reconciliations = materializeReconciliations(
      output,
      hypothesis,
      evidenceSelectionBasis,
      facts,
    );
    if (reconciliations === undefined) return undefined;
    return {
      decision: 'rejected',
      reasonCode: output.reasonCode,
      claimEvidenceBundles: null,
      contradictionEvidence: contradictionEvidence.filter(
        (evidence): evidence is NonNullable<typeof evidence> => evidence !== undefined,
      ),
      inspectedEvidence: [],
      verifiedPlanObligations: [],
      affectedPlanObligations: output.affectedPlanObligations,
      controlAssessment: null,
      ...reconciliations,
    };
  }
  if (
    output.obligationReconciliations.some(
      (reconciliation) => reconciliation.disposition === 'unresolved',
    ) ||
    output.postureReconciliations.some(
      (reconciliation) => reconciliation.disposition === 'unresolved',
    )
  ) {
    return undefined;
  }
  const claimEvidenceBundles = materializeClaimEvidenceBundles(
    output.claimEvidenceBundles,
    evidenceSelectionBasis.hypothesisSelections,
    facts,
  );
  if (
    claimEvidenceBundles === undefined ||
    !preservesClaimEvidenceSelectionLineage(
      hypothesis.claimEvidenceSelections,
      output.claimEvidenceBundles,
    )
  ) {
    return undefined;
  }
  const controlEvidence = output.controlAssessment.evidenceSelections.map((selection) =>
    selectedEvidence(selection, evidenceSelectionBasis.controlSelections, facts, 'source'),
  );
  if (
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
  const reconciliations = materializeReconciliations(
    output,
    hypothesis,
    evidenceSelectionBasis,
    facts,
  );
  if (reconciliations === undefined) return undefined;
  return {
    decision: 'accepted',
    reasonCode: output.reasonCode,
    claimEvidenceBundles,
    contradictionEvidence: null,
    inspectedEvidence: [],
    verifiedPlanObligations: hypothesis.planObligations,
    affectedPlanObligations: [],
    controlAssessment: {
      conclusion: output.controlAssessment.conclusion,
      evidence: resolvedControlEvidence,
      consideredEvidenceMapFactIds: evidenceSelectionBasis.requiredControlFactIds,
    },
    ...reconciliations,
  };
}

function selectedEvidence(
  selection: { factId: string; evidenceIndex: number },
  allowedSelections: readonly { factId: string; evidenceIndex: number }[],
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
  role: SourceEvidenceRole,
) {
  if (!selectionIsInBasis(allowedSelections, selection)) return undefined;
  const evidence = facts.get(selection.factId)?.evidence[selection.evidenceIndex];
  return evidence === undefined ? undefined : { ...evidence, role };
}

function materializeClaimEvidenceBundles(
  bundles: AcceptedUnverifiedAuditVerificationResult['claimEvidenceBundles'],
  allowedSelections: readonly { factId: string; evidenceIndex: number }[],
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
) {
  const materialized = bundles.map((bundle) => {
    const evidence = bundle.selections.map((selection) =>
      selectedEvidence(selection, allowedSelections, facts, bundle.role),
    );
    if (evidence.some((item) => item === undefined)) return undefined;
    return {
      role: bundle.role,
      evidence: evidence.filter((item): item is NonNullable<typeof item> => item !== undefined),
    };
  });
  return materialized.some((bundle) => bundle === undefined)
    ? undefined
    : materialized.filter((bundle): bundle is NonNullable<typeof bundle> => bundle !== undefined);
}

function materializeReconciliations(
  output: ResolvedUnverifiedAuditVerificationResult,
  hypothesis: VerifiableHypothesis,
  evidenceSelectionBasis: VerificationEvidenceSelectionBasis,
  facts: ReadonlyMap<string, EvidenceMap['facts'][number]>,
) {
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

function allEvidenceSelections(
  basis: VerificationEvidenceSelectionBasis,
): readonly { factId: string; evidenceIndex: number }[] {
  return [
    ...basis.hypothesisSelections,
    ...basis.controlSelections,
    ...basis.obligationSelections.flatMap((item) => item.selections),
    ...basis.postureSelections.flatMap((item) => item.selections),
  ];
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
