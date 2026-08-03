import type { SourceEvidence } from '../../attack-planning/plan.schema.js';
import type { EvidenceMapFact } from '../../audit-execution/evidence-map/contract.js';
import type { ContextRecoveryScope } from '../runtime/context-overflow.js';

/** Returns whether canonical source evidence is fully contained by one recovery scope. */
export function sourceEvidenceIsWithinRecoveryScope(
  evidence: SourceEvidence,
  scope: Pick<ContextRecoveryScope, 'sourcePaths' | 'lineRanges'>,
): boolean {
  if (!scope.sourcePaths.includes(evidence.path)) return false;
  const range = scope.lineRanges.find((candidate) => candidate.path === evidence.path);
  if (range === undefined) return true;
  const endLine = evidence.endLine ?? evidence.startLine;
  return evidence.startLine >= range.startLine && endLine <= range.endLine;
}

/** Returns whether canonical source evidence intersects a recovery source path/range. */
export function sourceEvidenceIntersectsRecoveryScope(
  evidence: SourceEvidence,
  scope: Pick<ContextRecoveryScope, 'sourcePaths' | 'lineRanges'>,
): boolean {
  if (!scope.sourcePaths.includes(evidence.path)) return false;
  const range = scope.lineRanges.find((candidate) => candidate.path === evidence.path);
  if (range === undefined) return true;
  const endLine = evidence.endLine ?? evidence.startLine;
  return evidence.startLine <= range.endLine && endLine >= range.startLine;
}

/** A map fact is available to a child only when every selected location is inside it. */
export function evidenceMapFactIsWithinRecoveryScope(
  fact: EvidenceMapFact,
  scope: Pick<ContextRecoveryScope, 'sourcePaths' | 'lineRanges'>,
): boolean {
  return fact.evidence.every((evidence) => sourceEvidenceIsWithinRecoveryScope(evidence, scope));
}
