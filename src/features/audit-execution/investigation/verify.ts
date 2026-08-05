import { uniqueSorted } from '../../../shared/contracts/collections.js';
import {
  type AttackVector,
  type ClaimEvidenceRole,
  hasApprovedPlanObligations,
  planObligationKey,
  type SourceEvidence,
} from '../../attack-planning/index.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import { ClaimNarrativeSchema } from '../narrative/contract.js';
import type { SourceEvidenceResolver } from '../source-evidence-resolver.js';
import type { SourcePosture } from '../source-posture/contract.js';
import { type VerifiableHypothesis, VerifiableHypothesisSchema } from '../verification/contract.js';
import {
  type CandidateStructuralRejectionReason,
  type UnverifiedAuditCandidate,
  UnverifiedAuditCandidateSchema,
} from './contract.js';

type VerificationCandidate = UnverifiedAuditCandidate | VerifiableHypothesis;
type ClaimEvidenceBundleInput = Readonly<{
  role: ClaimEvidenceRole;
  evidence: readonly Readonly<{ path: string; startLine: number }>[];
}>;

export type FindingVerificationResult<Candidate> = Readonly<{
  verified: readonly VerifiableHypothesis[];
  rejectedCount: number;
  rejectionReasons: readonly string[];
  rejected: readonly Readonly<{
    candidate: Candidate;
    reason: CandidateStructuralRejectionReason;
  }>[];
}>;

/** Verifies model output against only the bounded source package it was allowed to inspect. */
export async function verifyModelFindings<Candidate>(
  vector: AttackVector,
  findings: readonly Candidate[],
  sourceEvidence: SourceEvidenceResolver,
  evidenceMap?: EvidenceMap,
  sourcePosture?: SourcePosture,
  requireClaimMapLocationBinding = true,
): Promise<FindingVerificationResult<Candidate>> {
  const verified: VerifiableHypothesis[] = [];
  const rejectionReasons: string[] = [];
  const rejected: Array<
    Readonly<{ candidate: Candidate; reason: CandidateStructuralRejectionReason }>
  > = [];
  for (const finding of findings) {
    const parsedUnverified = UnverifiedAuditCandidateSchema.safeParse(finding);
    let hypothesis: VerificationCandidate;
    if (parsedUnverified.success) {
      hypothesis = parsedUnverified.data;
    } else {
      const parsedCanonical = VerifiableHypothesisSchema.safeParse(finding);
      if (!parsedCanonical.success) {
        rejectionReasons.push('model-hypothesis-invalid');
        rejected.push({ candidate: finding, reason: 'model-hypothesis-invalid' });
        continue;
      }
      hypothesis = parsedCanonical.data;
    }
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
    if (!(await hasAnyInScopeEvidenceLine(hypothesis, sourceEvidence))) {
      rejectionReasons.push('model-evidence-invalid-or-out-of-scope');
      rejected.push({ candidate: finding, reason: 'model-evidence-invalid-or-out-of-scope' });
      continue;
    }
    const claimEvidenceBundles: Array<
      Readonly<{ role: ClaimEvidenceRole; evidence: readonly SourceEvidence[] }> | undefined
    > = [];
    for (const bundle of hypothesis.claimEvidenceBundles) {
      const evidence = [];
      for (const item of bundle.evidence) {
        const reference = await sourceEvidence.resolve({ ...item, role: bundle.role });
        if (reference === undefined) break;
        evidence.push(reference);
      }
      claimEvidenceBundles.push(
        evidence.length === bundle.evidence.length ? { role: bundle.role, evidence } : undefined,
      );
    }
    if (claimEvidenceBundles.some((bundle) => bundle === undefined)) {
      rejectionReasons.push('model-evidence-invalid-or-out-of-scope');
      rejected.push({ candidate: finding, reason: 'model-evidence-invalid-or-out-of-scope' });
      continue;
    }
    verified.push(
      VerifiableHypothesisSchema.parse({
        vectorId: hypothesis.vectorId,
        narrative: narrativeForCandidate(hypothesis),
        claimEvidenceBundles: claimEvidenceBundles.filter(
          (bundle): bundle is NonNullable<typeof bundle> => bundle !== undefined,
        ),
        planObligations: hypothesis.planObligations,
        evidenceMapFactIds: hypothesis.evidenceMapFactIds,
        claimEvidenceSelections: hypothesis.claimEvidenceSelections,
        sourcePostureAssessmentIds: hypothesis.sourcePostureAssessmentIds,
      }),
    );
  }
  return Object.freeze({
    verified,
    rejectedCount: findings.length - verified.length,
    rejectionReasons: uniqueSorted(rejectionReasons),
    rejected,
  });
}

function narrativeForCandidate(candidate: VerificationCandidate) {
  if ('narrative' in candidate) return candidate.narrative;
  return ClaimNarrativeSchema.parse({
    statement: candidate.statement,
    roleExplanations: candidate.claimEvidenceBundles.map((bundle) => ({
      role: bundle.role,
      explanation: bundle.explanation,
    })),
    limitations: candidate.limitations,
  });
}

function hasRequiredClaimEvidence(
  finding: Readonly<{ claimEvidenceBundles: readonly ClaimEvidenceBundleInput[] }>,
): boolean {
  return (
    finding.claimEvidenceBundles.length === 2 &&
    finding.claimEvidenceBundles.every((bundle) => bundle.evidence.length > 0) &&
    finding.claimEvidenceBundles.some((bundle) => bundle.role === 'operation') &&
    finding.claimEvidenceBundles.some((bundle) => bundle.role === 'unsafe-condition')
  );
}

async function hasAnyInScopeEvidenceLine(
  finding: Readonly<{ claimEvidenceBundles: readonly ClaimEvidenceBundleInput[] }>,
  sourceEvidence: SourceEvidenceResolver,
): Promise<boolean> {
  for (const evidence of finding.claimEvidenceBundles.flatMap((bundle) => bundle.evidence)) {
    if ((await sourceEvidence.resolve(evidence)) !== undefined) return true;
  }
  return false;
}

function hasValidEvidenceMapReferences(
  finding: Omit<VerifiableHypothesis, 'narrative'>,
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
      finding.claimEvidenceBundles
        .flatMap((bundle) => bundle.evidence)
        .every((claimEvidence) =>
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
  finding: Omit<VerifiableHypothesis, 'narrative'>,
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
