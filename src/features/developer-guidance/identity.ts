import { canonicalJson, createStableId, sha256 } from '../../shared/contracts/core.js';
import type { AttackPlan } from '../attack-planning/plan/index.js';
import { createFindingFingerprint } from '../audit-execution/synthesis/identity.js';
import type { PublicAuditReport, PublicFinding } from '../audit-report/public-contract.js';
import type {
  DeveloperGuidanceAttempt,
  DeveloperGuidanceCheckpoint,
  DeveloperGuidanceCheckpointBinding,
  DeveloperGuidanceReport,
} from './guidance.schema.js';

/** Content-derived identity for advice bound to one immutable report artifact. */
export function createDeveloperGuidanceId(reportId: string, runId: string): string {
  return createStableId('guidance', `${reportId}\0${runId}`);
}

/** Finds no source semantics: it is only a stable binding for the accepted claim. */
export function createDeveloperGuidanceFindingBinding(finding: PublicFinding) {
  return {
    findingId: finding.findingId,
    findingFingerprint: createFindingFingerprint(finding),
    vectorId: finding.vectorId,
  };
}

/** Exact immutable report binding. It is not used for finding identity or scoring. */
export function createDeveloperGuidanceReportDigest(report: PublicAuditReport): string {
  return sha256(canonicalJson(report));
}

export function createDeveloperGuidanceCheckpointBinding(input: {
  runId: string;
  plan: AttackPlan;
  report: PublicAuditReport;
  contextDigest: string;
  provider: string;
  model: string;
  protocolFingerprint: string;
}): DeveloperGuidanceCheckpointBinding {
  return {
    runId: input.runId,
    reportId: input.report.reportId,
    reportDigest: createDeveloperGuidanceReportDigest(input.report),
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    targetFingerprint: input.report.targetFingerprint,
    contextDigest: input.contextDigest,
    provider: input.provider,
    model: input.model,
    protocolFingerprint: input.protocolFingerprint,
  };
}

export function hasExactDeveloperGuidanceCheckpointBinding(
  actual: DeveloperGuidanceCheckpointBinding,
  expected: DeveloperGuidanceCheckpointBinding,
): boolean {
  return canonicalJson(actual) === canonicalJson(expected);
}

/** The final advisory artifact and its checkpoint share one exact run binding. */
export function hasExactDeveloperGuidanceReportBinding(
  actual: Pick<
    DeveloperGuidanceReport,
    | 'runId'
    | 'reportId'
    | 'reportDigest'
    | 'planId'
    | 'planDigest'
    | 'targetFingerprint'
    | 'contextDigest'
  >,
  expected: DeveloperGuidanceCheckpointBinding,
): boolean {
  return (
    actual.runId === expected.runId &&
    actual.reportId === expected.reportId &&
    actual.reportDigest === expected.reportDigest &&
    actual.planId === expected.planId &&
    actual.planDigest === expected.planDigest &&
    actual.targetFingerprint === expected.targetFingerprint &&
    actual.contextDigest === expected.contextDigest
  );
}

/** The latest terminal attempt is the only state eligible for guidance reuse. */
export function latestDeveloperGuidanceAttempts(
  checkpoint: DeveloperGuidanceCheckpoint | undefined,
): ReadonlyMap<string, DeveloperGuidanceAttempt> {
  const latest = new Map<string, DeveloperGuidanceAttempt>();
  for (const attempt of checkpoint?.attempts ?? []) {
    const current = latest.get(attempt.item.findingId);
    if (current === undefined || current.attempt < attempt.attempt) {
      latest.set(attempt.item.findingId, attempt);
    }
  }
  return latest;
}

/** Every retained attempt remains chargeable telemetry after an explicit resume. */
export function developerGuidanceModelStages(checkpoint: DeveloperGuidanceCheckpoint | undefined) {
  return (checkpoint?.attempts ?? []).map((attempt) => attempt.modelObservation);
}
