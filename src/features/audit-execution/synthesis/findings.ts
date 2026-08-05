import { canonicalJson } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import { type Finding, FindingSchema } from '../audit.schema.js';
import {
  type NarratedProposedFinding,
  NarratedProposedFindingSchema,
} from '../narrative/contract.js';
import { createFindingId } from './identity.js';

export type CanonicalizedProposedFindings = Readonly<{
  findings: readonly NarratedProposedFinding[];
  duplicateCollapsedCount: number;
}>;

/**
 * Collapses equivalent claim identities before any coverage, funnel, report,
 * or lineage count is derived. Narrative is deliberately excluded from the
 * identity, but conflicting validated narratives must fail loudly.
 */
export function canonicalizeProposedFindings(
  candidates: readonly NarratedProposedFinding[],
): CanonicalizedProposedFindings {
  const canonical = new Map<string, NarratedProposedFinding>();
  let duplicateCollapsedCount = 0;
  for (const candidate of candidates) {
    // A verified hypothesis carries extra provenance fields. Persisted finding
    // identity owns only this narrow human-readable projection.
    const proposed = NarratedProposedFindingSchema.parse({
      vectorId: candidate.vectorId,
      claimEvidenceBundles: candidate.claimEvidenceBundles,
      planObligations: candidate.planObligations,
      narrative: candidate.narrative,
    });
    const key = createFindingId(proposed);
    const existing = canonical.get(key);
    if (existing === undefined) {
      canonical.set(key, proposed);
      continue;
    }
    if (canonicalJson(existing.narrative) !== canonicalJson(proposed.narrative)) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'Conflicting validated narratives cannot share one source-minimal finding identity.',
      );
    }
    duplicateCollapsedCount += 1;
  }
  return {
    findings: [...canonical.values()].sort((left, right) =>
      createFindingId(left).localeCompare(createFindingId(right)),
    ),
    duplicateCollapsedCount,
  };
}

/** Projects already canonical accepted candidates into persisted finding rows. */
export function synthesizeFindings(candidates: readonly NarratedProposedFinding[]): Finding[] {
  return synthesizeReportItems(candidates, 'accepted', 'verified');
}

/** Projects already canonical disagreement candidates without promoting them to findings. */
export function synthesizeReviewRequiredFindings(
  candidates: readonly NarratedProposedFinding[],
): Finding[] {
  return synthesizeReportItems(candidates, 'needs-review', 'insufficient-evidence');
}

function synthesizeReportItems(
  candidates: readonly NarratedProposedFinding[],
  status: Finding['status'],
  verificationStatus: Finding['verification']['status'],
): Finding[] {
  return candidates
    .map((finding) =>
      FindingSchema.parse({
        ...finding,
        findingId: createFindingId(finding),
        status,
        verification: {
          status: verificationStatus,
          checks: [
            'approved-obligation',
            'scope',
            'source-path',
            'line-range',
            'source-content-digest',
            'claim-evidence-roles',
          ],
        },
      }),
    )
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
}
