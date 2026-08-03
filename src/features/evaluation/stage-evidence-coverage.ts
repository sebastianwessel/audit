import type { SourceEvidence } from '../attack-planning/plan.schema.js';
import type { EvidenceMap } from '../audit-execution/evidence-map/contract.js';

import type { CorpusAnswerKey } from './corpus.schema.js';
import { type EvidenceStageCoverage, EvidenceStageCoverageSchema } from './corpus.schema.js';

/**
 * Evaluator-only diagnostic: where answer-key evidence locations first appear
 * in the normal evidence pipeline. It is not model input, a finding rule, or
 * a quality score, and persists only aggregate counts.
 */
export function stageEvidenceCoverage(input: {
  answerKey: CorpusAnswerKey;
  evidenceMaps: readonly EvidenceMap[];
  groundedEvidence: readonly SourceEvidence[];
  verifiedEvidence: readonly SourceEvidence[];
}): EvidenceStageCoverage {
  const expectedRoles = input.answerKey.staticReviewApplicable
    ? input.answerKey.expectedFindings
        .filter((finding) => finding.staticReviewApplicable)
        .flatMap((finding) => finding.evidenceRoles.filter((role) => !role.notApplicable))
    : [];
  const mappedEvidence = input.evidenceMaps.flatMap((map) =>
    map.facts.flatMap((fact) => fact.evidence),
  );
  return EvidenceStageCoverageSchema.parse({
    expectedRoleCount: expectedRoles.length,
    mappedLocationCount: countCovered(expectedRoles, mappedEvidence, false),
    groundedRoleCount: countCovered(expectedRoles, input.groundedEvidence, true),
    verifiedRoleCount: countCovered(expectedRoles, input.verifiedEvidence, true),
  });
}

function countCovered(
  expectedRoles: readonly CorpusAnswerKey['expectedFindings'][number]['evidenceRoles'][number][],
  evidence: readonly SourceEvidence[],
  requireRole: boolean,
): number {
  return expectedRoles.filter((expected) =>
    evidence.some(
      (observed) =>
        (!requireRole || observed.role === expected.role) &&
        expected.ranges.some(
          (range) =>
            observed.path === range.path &&
            observed.startLine <= range.endLine &&
            (observed.endLine ?? observed.startLine) >= range.startLine,
        ),
    ),
  ).length;
}
