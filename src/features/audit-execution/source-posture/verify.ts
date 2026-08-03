import type { AttackVector } from '../../attack-planning/plan.schema.js';
import { type EvidenceMap, mappedControlFactIdsForObligation } from '../evidence-map/contract.js';
import { redactArtifactText } from '../investigation/redaction.js';
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
 * Checks only question/map provenance. Conclusions remain model judgments and
 * are never inferred from source text or language-specific logic.
 */
export function verifySourcePosture(
  vector: AttackVector,
  sourcePosture: UnverifiedSourcePosture,
  evidenceMap: EvidenceMap,
): SourcePostureVerificationResult {
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
  const complete =
    assessments.length === vector.reviewObligations.length &&
    vector.reviewObligations.every((obligation) =>
      assessments.some((assessment) => assessment.obligationId === obligation.obligationId),
    );
  const limitations = complete
    ? sourcePosture.limitations
    : uniqueSorted([
        ...sourcePosture.limitations,
        'The candidate-blind source posture did not establish every approved review obligation.',
      ]);
  return Object.freeze({
    sourcePosture: SourcePostureSchema.parse({
      assessments: assessments.map((assessment) => ({
        ...assessment,
        ...(assessment.notApplicableReason === null || assessment.notApplicableReason === undefined
          ? {}
          : { notApplicableReason: redactArtifactText(assessment.notApplicableReason) }),
        limitations: assessment.limitations.map(redactArtifactText),
      })),
      limitations: limitations.map(redactArtifactText),
    }),
    rejectedAssessmentCount: sourcePosture.assessments.length - assessments.length,
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
      limitations: uniqueSorted([
        ...assessment.limitations,
        'This posture conclusion was downgraded because the posture stage did not inspect scoped source with a read-only tool.',
      ]),
    })),
    limitations: uniqueSorted([
      ...sourcePosture.limitations,
      'The posture stage made no scoped read-only tool call; directional posture conclusions were downgraded to inconclusive before discovery.',
    ]),
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
