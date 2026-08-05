import {
  type AttackVector,
  hasApprovedPlanObligations,
  planObligationKey,
} from '../../attack-planning/index.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import {
  type InvestigationObligationClosure,
  InvestigationObligationClosuresSchema,
  type UnverifiedInvestigationObligationClosure,
} from '../investigation/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import {
  deriveSourcePostureProvenance,
  mergeUniqueIdentifiers,
} from '../source-posture/provenance.js';

/** Validates phase provenance only; the investigator retains security judgment ownership. */
export function verifyInvestigationClosures(
  vector: AttackVector,
  unverified: readonly (
    | UnverifiedInvestigationObligationClosure
    | InvestigationObligationClosure
  )[],
  evidenceMap: EvidenceMap,
  sourcePosture: SourcePosture,
): Readonly<{
  closures: readonly InvestigationObligationClosure[];
  complete: boolean;
}> {
  const canonical = unverified.map((rawClosure) => {
    const closure =
      'sourcePostureAssessmentIds' in rawClosure
        ? (() => {
            const { sourcePostureAssessmentIds: _ignoredModelPostureIds, ...sourceFreeClosure } =
              rawClosure;
            return sourceFreeClosure;
          })()
        : rawClosure;
    const provenance = deriveSourcePostureProvenance([closure.planObligation], sourcePosture);
    return {
      ...closure,
      limitations:
        'sourcePostureAssessmentIds' in rawClosure
          ? closure.limitations
          : closure.limitations.length > 0
            ? (['model-declared-limitation'] as const)
            : [],
      evidenceMapFactIds: mergeUniqueIdentifiers(
        closure.evidenceMapFactIds,
        provenance.evidenceMapFactIds,
      ),
      sourcePostureAssessmentIds: provenance.sourcePostureAssessmentIds,
    };
  });
  const parsed = InvestigationObligationClosuresSchema.safeParse(canonical);
  if (!parsed.success || parsed.data.length !== vector.reviewObligations.length) {
    return { closures: [], complete: false };
  }
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const assessments = new Map(
    sourcePosture.assessments.map((assessment) => [assessment.assessmentId, assessment] as const),
  );
  const valid = parsed.data.every((closure) => {
    if (!hasApprovedPlanObligations(vector, [closure.planObligation])) return false;
    const obligationKey = planObligationKey(closure.planObligation);
    const selectedFacts = closure.evidenceMapFactIds.map((factId) => facts.get(factId));
    if (
      selectedFacts.some(
        (fact) =>
          fact === undefined ||
          !fact.planObligations.some((reference) => planObligationKey(reference) === obligationKey),
      )
    )
      return false;
    const selectedAssessments = closure.sourcePostureAssessmentIds.map((assessmentId) =>
      assessments.get(assessmentId),
    );
    if (
      selectedAssessments.some(
        (assessment) =>
          assessment === undefined ||
          assessment.obligationId !== closure.planObligation.obligationId ||
          !assessment.evidenceMapFactIds.every((factId) =>
            closure.evidenceMapFactIds.includes(factId),
          ),
      )
    )
      return false;
    const hasNotApplicablePosture = selectedAssessments.some(
      (assessment) => assessment?.conclusion === 'not-applicable',
    );
    if (hasNotApplicablePosture !== (closure.disposition === 'not-applicable')) return false;
    return true;
  });
  const expected = new Set(
    vector.reviewObligations.map((obligation) =>
      planObligationKey({ obligationId: obligation.obligationId }),
    ),
  );
  const actual = new Set(parsed.data.map((closure) => planObligationKey(closure.planObligation)));
  const complete =
    valid && expected.size === actual.size && [...expected].every((key) => actual.has(key));
  return { closures: complete ? parsed.data : [], complete };
}
