import { uniqueSorted } from '../../../shared/contracts/collections.js';
import type { AttackVector } from '../../attack-planning/plan/index.js';
import { type EvidenceMap, mappedControlFactIdsForObligation } from '../evidence-map/contract.js';
import {
  type SourcePosture,
  SourcePostureSchema,
  type UnverifiedSourcePosture,
} from './contract.js';

export type SourcePostureVerificationResult = Readonly<{
  sourcePosture: SourcePosture;
  rejectedAssessmentCount: number;
  complete: boolean;
}>;

/**
 * Validates one recovery fragment against only the map facts available to that
 * child. Complete obligation and control coverage is intentionally deferred to
 * {@link verifySourcePosture} after all children have been reduced.
 */
export function verifySourcePostureFragment(
  vector: AttackVector,
  sourcePosture: UnverifiedSourcePosture,
  evidenceMap: EvidenceMap,
): Readonly<{ sourcePosture: SourcePosture; rejectedAssessmentCount: number }> {
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const assessments = sourcePosture.assessments.filter((assessment) => {
    if (!vector.reviewObligations.some((item) => item.obligationId === assessment.obligationId))
      return false;
    const allBound = assessment.evidenceMapFactIds.every((factId) => {
      const fact = facts.get(factId);
      return fact?.planObligations.some(
        (reference) => reference.obligationId === assessment.obligationId,
      );
    });
    const controlsAreConsidered = mappedControlFactIdsForObligation(
      evidenceMap,
      assessment.obligationId,
    ).every((factId) => assessment.evidenceMapFactIds.includes(factId));
    return allBound && controlsAreConsidered;
  });
  return Object.freeze({
    sourcePosture: SourcePostureSchema.parse({
      assessments: assessments.map((assessment) => ({
        assessmentId: assessment.assessmentId,
        obligationId: assessment.obligationId,
        conclusion: assessment.conclusion,
        summary: assessment.summary,
        evidenceMapFactIds: assessment.evidenceMapFactIds,
        ...(assessment.notApplicableReason === null || assessment.notApplicableReason === undefined
          ? {}
          : { notApplicableReason: assessment.notApplicableReason }),
        limitations:
          assessment.limitations.length > 0 ? ['model-declared-limitation' as const] : [],
      })),
      limitations:
        sourcePosture.limitations.length > 0 ? ['model-declared-limitation' as const] : [],
    }),
    rejectedAssessmentCount: sourcePosture.assessments.length - assessments.length,
  });
}

/**
 * Checks only question/map provenance. Conclusions remain model judgments and
 * are never inferred from source text or language-specific logic.
 */
export function verifySourcePosture(
  vector: AttackVector,
  sourcePosture: UnverifiedSourcePosture,
  evidenceMap: EvidenceMap,
): SourcePostureVerificationResult {
  const fragment = verifySourcePostureFragment(vector, sourcePosture, evidenceMap);
  const assessments = fragment.sourcePosture.assessments;
  const complete =
    assessments.length === vector.reviewObligations.length &&
    vector.reviewObligations.every((obligation) =>
      assessments.some((assessment) => assessment.obligationId === obligation.obligationId),
    );
  const limitations = complete
    ? fragment.sourcePosture.limitations
    : uniqueSorted([...fragment.sourcePosture.limitations, 'obligation-assessment-missing']);
  return Object.freeze({
    sourcePosture: SourcePostureSchema.parse({
      assessments,
      limitations,
    }),
    rejectedAssessmentCount: fragment.rejectedAssessmentCount,
    complete,
  });
}

/**
 * A posture without the required tool observation cannot retain a directional
 * conclusion. It remains a complete advisory phase so later bounded discovery
 * can inspect source itself instead of treating a missing posture tool call as
 * a terminal audit result.
 */
export function downgradeUninspectedSourcePosture(sourcePosture: SourcePosture): SourcePosture {
  return SourcePostureSchema.parse({
    assessments: sourcePosture.assessments.map((assessment) => ({
      ...assessment,
      conclusion: 'inconclusive',
      limitations: uniqueSorted([...assessment.limitations, 'source-inspection-missing']),
    })),
    limitations: uniqueSorted([...sourcePosture.limitations, 'source-inspection-missing']),
  });
}
