import {
  type AttackVector,
  hasApprovedPlanObligations,
  planObligationKey,
} from '../../attack-planning/plan.schema.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import {
  deriveSourcePostureProvenance,
  mergeUniqueIdentifiers,
} from '../source-posture/provenance.js';
import {
  type HypothesisSeed,
  HypothesisSeedSchema,
  type HypothesisSeedStructuralRejectionReason,
  type UnverifiedHypothesisSeed,
  UnverifiedHypothesisSeedSchema,
} from './contract.js';

/** Validates discovery provenance without deciding whether its hypothesis is a vulnerability. */
export function verifyHypothesisSeeds(
  vector: AttackVector,
  candidates: readonly (UnverifiedHypothesisSeed | HypothesisSeed)[],
  evidenceMap: EvidenceMap,
  sourcePosture: SourcePosture,
): Readonly<{
  verified: readonly HypothesisSeed[];
  rejectedCount: number;
  rejected: readonly Readonly<{ reason: HypothesisSeedStructuralRejectionReason }>[];
}> {
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const assessments = new Map(
    sourcePosture.assessments.map((assessment) => [assessment.assessmentId, assessment] as const),
  );
  const seen = new Set<string>();
  const rejected: Array<Readonly<{ reason: HypothesisSeedStructuralRejectionReason }>> = [];
  const reject = (reason: HypothesisSeedStructuralRejectionReason): HypothesisSeed[] => {
    rejected.push({ reason });
    return [];
  };
  const verified = candidates.flatMap((rawCandidate) => {
    const sourceFreeCandidate =
      'sourcePostureAssessmentIds' in rawCandidate
        ? (() => {
            const { sourcePostureAssessmentIds: _ignoredModelPostureIds, ...candidate } =
              rawCandidate;
            return candidate;
          })()
        : rawCandidate;
    const parsed = UnverifiedHypothesisSeedSchema.safeParse(sourceFreeCandidate);
    if (!parsed.success) return reject('model-hypothesis-invalid');
    if (seen.has(parsed.data.seedId)) return reject('model-seed-duplicate');
    seen.add(parsed.data.seedId);
    if (parsed.data.vectorId !== vector.vectorId) return reject('model-vector-mismatch');
    if (!hasApprovedPlanObligations(vector, parsed.data.planObligations))
      return reject('model-plan-obligation-invalid');
    const provenance = deriveSourcePostureProvenance(parsed.data.planObligations, sourcePosture);
    if (provenance.sourcePostureAssessmentIds.length === 0)
      return reject('model-source-posture-reference-invalid');
    if (
      provenance.sourcePostureAssessmentIds.some(
        (assessmentId) => assessments.get(assessmentId)?.conclusion === 'not-applicable',
      )
    ) {
      return reject('model-source-posture-reference-invalid');
    }
    const candidate = HypothesisSeedSchema.parse({
      ...parsed.data,
      evidenceMapFactIds: mergeUniqueIdentifiers(
        parsed.data.evidenceMapFactIds,
        provenance.evidenceMapFactIds,
      ),
      sourcePostureAssessmentIds: provenance.sourcePostureAssessmentIds,
    });
    const obligationKeys = new Set(candidate.planObligations.map(planObligationKey));
    const selectedFacts = candidate.evidenceMapFactIds.map((factId) => facts.get(factId));
    if (
      selectedFacts.length === 0 ||
      selectedFacts.some(
        (fact) =>
          fact === undefined ||
          !fact.planObligations.some((reference) =>
            obligationKeys.has(planObligationKey(reference)),
          ),
      )
    )
      return reject('model-evidence-map-reference-invalid');
    if (
      candidate.planObligations.some((obligation) =>
        selectedFacts.every(
          (fact) =>
            fact === undefined ||
            !fact.planObligations.some(
              (reference) => planObligationKey(reference) === planObligationKey(obligation),
            ),
        ),
      )
    )
      return reject('model-evidence-map-reference-invalid');
    const selectedAssessments = candidate.sourcePostureAssessmentIds.map((assessmentId) =>
      assessments.get(assessmentId),
    );
    if (
      selectedAssessments.length === 0 ||
      selectedAssessments.some(
        (assessment) =>
          assessment === undefined ||
          !candidate.planObligations.some(
            (reference) => assessment.obligationId === reference.obligationId,
          ) ||
          !assessment.evidenceMapFactIds.every((factId) =>
            candidate.evidenceMapFactIds.includes(factId),
          ),
      )
    )
      return reject('model-source-posture-reference-invalid');
    if (
      candidate.planObligations.some((obligation) =>
        selectedAssessments.every(
          (assessment) =>
            assessment === undefined || assessment.obligationId !== obligation.obligationId,
        ),
      )
    )
      return reject('model-source-posture-reference-invalid');
    return [candidate];
  });
  return Object.freeze({ verified, rejectedCount: rejected.length, rejected });
}
