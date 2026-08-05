import { claimEvidenceItems, type ProposedFinding } from '../../attack-planning/index.js';

export type InvestigationEvidencePackage = Readonly<{
  sourcePaths: readonly string[];
  omittedPaths: readonly string[];
  limitations: readonly string[];
}>;

/** Candidate-bearing files are prioritized; every approved source remains present. */
export function buildInvestigationEvidencePackage(
  scopedSourcePaths: readonly string[],
  candidates: readonly ProposedFinding[],
): InvestigationEvidencePackage {
  const candidatePaths = new Set(
    candidates.flatMap((candidate) =>
      claimEvidenceItems(candidate).map((evidence) => evidence.path),
    ),
  );
  const sourcePaths = [...scopedSourcePaths].sort((left, right) => {
    const leftCandidate = candidatePaths.has(left) ? 0 : 1;
    const rightCandidate = candidatePaths.has(right) ? 0 : 1;
    return leftCandidate - rightCandidate || left.localeCompare(right);
  });
  return Object.freeze({ sourcePaths, omittedPaths: [], limitations: [] });
}
