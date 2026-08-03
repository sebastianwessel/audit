import { canonicalJson, createStableId, sha256 } from '../../../shared/contracts/core.js';
import type { ProposedFinding } from '../../attack-planning/plan.schema.js';

export function createFindingId(finding: ProposedFinding): string {
  const evidence = finding.evidence[0];
  if (evidence === undefined)
    return createStableId('finding', `${finding.vectorId}\0${finding.statement}`);
  return createStableId(
    'finding',
    `${finding.vectorId}\0${finding.statement}\0${evidence.path}\0${evidence.startLine}`,
  );
}

/**
 * A source-free lineage anchor. Unlike the scan-local finding id, it excludes
 * model wording and absolute line numbers so non-semantic edits do not appear
 * as a resolved/new pair. It is intentionally not an admission or dedupe rule.
 */
export function createFindingFingerprint(finding: ProposedFinding): string {
  return createStableId(
    'finding-fingerprint',
    canonicalJson({
      vectorId: finding.vectorId,
      planObligationIds: finding.planObligations
        .map((reference) => reference.obligationId)
        .sort((left, right) => left.localeCompare(right)),
      evidence: finding.evidence
        .map((item) => ({
          kind: item.kind,
          path: item.path,
          role: item.role ?? null,
          snippetFingerprint: sha256(item.snippet),
        }))
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
    }),
  );
}
