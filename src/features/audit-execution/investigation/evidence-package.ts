import { claimEvidenceItems, type ProposedFinding } from '../../attack-planning/plan.schema.js';
import type { SourceDocument } from '../audit.schema.js';

export type InvestigationEvidencePackage = Readonly<{
  sources: readonly SourceDocument[];
  omittedPaths: readonly string[];
  limitations: readonly string[];
}>;

/** Candidate-bearing files are prioritized; every approved source remains present. */
export function buildInvestigationEvidencePackage(
  scopedSources: readonly SourceDocument[],
  candidates: readonly ProposedFinding[],
): InvestigationEvidencePackage {
  const candidatePaths = new Set(
    candidates.flatMap((candidate) =>
      claimEvidenceItems(candidate).map((evidence) => evidence.path),
    ),
  );
  const ordered = [...scopedSources].sort((left, right) => {
    const leftCandidate = candidatePaths.has(left.path) ? 0 : 1;
    const rightCandidate = candidatePaths.has(right.path) ? 0 : 1;
    return leftCandidate - rightCandidate || left.path.localeCompare(right.path);
  });
  return Object.freeze({ sources: ordered, omittedPaths: [], limitations: [] });
}
