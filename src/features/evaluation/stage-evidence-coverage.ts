import type { SourceEvidence } from '../attack-planning/plan.schema.js';
import type { EvidenceMap } from '../audit-execution/evidence-map/contract.js';

import type { CorpusAnswerKey, ExpectedEvidenceRoleTrace } from './corpus.schema.js';
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
  roleTraces?: readonly ExpectedEvidenceRoleTrace[];
}): EvidenceStageCoverage {
  if (input.roleTraces !== undefined) return coverageFromRoleTraces(input.roleTraces);
  const expectedRoles = input.answerKey.staticReviewApplicable
    ? input.answerKey.expectedFindings
        .filter((finding) => finding.staticReviewApplicable)
        .flatMap((finding) => finding.evidenceRoles.filter((role) => !role.notApplicable))
    : [];
  const mappedEvidence = input.evidenceMaps.flatMap((map) =>
    map.facts.flatMap((fact) => fact.evidence),
  );
  const coverage = {
    expectedRoleCount: expectedRoles.length,
    mappedLocationCount: countCovered(expectedRoles, mappedEvidence, false),
    groundedRoleCount: countCovered(expectedRoles, input.groundedEvidence, true),
    verifiedRoleCount: countCovered(expectedRoles, input.verifiedEvidence, true),
  };
  return EvidenceStageCoverageSchema.parse({
    ...coverage,
    firstIncompleteStage: firstIncompleteStage(coverage),
  });
}

/**
 * This is a source-free diagnostic order, not a security conclusion. Later
 * stages may not repair an earlier missing expected-evidence overlap.
 */
function firstIncompleteStage(input: {
  expectedRoleCount: number;
  mappedLocationCount: number;
  groundedRoleCount: number;
  verifiedRoleCount: number;
}): 'not-applicable' | 'evidence-mapping' | 'candidate-grounding' | 'verification' | 'complete' {
  if (input.expectedRoleCount === 0) return 'not-applicable';
  if (input.mappedLocationCount < input.expectedRoleCount) return 'evidence-mapping';
  if (input.groundedRoleCount < input.expectedRoleCount) return 'candidate-grounding';
  if (input.verifiedRoleCount < input.expectedRoleCount) return 'verification';
  return 'complete';
}

function coverageFromRoleTraces(
  roleTraces: readonly ExpectedEvidenceRoleTrace[],
): EvidenceStageCoverage {
  const first = roleTraces
    .map((trace) => trace.firstIncompleteStage)
    .sort((left, right) => stageOrder(left) - stageOrder(right))[0];
  return EvidenceStageCoverageSchema.parse({
    expectedRoleCount: roleTraces.length,
    mappedLocationCount: roleTraces.filter((trace) => trace.mapperSelected).length,
    groundedRoleCount: roleTraces.filter((trace) => trace.groundingSelected).length,
    verifiedRoleCount: roleTraces.filter((trace) => trace.verifierSelected).length,
    firstIncompleteStage: first ?? 'not-applicable',
    roleTraces,
  });
}

function stageOrder(stage: ExpectedEvidenceRoleTrace['firstIncompleteStage']): number {
  return [
    'not-applicable',
    'planning-scope',
    'evidence-mapping',
    'source-posture',
    'investigation',
    'candidate-grounding',
    'verification',
    'terminal',
    'complete',
  ].indexOf(stage);
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
