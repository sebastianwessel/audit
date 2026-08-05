import { canonicalJson, createStableId } from '../../../shared/contracts/core.js';
import type {
  ClaimEvidenceRole,
  PlanObligationReference,
  SourceEvidence,
} from '../../attack-planning/index.js';

type FindingIdentitySubject = Readonly<{
  vectorId: string;
  planObligations: readonly PlanObligationReference[];
  claimEvidenceBundles: readonly Readonly<{
    role: ClaimEvidenceRole;
    evidence: readonly SourceEvidence[];
  }>[];
}>;

function identityEvidenceItems(finding: FindingIdentitySubject) {
  return finding.claimEvidenceBundles.flatMap((bundle) =>
    bundle.evidence.map((evidence) => ({ ...evidence, role: bundle.role })),
  );
}

/**
 * The one canonical, source-minimal identity input for report items, lineage,
 * evaluation keys, and duplicate collapse. It deliberately excludes mutable
 * model wording while retaining every evidence binding, including the exact
 * source ranges needed for scan-local duplicate collapse.
 */
export function findingIdentityInput(finding: FindingIdentitySubject) {
  return {
    vectorId: finding.vectorId,
    planObligationIds: finding.planObligations
      .map((reference) => reference.obligationId)
      .sort((left, right) => left.localeCompare(right)),
    evidence: identityEvidenceItems(finding)
      .map((item) => ({
        kind: item.kind,
        path: item.path,
        role: item.role ?? null,
        startLine: item.startLine,
        endLine: item.endLine ?? null,
        contentDigest: item.contentDigest,
      }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
}

/**
 * Cross-scan identity deliberately ignores source ranges so a pure line shift
 * does not create a new lineage item. It is not suitable for in-run deduplication.
 */
export function findingFingerprintInput(finding: FindingIdentitySubject) {
  return {
    vectorId: finding.vectorId,
    planObligationIds: finding.planObligations
      .map((reference) => reference.obligationId)
      .sort((left, right) => left.localeCompare(right)),
    evidence: identityEvidenceItems(finding)
      .map((item) => ({
        kind: item.kind,
        path: item.path,
        role: item.role ?? null,
        contentDigest: item.contentDigest,
      }))
      .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
  };
}

export function createFindingId(finding: FindingIdentitySubject): string {
  return createStableId('finding', canonicalJson(findingIdentityInput(finding)));
}

/**
 * A source-free lineage anchor. Unlike the scan-local finding id, it excludes
 * source ranges so non-semantic line shifts do not appear as a resolved/new
 * pair. It is intentionally not an admission or dedupe rule.
 */
export function createFindingFingerprint(finding: FindingIdentitySubject): string {
  return createStableId('finding-fingerprint', canonicalJson(findingFingerprintInput(finding)));
}
