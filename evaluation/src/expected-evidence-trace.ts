import type { AttackPlan, SourceEvidence } from '../../src/features/attack-planning/index.js';
import type { VectorCoverage } from '../../src/features/audit-execution/audit.schema.js';
import type { EvidenceMap } from '../../src/features/audit-execution/evidence-map/contract.js';
import type { SourcePosture } from '../../src/features/audit-execution/source-posture/contract.js';
import {
  type CorpusAnswerKey,
  type ExpectedEvidenceRoleTrace,
  ExpectedEvidenceRoleTraceSchema,
  type TerminalFindingEvidenceMatch,
} from './corpus.schema.js';
import { vectorScopesPath } from './real-world-scorer.js';

/** Builds the evaluator-private expected-role matrix before any audit stage runs. */
export function createExpectedEvidenceRoleTraces(input: {
  answerKey: CorpusAnswerKey;
  plan: AttackPlan;
}): ExpectedEvidenceRoleTrace[] {
  if (!input.answerKey.staticReviewApplicable) return [];
  return input.answerKey.expectedFindings
    .filter((finding) => finding.staticReviewApplicable)
    .flatMap((finding) =>
      finding.evidenceRoles.flatMap((expected) => {
        if (expected.notApplicable) return [];
        return [
          trace({
            findingId: finding.findingId,
            role: expected.role,
            planScoped: expected.ranges.some((range) =>
              vectorScopesPath(
                input.plan.vectors.filter((vector) => vector.enabled),
                range.path,
              ),
            ),
            mapperSelected: false,
            postureReconciled: false,
            discoverySeeded: false,
            groundingSelected: false,
            verifierSelected: false,
            terminalVerifierSelected: false,
            terminalCompleted: false,
          }),
        ];
      }),
    )
    .sort(compareTrace);
}

/** Records that a validated neutral map selected an expected evidence location. */
export function traceMappedEvidence(
  traces: readonly ExpectedEvidenceRoleTrace[],
  answerKey: CorpusAnswerKey,
  evidenceMap: EvidenceMap,
): ExpectedEvidenceRoleTrace[] {
  return update(
    traces,
    answerKey,
    (expected) => evidenceMap.facts.some((fact) => evidenceMatches(expected, fact.evidence, false)),
    'mapperSelected',
  );
}

/** Records posture evidence only through its already validated neutral-map references. */
export function tracePostureEvidence(
  traces: readonly ExpectedEvidenceRoleTrace[],
  answerKey: CorpusAnswerKey,
  evidenceMap: EvidenceMap,
  posture: SourcePosture,
): ExpectedEvidenceRoleTrace[] {
  const factsById = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  return update(
    traces,
    answerKey,
    (expected) =>
      posture.assessments.some((assessment) =>
        assessment.evidenceMapFactIds.some((factId) => {
          const fact = factsById.get(factId);
          return fact !== undefined && evidenceMatches(expected, fact.evidence, false);
        }),
      ),
    'postureReconciled',
  );
}

/**
 * Records whether a valid discovery seed preserves an expected source location
 * in its map basis. Discovery is not a role-selection stage; grounding owns
 * the first operation/unsafe-condition selection.
 */
export function traceDiscoveryEvidence(
  traces: readonly ExpectedEvidenceRoleTrace[],
  answerKey: CorpusAnswerKey,
  evidenceMap: EvidenceMap,
  evidenceMapFactIds: readonly string[],
): ExpectedEvidenceRoleTrace[] {
  const factsById = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  return update(
    traces,
    answerKey,
    (expected) => {
      return evidenceMapFactIds.some((factId) => {
        const fact = factsById.get(factId);
        return fact !== undefined && evidenceMatches(expected, fact.evidence, false);
      });
    },
    'discoverySeeded',
  );
}

/** Records only validated canonical grounding evidence, never raw candidate output. */
export function traceGroundedEvidence(
  traces: readonly ExpectedEvidenceRoleTrace[],
  answerKey: CorpusAnswerKey,
  evidence: readonly SourceEvidence[],
): ExpectedEvidenceRoleTrace[] {
  return update(
    traces,
    answerKey,
    (expected) => evidenceMatches(expected, evidence, true),
    'groundingSelected',
  );
}

/** Records independently verified evidence, including an accepted review-required result. */
export function traceVerifiedEvidence(
  traces: readonly ExpectedEvidenceRoleTrace[],
  answerKey: CorpusAnswerKey,
  evidence: readonly SourceEvidence[],
): ExpectedEvidenceRoleTrace[] {
  return update(
    traces,
    answerKey,
    (expected) => evidenceMatches(expected, evidence, true),
    'verifierSelected',
  );
}

/** Marks terminal coverage only for a completed vector whose scope covered the expected location. */
export function traceTerminalCoverage(
  traces: readonly ExpectedEvidenceRoleTrace[],
  answerKey: CorpusAnswerKey,
  plan: AttackPlan,
  coverage: readonly VectorCoverage[],
): ExpectedEvidenceRoleTrace[] {
  const vectorsById = new Map(plan.vectors.map((vector) => [vector.vectorId, vector] as const));
  return update(
    traces,
    answerKey,
    (expected) =>
      coverage.some((entry) => {
        const vector = vectorsById.get(entry.vectorId);
        return (
          entry.completed &&
          vector !== undefined &&
          expected.ranges.some((range) => vectorScopesPath([vector], range.path))
        );
      }),
    'terminalCompleted',
  );
}

/**
 * Applies the one canonical terminal finding projection after audit completion.
 * Earlier loss markers remain historical diagnostics; this field says whether
 * the exact terminal finding ultimately selected the expected role.
 */
export function traceTerminalFindingEvidence(
  traces: readonly ExpectedEvidenceRoleTrace[],
  terminalMatches: readonly TerminalFindingEvidenceMatch[],
): ExpectedEvidenceRoleTrace[] {
  const selectedByRole = new Map(
    terminalMatches.flatMap((match) =>
      match.roleSelections.map(
        (selection) =>
          [`${match.expectedFindingId}\0${selection.role}`, selection.selected] as const,
      ),
    ),
  );
  return traces.map((entry) =>
    trace({
      ...entry,
      terminalVerifierSelected: selectedByRole.get(`${entry.findingId}\0${entry.role}`) ?? false,
    }),
  );
}

export function firstIncompleteExpectedEvidenceStage(
  trace: Omit<ExpectedEvidenceRoleTrace, 'firstIncompleteStage'>,
): ExpectedEvidenceRoleTrace['firstIncompleteStage'] {
  if (!trace.planScoped) return 'planning-scope';
  if (!trace.mapperSelected) return 'evidence-mapping';
  if (!trace.postureReconciled) return 'source-posture';
  if (!trace.discoverySeeded) return 'investigation';
  if (!trace.groundingSelected) return 'candidate-grounding';
  if (!trace.verifierSelected) return 'verification';
  if (!trace.terminalCompleted) return 'terminal';
  return 'complete';
}

function update(
  traces: readonly ExpectedEvidenceRoleTrace[],
  answerKey: CorpusAnswerKey,
  matches: (expected: ExpectedRole) => boolean,
  field:
    | 'mapperSelected'
    | 'postureReconciled'
    | 'discoverySeeded'
    | 'groundingSelected'
    | 'verifierSelected'
    | 'terminalCompleted',
): ExpectedEvidenceRoleTrace[] {
  return traces.map((entry) => {
    const expected = expectedRole(answerKey, entry);
    if (expected === undefined || !matches(expected)) return entry;
    return trace({ ...entry, [field]: true });
  });
}

type ExpectedRole = CorpusAnswerKey['expectedFindings'][number]['evidenceRoles'][number];

function expectedRole(
  answerKey: CorpusAnswerKey,
  trace: ExpectedEvidenceRoleTrace,
): ExpectedRole | undefined {
  return answerKey.expectedFindings
    .find((finding) => finding.findingId === trace.findingId)
    ?.evidenceRoles.find((role) => role.role === trace.role);
}

function evidenceMatches(
  expected: ExpectedRole,
  evidence: readonly Pick<SourceEvidence, 'path' | 'startLine' | 'endLine' | 'role'>[],
  requireRole: boolean,
): boolean {
  return evidence.some(
    (observed) =>
      (!requireRole || observed.role === expected.role) &&
      expected.ranges.some(
        (range) =>
          observed.path === range.path &&
          observed.startLine <= range.endLine &&
          (observed.endLine ?? observed.startLine) >= range.startLine,
      ),
  );
}

function trace(
  input: Omit<ExpectedEvidenceRoleTrace, 'firstIncompleteStage'>,
): ExpectedEvidenceRoleTrace {
  return ExpectedEvidenceRoleTraceSchema.parse({
    ...input,
    firstIncompleteStage: firstIncompleteExpectedEvidenceStage(input),
  });
}

function compareTrace(left: ExpectedEvidenceRoleTrace, right: ExpectedEvidenceRoleTrace): number {
  return `${left.findingId}\0${left.role}`.localeCompare(`${right.findingId}\0${right.role}`);
}
