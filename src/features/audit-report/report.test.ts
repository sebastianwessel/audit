import { expect, test } from 'bun:test';

import { createPlan as createDraftPlan } from '../attack-planning/plan.js';
import { runStaticAudit } from '../audit-execution/audit.js';
import { AuditReportSchema } from '../audit-execution/audit.schema.js';

import { renderAuditReportMarkdown } from './report.js';

const approvePlan = <T>(plan: T, ..._reviewMetadata: readonly [string, string, string]): T => plan;

test('renders a stable human-readable projection of a validated report', async () => {
  const targetFingerprint = 'a'.repeat(64);
  const contextDigest = 'b'.repeat(64);
  const plan = approvePlan(
    createDraftPlan({
      targetFingerprint,
      contextDigest,
      targetDisplayName: 'fixture',
      inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: ['typescript'] },
      createdAt: '2026-07-27T12:00:00.000Z',
      vectors: [
        {
          title: 'Review injection',
          rationale: 'Rationale.',
          enabled: true,
          scopeGlobs: ['src/**'],
          reviewObligations: [
            {
              obligationId: 'report-obligation-01',
              riskStatement: 'Untrusted input could change the query.',
              evidenceRequirement: 'Inspect source evidence for query construction.',
            },
          ],
          limitations: [],
        },
      ],
    }),
    'reviewer',
    'Approved.',
    '2026-07-27T12:01:00.000Z',
  );
  const report = await runStaticAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-report-01',
    generatedAt: '2026-07-27T12:02:00.000Z',
  });
  const first = renderAuditReportMarkdown(report);
  expect(first).toContain('Map facts');
  expect(first).toContain('No source-backed findings were produced by this static run.');
  expect(renderAuditReportMarkdown(report)).toBe(first);
});

test('renders every verified evidence role without Markdown table injection', async () => {
  const report = AuditReportSchema.parse({
    schemaVersion: 15,
    reportId: 'report-evidence-01',
    runId: 'run-evidence-01',
    planId: 'plan-evidence-01',
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-08-03T12:00:00.000Z',
    coverage: [
      {
        vectorId: 'vector-evidence-01',
        planned: true,
        completed: true,
        matchedSourcePaths: 1,
        deterministicCandidateCount: 0,
        evidenceMapFactCount: 2,
        evidenceMapUnansweredObligationCount: 0,
        sourcePostureAssessmentCount: 1,
        sourcePostureSupportedCount: 1,
        sourcePostureContradictedCount: 0,
        sourcePostureInconclusiveCount: 0,
        findingCount: 1,
        outcome: 'completed',
        errorCode: null,
        limitations: [],
        obligationClosure: [
          {
            obligationId: 'report-evidence-obligation-01',
            planObligation: { obligationId: 'report-evidence-obligation-01' },
            mapState: 'mapped',
            evidenceMapFactCount: 2,
            sourcePostureConclusion: 'risk-supported',
            investigationState: 'candidate-raised',
            candidateCount: 1,
            admittedFindingCount: 1,
            terminalDisposition: 'finding-admitted',
          },
        ],
      },
    ],
    findings: [
      {
        findingId: 'finding-evidence-01',
        vectorId: 'vector-evidence-01',
        statement: 'Request input reaches an unsafe operation.',
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 8,
            snippet: 'execute(query)',
            kind: 'source',
            role: 'operation',
          },
          {
            path: 'src/query.ts',
            startLine: 3,
            snippet: 'query = input | unsafe',
            kind: 'source',
            role: 'unsafe-condition',
          },
          {
            path: 'src/query.ts',
            startLine: 1,
            snippet: 'authorize(user)',
            kind: 'source',
            role: 'guard',
          },
        ],
        planObligations: [{ obligationId: 'report-evidence-obligation-01' }],
        limitations: [],
        status: 'accepted',
        verification: {
          status: 'verified',
          reason: 'The verifier reconciled the source evidence.',
          checks: ['approved-obligation', 'scope', 'source-path', 'line-range', 'source-snippet'],
        },
      },
    ],
    reviewRequired: [],
    errors: [],
  });
  const markdown = renderAuditReportMarkdown(report);
  expect(markdown).toContain('| operation | `src/query.ts:8` | execute(query) |');
  expect(markdown).toContain('| unsafe-condition | `src/query.ts:3` | query = input \\| unsafe |');
  expect(markdown).toContain('| guard | `src/query.ts:1` | authorize(user) |');
});

test('renders independent stage token, cost, and tool aggregates without model content', async () => {
  const report = AuditReportSchema.parse({
    schemaVersion: 15,
    reportId: 'report-ledger-01',
    runId: 'run-ledger-01',
    planId: 'plan-ledger-01',
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-07-29T12:02:00.000Z',
    coverage: [
      {
        vectorId: 'vector-ledger-01',
        planned: true,
        completed: true,
        matchedSourcePaths: 1,
        deterministicCandidateCount: 0,
        evidenceMapFactCount: 1,
        evidenceMapUnansweredObligationCount: 0,
        sourcePostureAssessmentCount: 1,
        sourcePostureSupportedCount: 1,
        sourcePostureContradictedCount: 0,
        sourcePostureInconclusiveCount: 0,
        findingCount: 0,
        outcome: 'completed',
        errorCode: null,
        limitations: [],
        obligationClosure: [
          {
            obligationId: 'obligation-ledger-01',
            planObligation: { obligationId: 'obligation-ledger-01' },
            mapState: 'mapped',
            evidenceMapFactCount: 1,
            sourcePostureConclusion: 'risk-supported',
            investigationState: 'no-source-backed-candidate',
            candidateCount: 0,
            admittedFindingCount: 0,
            terminalDisposition: 'no-source-backed-candidate',
          },
        ],
        admissionFunnel: {
          modelCandidateCount: 1,
          integrityRejectedCount: 0,
          toolEvidenceRejectedCount: 0,
          verifierAcceptedCount: 1,
          verifierRejectedCount: 0,
          verifierIncompleteCount: 0,
          verifierToolEvidenceRejectedCount: 0,
          verifierEvidenceRejectedCount: 0,
          verifierReconciledCount: 1,
          postVerificationRejectedCount: 1,
          admittedFindingCount: 0,
          verificationTerminalLanes: {
            accepted: 1,
            rejected: 0,
            modelIncomplete: 0,
            evidenceProjectionInvalid: 0,
            stageFailed: 0,
            inspectionMissing: 0,
            wrapperContractInvalid: 0,
          },
        },
        modelObservation: {
          stage: 'investigation',
          route: 'primary',
          stageId: 'vector-ledger-01',
          status: 'completed',
          durationMs: 42,
          errorCode: null,
          usage: {
            modelCallCount: 1,
            inputTokens: 100,
            outputTokens: 20,
            cachedInputTokens: 10,
            reasoningTokens: 5,
          },
          cost: { totalTokens: 120, estimatedCostUsd: 0.001, source: 'catalogue' },
          requests: [
            {
              ordinal: 1,
              durationMs: 42,
              usage: {
                modelCallCount: 1,
                inputTokens: 100,
                outputTokens: 20,
                cachedInputTokens: 10,
                reasoningTokens: 5,
              },
              cost: { totalTokens: 120, estimatedCostUsd: 0.001, source: 'catalogue' },
            },
          ],
          toolUsage: {
            toolCallCount: 2,
            listFilesCallCount: 0,
            readFileCallCount: 1,
            grepFilesCallCount: 1,
            successfulReadFileCallCount: 1,
            successfulGrepFilesCallCount: 1,
            rejectedCallCount: 0,
            returnedBytes: 64,
            budgetExhausted: false,
          },
          cacheRoutingEnabled: false,
        },
      },
    ],
    findings: [],
    reviewRequired: [],
    errors: [],
  });
  const markdown = renderAuditReportMarkdown(report);
  expect(markdown).toContain('## Finding admission ledger');
  expect(markdown).toContain('### Candidate-aware terminal lanes');
  expect(markdown).toContain('| `vector-ledger-01` | 1 | 0 | 0 | 1/0/0 | 0 | 0 | 1 | 1 | 0 |');
  expect(markdown).toContain('## Operational ledger');
  expect(markdown).toContain('## Operational summary');
  expect(markdown).toContain(
    '| investigation | primary | 1 | 1 | 100 | 10 | 20 | 5 | 120 | $0.001000 | 42 | 2 |',
  );
  expect(markdown).toContain('### Cost and latency hotspots');
  expect(markdown).toContain(
    '| `vector-ledger-01` | investigation | primary | $0.001 | 120 | 42 | 1 | 2 |',
  );
  expect(markdown).toContain(
    '| `vector-ledger-01` | investigation | primary | completed | 1 | 100 | 10 | 20 | 5 | 120 | $0.001 | 42 | 0/1/1 |',
  );
  expect(markdown).not.toContain('raw model output');
});
