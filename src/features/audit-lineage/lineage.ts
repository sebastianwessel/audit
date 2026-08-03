import { createStableId } from '../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import type { AuditReport, Finding, VectorCoverage } from '../audit-execution/audit.schema.js';
import { createFindingFingerprint } from '../audit-execution/synthesis/identity.js';

import {
  type AuditLineageEntry,
  type AuditReportLineage,
  AuditReportLineageSchema,
} from './contract.js';

/** Compares reports by a source-free partial fingerprint; it never reads target source. */
export function createAuditReportLineage(input: {
  previous: AuditReport;
  current: AuditReport;
  generatedAt: string;
}): AuditReportLineage {
  const previousFindings = findingsByIdentity(input.previous, 'previous');
  const currentFindings = findingsByIdentity(input.current, 'current');
  const previousCoverage = coverageByVector(input.previous, 'previous');
  const currentCoverage = coverageByVector(input.current, 'current');
  const identities = [...new Set([...previousFindings.keys(), ...currentFindings.keys()])].sort(
    (left, right) => left.localeCompare(right),
  );
  const entries = identities.map((findingIdentity) => {
    const previous = previousFindings.get(findingIdentity);
    const current = currentFindings.get(findingIdentity);
    const vectorId = current?.vectorId ?? previous?.vectorId;
    const coverageComplete =
      vectorId !== undefined &&
      isCompleted(previousCoverage.get(vectorId)) &&
      isCompleted(currentCoverage.get(vectorId));
    const matched = previous !== undefined && current !== undefined;
    const status = matched
      ? coverageComplete
        ? 'persisting'
        : 'unknown'
      : coverageComplete
        ? current === undefined
          ? 'resolved'
          : 'new'
        : 'unknown';
    return {
      findingIdentity,
      previousFindingId: previous?.findingId ?? null,
      currentFindingId: current?.findingId ?? null,
      previousVectorId: previous?.vectorId ?? null,
      currentVectorId: current?.vectorId ?? null,
      status,
      reason: matched
        ? coverageComplete
          ? 'exact-match-and-coverage-complete'
          : 'exact-match-but-coverage-incomplete-or-missing'
        : coverageComplete
          ? 'no-exact-match-and-coverage-complete'
          : 'no-exact-match-and-coverage-incomplete-or-missing',
    } satisfies AuditLineageEntry;
  });
  return AuditReportLineageSchema.parse({
    schemaVersion: 2,
    lineageId: createStableId('lineage', `${input.previous.reportId}\0${input.current.reportId}`),
    generatedAt: input.generatedAt,
    previous: reportIdentity(input.previous),
    current: reportIdentity(input.current),
    counts: {
      new: entries.filter((entry) => entry.status === 'new').length,
      persisting: entries.filter((entry) => entry.status === 'persisting').length,
      resolved: entries.filter((entry) => entry.status === 'resolved').length,
      unknown: entries.filter((entry) => entry.status === 'unknown').length,
    },
    entries,
  });
}

function findingsByIdentity(
  report: AuditReport,
  label: 'previous' | 'current',
): ReadonlyMap<string, Finding> {
  const findings = new Map<string, Finding>();
  for (const finding of report.findings) {
    const identity = createFindingFingerprint(finding);
    if (findings.has(identity)) {
      throw new SecurityReviewerError(
        'invalid-input',
        `The ${label} report has duplicate stable finding fingerprints.`,
      );
    }
    findings.set(identity, finding);
  }
  return findings;
}

function coverageByVector(
  report: AuditReport,
  label: 'previous' | 'current',
): ReadonlyMap<string, VectorCoverage> {
  const coverage = new Map<string, VectorCoverage>();
  for (const vector of report.coverage) {
    if (coverage.has(vector.vectorId)) {
      throw new SecurityReviewerError(
        'invalid-input',
        `The ${label} report has duplicate coverage vector identifiers.`,
      );
    }
    coverage.set(vector.vectorId, vector);
  }
  return coverage;
}

function isCompleted(coverage: VectorCoverage | undefined): boolean {
  return coverage?.completed === true && coverage.outcome === 'completed';
}

function reportIdentity(report: AuditReport) {
  return {
    reportId: report.reportId,
    planId: report.planId,
    targetFingerprint: report.targetFingerprint,
  };
}
