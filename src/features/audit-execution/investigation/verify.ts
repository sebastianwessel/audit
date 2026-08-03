import { textLinesWithoutEndings } from '../../../platform/filesystem/text-lines.js';
import {
  type AttackVector,
  hasApprovedPlanObligations,
  type ProposedFinding,
  planObligationKey,
} from '../../attack-planning/plan.schema.js';
import type { SourceDocument } from '../audit.schema.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import { type VerifiableHypothesis, VerifiableHypothesisSchema } from '../verification/contract.js';
import type { CandidateStructuralRejectionReason } from './contract.js';
import { redactArtifactText } from './redaction.js';

export type FindingVerificationResult<Candidate extends ProposedFinding> = Readonly<{
  verified: readonly VerifiableHypothesis[];
  rejectedCount: number;
  rejectionReasons: readonly string[];
  rejected: readonly Readonly<{
    candidate: Candidate;
    reason: CandidateStructuralRejectionReason;
  }>[];
}>;

/** Verifies model output against only the bounded source package it was allowed to inspect. */
export function verifyModelFindings<Candidate extends ProposedFinding>(
  vector: AttackVector,
  findings: readonly Candidate[],
  sources: readonly SourceDocument[],
  evidenceMap?: EvidenceMap,
  sourcePosture?: SourcePosture,
  requireClaimMapLocationBinding = true,
): FindingVerificationResult<Candidate> {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const verified: VerifiableHypothesis[] = [];
  const rejectionReasons: string[] = [];
  const rejected: Array<
    Readonly<{ candidate: Candidate; reason: CandidateStructuralRejectionReason }>
  > = [];
  for (const finding of findings) {
    const parsedHypothesis = VerifiableHypothesisSchema.safeParse(finding);
    if (!parsedHypothesis.success) {
      rejectionReasons.push('model-hypothesis-invalid');
      rejected.push({ candidate: finding, reason: 'model-hypothesis-invalid' });
      continue;
    }
    const hypothesis = parsedHypothesis.data;
    if (hypothesis.vectorId !== vector.vectorId) {
      rejectionReasons.push('model-vector-mismatch');
      continue;
    }
    if (!hasApprovedPlanObligations(vector, hypothesis.planObligations)) {
      rejectionReasons.push('model-plan-obligation-invalid');
      rejected.push({ candidate: finding, reason: 'model-plan-obligation-invalid' });
      continue;
    }
    if (
      evidenceMap !== undefined &&
      !hasValidEvidenceMapReferences(hypothesis, evidenceMap, requireClaimMapLocationBinding)
    ) {
      rejectionReasons.push('model-evidence-map-reference-invalid');
      rejected.push({ candidate: finding, reason: 'model-evidence-map-reference-invalid' });
      continue;
    }
    if (
      sourcePosture !== undefined &&
      !hasValidSourcePostureReferences(hypothesis, sourcePosture)
    ) {
      rejectionReasons.push('model-source-posture-reference-invalid');
      rejected.push({ candidate: finding, reason: 'model-source-posture-reference-invalid' });
      continue;
    }
    if (!hasRequiredClaimEvidence(hypothesis)) {
      rejectionReasons.push('model-claim-evidence-insufficient');
      rejected.push({ candidate: finding, reason: 'model-claim-evidence-insufficient' });
      continue;
    }
    if (!hasAnyInScopeEvidenceLine(hypothesis, byPath)) {
      rejectionReasons.push('model-evidence-invalid-or-out-of-scope');
      rejected.push({ candidate: finding, reason: 'model-evidence-invalid-or-out-of-scope' });
      continue;
    }
    const evidence = hypothesis.evidence.flatMap((item, index) => {
      const source = byPath.get(item.path);
      if (source === undefined) return [];
      const sourceLine = textLinesWithoutEndings(source.content)[item.startLine - 1];
      if (sourceLine === undefined) return [];
      return [
        {
          index,
          ...item,
          endLine: item.startLine,
          snippet: redactArtifactText(sourceLine),
          kind:
            source.languageHint === 'configuration'
              ? ('configuration' as const)
              : ('source' as const),
        },
      ];
    });
    if (evidence.length !== hypothesis.evidence.length) {
      rejectionReasons.push('model-evidence-invalid-or-out-of-scope');
      rejected.push({ candidate: finding, reason: 'model-evidence-invalid-or-out-of-scope' });
      continue;
    }
    const orderedEvidence = evidence.map(({ index: _index, ...item }) => item);
    verified.push({
      ...hypothesis,
      statement: redactArtifactText(hypothesis.statement),
      evidence: orderedEvidence,
      limitations: uniqueSorted([
        ...hypothesis.limitations.map(redactArtifactText),
        'Static evidence was verified for approved scope and source location; runtime reachability remains unproven.',
      ]),
    });
  }
  return Object.freeze({
    verified,
    rejectedCount: findings.length - verified.length,
    rejectionReasons: uniqueSorted(rejectionReasons),
    rejected,
  });
}

function hasRequiredClaimEvidence(finding: ProposedFinding): boolean {
  const unsafeEvidence = finding.evidence.filter((item) => item.role === 'unsafe-condition');
  return finding.evidence.length >= 2 && unsafeEvidence.length > 0;
}

function hasAnyInScopeEvidenceLine(
  finding: ProposedFinding,
  byPath: ReadonlyMap<string, SourceDocument>,
): boolean {
  return finding.evidence.some((evidence) => {
    const source = byPath.get(evidence.path);
    return (
      source !== undefined &&
      textLinesWithoutEndings(source.content)[evidence.startLine - 1] !== undefined
    );
  });
}

function hasValidEvidenceMapReferences(
  finding: VerifiableHypothesis,
  evidenceMap: EvidenceMap,
  requireClaimMapLocationBinding: boolean,
): boolean {
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const selectedFacts = finding.evidenceMapFactIds.map((factId) => facts.get(factId));
  const requiredObligations = new Set(finding.planObligations?.map(planObligationKey));
  return (
    finding.evidenceMapFactIds.length > 0 &&
    selectedFacts.every((fact) => {
      return fact?.planObligations.some((reference) =>
        requiredObligations.has(planObligationKey(reference)),
      );
    }) &&
    (!requireClaimMapLocationBinding ||
      finding.evidence.every((claimEvidence) =>
        selectedFacts.some((fact) =>
          fact?.evidence.some(
            (factEvidence) =>
              factEvidence.path === claimEvidence.path &&
              factEvidence.startLine === claimEvidence.startLine,
          ),
        ),
      )) &&
    finding.planObligations.every((obligation) =>
      finding.evidenceMapFactIds.some((factId) =>
        facts
          .get(factId)
          ?.planObligations.some(
            (reference) => planObligationKey(reference) === planObligationKey(obligation),
          ),
      ),
    )
  );
}

function hasValidSourcePostureReferences(
  finding: VerifiableHypothesis,
  sourcePosture: SourcePosture,
): boolean {
  const assessments = new Map(
    sourcePosture.assessments.map((assessment) => [assessment.assessmentId, assessment] as const),
  );
  const selected = finding.sourcePostureAssessmentIds.map((assessmentId) =>
    assessments.get(assessmentId),
  );
  if (selected.some((assessment) => assessment === undefined)) return false;
  const facts = new Set(finding.evidenceMapFactIds);
  return finding.planObligations.every((reference) =>
    selected.some(
      (assessment) =>
        assessment?.obligationId === reference.obligationId &&
        assessment.evidenceMapFactIds.every((factId) => facts.has(factId)),
    ),
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
