import { expect, test } from 'bun:test';

import type { ProposedFinding } from '../attack-planning/plan.schema.js';
import { AuditReportSchema, type Finding } from '../audit-execution/audit.schema.js';
import { createFindingId } from '../audit-execution/synthesis/identity.js';

import { AuditReportLineageSchema } from './contract.js';
import { createAuditReportLineage } from './lineage.js';
import { renderAuditReportLineageMarkdown } from './report.js';

function finding(
  vectorId: string,
  statement: string,
  startLine: number,
  snippet = 'reviewed source',
): Finding {
  const proposed: ProposedFinding = {
    vectorId,
    statement,
    evidence: [
      {
        path: 'source.unknown',
        startLine,
        snippet,
        kind: 'source',
        role: 'operation',
      },
    ],
    planObligations: [{ obligationId: 'lineage-obligation-01' }],
    limitations: [],
  };
  return {
    ...proposed,
    findingId: createFindingId(proposed),
    status: 'accepted',
    verification: {
      status: 'verified',
      reason: 'The source evidence is inside the approved vector scope.',
      checks: ['scope'],
    },
  };
}

function report(input: {
  reportId: string;
  vectorCompleted: boolean;
  findings: readonly Finding[];
}) {
  return AuditReportSchema.parse({
    schemaVersion: 15,
    reportId: input.reportId,
    runId: `run-${input.reportId.slice(7)}`,
    planId: `plan-${input.reportId.slice(7)}`,
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-07-30T12:00:00.000Z',
    coverage: [
      {
        vectorId: 'vector-review-01',
        planned: true,
        completed: input.vectorCompleted,
        matchedSourcePaths: 1,
        deterministicCandidateCount: 0,
        evidenceMapFactCount: 1,
        evidenceMapUnansweredObligationCount: 0,
        sourcePostureAssessmentCount: 1,
        sourcePostureSupportedCount: 0,
        sourcePostureContradictedCount: 0,
        sourcePostureInconclusiveCount: 1,
        findingCount: input.findings.length,
        outcome: input.vectorCompleted ? 'completed' : 'incomplete',
        errorCode: null,
        limitations: [],
        obligationClosure: [
          {
            obligationId: 'lineage-obligation-01',
            planObligation: { obligationId: 'lineage-obligation-01' },
            mapState: 'mapped',
            evidenceMapFactCount: 1,
            sourcePostureConclusion: 'inconclusive',
            investigationState:
              input.findings.length > 0
                ? 'candidate-raised'
                : input.vectorCompleted
                  ? 'no-source-backed-candidate'
                  : 'incomplete',
            candidateCount: input.findings.length,
            admittedFindingCount: input.findings.length,
            terminalDisposition:
              input.findings.length > 0
                ? 'finding-admitted'
                : input.vectorCompleted
                  ? 'no-source-backed-candidate'
                  : 'incomplete',
          },
        ],
      },
    ],
    findings: input.findings,
    reviewRequired: [],
    errors: [],
  });
}

test('marks a stable source-free finding fingerprint as persisting only after complete coverage', () => {
  const retained = finding('vector-review-01', 'Retained bounded concern', 4);
  const lineage = createAuditReportLineage({
    previous: report({
      reportId: 'report-previous-01',
      vectorCompleted: true,
      findings: [retained],
    }),
    current: report({
      reportId: 'report-current-001',
      vectorCompleted: true,
      findings: [retained],
    }),
    generatedAt: '2026-07-30T12:01:00.000Z',
  });

  expect(lineage).toMatchObject({ counts: { persisting: 1 } });
  expect(lineage.entries[0]).toMatchObject({
    status: 'persisting',
    reason: 'exact-match-and-coverage-complete',
  });
});

test('keeps a finding persisting when wording and absolute source line shift', () => {
  const lineage = createAuditReportLineage({
    previous: report({
      reportId: 'report-previous-01',
      vectorCompleted: true,
      findings: [finding('vector-review-01', 'Earlier wording for the same concern', 4)],
    }),
    current: report({
      reportId: 'report-current-001',
      vectorCompleted: true,
      findings: [finding('vector-review-01', 'Updated wording for the same concern', 19)],
    }),
    generatedAt: '2026-07-30T12:01:00.000Z',
  });
  expect(lineage).toMatchObject({ counts: { persisting: 1 } });
});

test('does not claim a missing finding is resolved when successor coverage is incomplete', () => {
  const previousFinding = finding('vector-review-01', 'Earlier bounded concern', 4);
  const lineage = createAuditReportLineage({
    previous: report({
      reportId: 'report-previous-01',
      vectorCompleted: true,
      findings: [previousFinding],
    }),
    current: report({ reportId: 'report-current-001', vectorCompleted: false, findings: [] }),
    generatedAt: '2026-07-30T12:01:00.000Z',
  });

  expect(lineage).toMatchObject({ counts: { resolved: 0, unknown: 1 } });
  expect(lineage.entries[0]).toMatchObject({
    status: 'unknown',
    reason: 'no-exact-match-and-coverage-incomplete-or-missing',
  });
});

test('records complete unmatched records as separate new and resolved entries', () => {
  const previousFinding = finding('vector-review-01', 'Earlier bounded concern', 4);
  const currentFinding = finding(
    'vector-review-01',
    'Later bounded concern',
    8,
    'different source',
  );
  const lineage = createAuditReportLineage({
    previous: report({
      reportId: 'report-previous-01',
      vectorCompleted: true,
      findings: [previousFinding],
    }),
    current: report({
      reportId: 'report-current-001',
      vectorCompleted: true,
      findings: [currentFinding],
    }),
    generatedAt: '2026-07-30T12:01:00.000Z',
  });

  expect(lineage.counts).toEqual({ new: 1, persisting: 0, resolved: 1, unknown: 0 });
  expect(lineage.entries.map((entry) => entry.status).sort()).toEqual(['new', 'resolved']);
});

test('keeps the persisted lineage and Markdown projection free of source-derived finding content', () => {
  const retained = finding('vector-review-01', 'Sensitive source-derived title', 4);
  const lineage = createAuditReportLineage({
    previous: report({
      reportId: 'report-previous-01',
      vectorCompleted: true,
      findings: [retained],
    }),
    current: report({
      reportId: 'report-current-001',
      vectorCompleted: true,
      findings: [retained],
    }),
    generatedAt: '2026-07-30T12:01:00.000Z',
  });

  expect(JSON.stringify(AuditReportLineageSchema.parse(lineage))).not.toContain('source.unknown');
  expect(renderAuditReportLineageMarkdown(lineage)).not.toContain('Sensitive source-derived title');
});

test('rejects an impossible duplicate deterministic identity instead of choosing an input record', () => {
  const first = finding('vector-review-01', 'Duplicate bounded concern', 4);
  const duplicate = { ...first, findingId: 'finding-different-01' };
  const invalid = report({
    reportId: 'report-previous-01',
    vectorCompleted: true,
    findings: [first, duplicate],
  });
  const current = report({ reportId: 'report-current-001', vectorCompleted: true, findings: [] });

  expect(() =>
    createAuditReportLineage({
      previous: invalid,
      current,
      generatedAt: '2026-07-30T12:01:00.000Z',
    }),
  ).toThrow('duplicate stable finding fingerprints');
});
