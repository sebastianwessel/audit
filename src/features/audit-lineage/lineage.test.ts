import { expect, test } from 'bun:test';

import { sha256 } from '../../shared/contracts/core.js';
import { AuditReportSchema, type Finding } from '../audit-execution/audit.schema.js';
import type { NarratedProposedFinding } from '../audit-execution/narrative/contract.js';
import { createFindingId } from '../audit-execution/synthesis/identity.js';
import { createPublicAuditReport } from '../audit-report/public-contract.js';

import { AuditReportLineageSchema } from './contract.js';
import { createAuditReportLineage } from './lineage.js';
import { renderAuditReportLineageMarkdown } from './report.js';

function finding(vectorId: string, startLine: number, snippet = 'reviewed source'): Finding {
  const proposed: NarratedProposedFinding = {
    vectorId,
    narrative: {
      statement: 'The reviewed operation may be reached with an unsafe condition.',
      roleExplanations: [
        { role: 'operation', explanation: 'The operation evidence identifies the action.' },
        {
          role: 'unsafe-condition',
          explanation: 'The condition evidence identifies the unsafe state.',
        },
      ],
      limitations: [],
    },
    claimEvidenceBundles: [
      {
        role: 'operation',
        evidence: [
          {
            path: 'source.unknown',
            startLine,
            contentDigest: sha256(snippet),
            kind: 'source',
            role: 'operation',
          },
        ],
      },
      {
        role: 'unsafe-condition',
        evidence: [
          {
            path: 'source.unknown',
            startLine,
            contentDigest: sha256(snippet),
            kind: 'source',
            role: 'unsafe-condition',
          },
        ],
      },
    ],
    planObligations: [{ obligationId: 'lineage-obligation-01' }],
  };
  return {
    ...proposed,
    findingId: createFindingId(proposed),
    status: 'accepted',
    verification: {
      status: 'verified',
      checks: ['scope'],
    },
  };
}

function report(input: {
  reportId: string;
  vectorCompleted: boolean;
  findings: readonly Finding[];
}) {
  return createPublicAuditReport(
    AuditReportSchema.parse({
      schemaVersion: 21,
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
    }),
  );
}

test('marks a stable source-free finding fingerprint as persisting only after complete coverage', () => {
  const retained = finding('vector-review-01', 4);
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
      findings: [finding('vector-review-01', 4)],
    }),
    current: report({
      reportId: 'report-current-001',
      vectorCompleted: true,
      findings: [finding('vector-review-01', 19)],
    }),
    generatedAt: '2026-07-30T12:01:00.000Z',
  });
  expect(lineage).toMatchObject({ counts: { persisting: 1 } });
});

test('does not claim a missing finding is resolved when successor coverage is incomplete', () => {
  const previousFinding = finding('vector-review-01', 4);
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
  const previousFinding = finding('vector-review-01', 4);
  const currentFinding = finding('vector-review-01', 8, 'different source');
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
  const retained = finding('vector-review-01', 4);
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
  const first = finding('vector-review-01', 4);
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

test('retains every lineage entry beyond the retired product ceiling', () => {
  const entries = Array.from({ length: 2_001 }, (_, index) => ({
    findingIdentity: `finding-lineage-${String(index).padStart(4, '0')}`,
    previousFindingId: null,
    currentFindingId: `finding-current-${String(index).padStart(4, '0')}`,
    previousVectorId: null,
    currentVectorId: 'vector-review-01',
    status: 'new' as const,
    reason: 'no-exact-match-and-coverage-complete' as const,
  }));
  const lineage = AuditReportLineageSchema.parse({
    schemaVersion: 2,
    lineageId: 'lineage-unbounded-entries',
    generatedAt: '2026-08-03T12:00:00.000Z',
    previous: {
      reportId: 'report-previous-01',
      planId: 'plan-previous-01',
      targetFingerprint: 'a'.repeat(64),
    },
    current: {
      reportId: 'report-current-001',
      planId: 'plan-current-001',
      targetFingerprint: 'b'.repeat(64),
    },
    counts: { new: entries.length, persisting: 0, resolved: 0, unknown: 0 },
    entries,
  });
  expect(lineage.entries).toHaveLength(2_001);
});
