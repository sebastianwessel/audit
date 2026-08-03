import type { ProposedFinding } from '../../attack-planning/plan.schema.js';
import { type Finding, FindingSchema } from '../audit.schema.js';
import { redactArtifactText } from '../investigation/redaction.js';
import { createFindingId } from './identity.js';

/** Collapses only identical vector/claim/location candidates; semantic merging remains conservative. */
export function synthesizeFindings(candidates: readonly ProposedFinding[]): Finding[] {
  return synthesizeReportItems(
    candidates,
    'accepted',
    'verified',
    'The finding has source evidence in the approved vector scope.',
  );
}

/** Preserves a source-backed disagreement for human review without promoting it to a finding. */
export function synthesizeReviewRequiredFindings(
  candidates: readonly ProposedFinding[],
): Finding[] {
  return synthesizeReportItems(
    candidates,
    'needs-review',
    'insufficient-evidence',
    'Candidate-blind and candidate-aware static review disagree; human adjudication is required.',
  );
}

function synthesizeReportItems(
  candidates: readonly ProposedFinding[],
  status: Finding['status'],
  verificationStatus: Finding['verification']['status'],
  verificationReason: string,
): Finding[] {
  const canonical = new Map<string, ProposedFinding>();
  for (const candidate of candidates) {
    const evidence = candidate.evidence[0];
    if (evidence === undefined) continue;
    const key = `${candidate.vectorId}\0${candidate.statement}\0${evidence.path}\0${evidence.startLine}`;
    canonical.set(key, candidate);
  }
  return [...canonical.values()]
    .map((finding) =>
      FindingSchema.parse({
        ...redactProposedFinding(finding),
        findingId: createFindingId(finding),
        status,
        verification: {
          status: verificationStatus,
          reason: verificationReason,
          checks: [
            'approved-obligation',
            'scope',
            'source-path',
            'line-range',
            'source-snippet',
            'claim-evidence-roles',
          ],
        },
      }),
    )
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
}

/** Redacts a verified proposal before it is persisted in a report or checkpoint. */
export function redactProposedFinding(finding: ProposedFinding): ProposedFinding {
  return {
    ...finding,
    statement: redactArtifactText(finding.statement),
    evidence: finding.evidence.map((evidence) => ({
      ...evidence,
      snippet: redactArtifactText(evidence.snippet),
    })),
    limitations: finding.limitations.map(redactArtifactText),
  };
}
