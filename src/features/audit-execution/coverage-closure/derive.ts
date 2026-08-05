import {
  type AttackVector,
  findReviewObligation,
  type ProposedFinding,
  planObligationKey,
} from '../../attack-planning/index.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import type { InvestigationObligationClosure } from '../investigation/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import { type ObligationClosureMatrix, ObligationClosureMatrixSchema } from './contract.js';

/**
 * Aggregates phase provenance only. It never judges a vulnerability, reachability,
 * data flow, or control effectiveness.
 */
export function deriveObligationClosureMatrix(input: {
  vector: AttackVector;
  evidenceMap?: EvidenceMap;
  sourcePosture?: SourcePosture;
  investigationClosures?: readonly InvestigationObligationClosure[];
  candidates?: readonly ProposedFinding[];
  admittedFindings?: readonly ProposedFinding[];
  rejectedCandidates?: readonly ProposedFinding[];
  incompleteCandidates?: readonly ProposedFinding[];
  reviewRequiredFindings?: readonly ProposedFinding[];
}): ObligationClosureMatrix {
  const closuresByKey = new Map(
    (input.investigationClosures ?? []).map(
      (closure) => [planObligationKey(closure.planObligation), closure] as const,
    ),
  );
  const map = input.evidenceMap;
  const posture = input.sourcePosture;
  return ObligationClosureMatrixSchema.parse(
    input.vector.reviewObligations.map((obligation) => {
      const reference = { obligationId: obligation.obligationId };
      const key = planObligationKey(reference);
      const factCount =
        map?.facts.filter((fact) =>
          fact.planObligations.some((item) => planObligationKey(item) === key),
        ).length ?? 0;
      const explicitlyUnanswered =
        map?.unansweredPlanObligations.some((item) => planObligationKey(item) === key) ?? false;
      const mapState =
        map === undefined
          ? 'not-reached'
          : factCount > 0
            ? 'mapped'
            : explicitlyUnanswered
              ? 'unanswered'
              : 'not-reached';
      const postureAssessment = posture?.assessments.find(
        (assessment) => assessment.obligationId === obligation.obligationId,
      );
      const closure = closuresByKey.get(key);
      const candidateCount = countForObligation(input.candidates ?? [], key);
      const admittedFindingCount = countForObligation(input.admittedFindings ?? [], key);
      const rejectedCandidateCount = countForObligation(input.rejectedCandidates ?? [], key);
      const incompleteCandidateCount = countForObligation(input.incompleteCandidates ?? [], key);
      const reviewRequiredCount = countForObligation(input.reviewRequiredFindings ?? [], key);
      const investigationState = closure?.disposition ?? 'not-reached';
      const terminalDisposition = deriveTerminalDisposition({
        mapState,
        postureConclusion: postureAssessment?.conclusion,
        investigationState,
        candidateCount,
        admittedFindingCount,
        rejectedCandidateCount,
        incompleteCandidateCount,
        reviewRequiredCount,
      });
      return {
        obligationId: obligation.obligationId,
        planObligation: reference,
        mapState,
        evidenceMapFactCount: factCount,
        sourcePostureConclusion: postureAssessment?.conclusion ?? null,
        notApplicableReason: postureAssessment?.notApplicableReason ?? null,
        ...(postureAssessment?.conclusion !== 'not-applicable' || map === undefined
          ? {}
          : {
              notApplicableEvidence: selectedPostureEvidence(
                map,
                postureAssessment.evidenceMapFactIds,
              ),
            }),
        investigationState,
        candidateCount,
        admittedFindingCount,
        terminalDisposition,
      };
    }),
  );
}

function selectedPostureEvidence(evidenceMap: EvidenceMap, factIds: readonly string[]) {
  const selected = new Set(factIds);
  return evidenceMap.facts
    .filter((fact) => selected.has(fact.factId))
    .flatMap((fact) => fact.evidence)
    .sort((left, right) => {
      const leftKey = `${left.path}\0${left.startLine}\0${left.endLine ?? ''}\0${left.contentDigest}`;
      const rightKey = `${right.path}\0${right.startLine}\0${right.endLine ?? ''}\0${right.contentDigest}`;
      return leftKey.localeCompare(rightKey);
    });
}

export function hasCompleteObligationClosure(matrix: ObligationClosureMatrix): boolean {
  return matrix.every(
    (row) => row.terminalDisposition !== 'incomplete' && row.terminalDisposition !== 'not-reached',
  );
}

function countForObligation(findings: readonly ProposedFinding[], key: string): number {
  return findings.filter((finding) =>
    finding.planObligations.some((reference) => planObligationKey(reference) === key),
  ).length;
}

function deriveTerminalDisposition(input: {
  mapState: 'mapped' | 'unanswered' | 'not-reached';
  postureConclusion:
    | 'risk-supported'
    | 'risk-contradicted'
    | 'inconclusive'
    | 'not-applicable'
    | undefined;
  investigationState:
    | 'candidate-raised'
    | 'no-source-backed-candidate'
    | 'not-applicable'
    | 'incomplete'
    | 'not-reached';
  candidateCount: number;
  admittedFindingCount: number;
  rejectedCandidateCount: number;
  incompleteCandidateCount: number;
  reviewRequiredCount: number;
}):
  | 'finding-admitted'
  | 'candidate-rejected'
  | 'review-required'
  | 'no-source-backed-candidate'
  | 'not-applicable'
  | 'incomplete'
  | 'not-reached' {
  if (
    input.mapState === 'not-reached' ||
    input.postureConclusion === undefined ||
    input.investigationState === 'not-reached'
  ) {
    return 'not-reached';
  }
  if (input.postureConclusion === 'not-applicable') return 'not-applicable';
  if (input.mapState === 'unanswered' || input.investigationState === 'incomplete') {
    return 'incomplete';
  }
  if (input.investigationState === 'candidate-raised' && input.candidateCount === 0) {
    return 'incomplete';
  }
  if (input.investigationState === 'no-source-backed-candidate' && input.candidateCount > 0) {
    return 'incomplete';
  }
  if (input.incompleteCandidateCount > 0) return 'incomplete';
  if (input.admittedFindingCount > 0) return 'finding-admitted';
  if (input.reviewRequiredCount > 0) return 'review-required';
  if (input.rejectedCandidateCount > 0) return 'candidate-rejected';
  if (input.candidateCount > 0) return 'incomplete';
  if (input.postureConclusion === 'inconclusive') return 'incomplete';
  return 'no-source-backed-candidate';
}

/** Ensures model closure references only its declared plan-owned review unit. */
export function hasValidClosurePlanBinding(
  vector: AttackVector,
  closure: InvestigationObligationClosure,
): boolean {
  return findReviewObligation(vector, closure.planObligation) !== undefined;
}
