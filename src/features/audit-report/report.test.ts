import { expect, test } from 'bun:test';

import { createPlan as createDraftPlan } from '../attack-planning/index.js';
import { runStaticAudit } from '../audit-execution/audit.js';
import { AuditReportSchema } from '../audit-execution/audit.schema.js';
import { createPublicAuditReport } from './public-contract.js';

import { auditVectorNextAction, renderAuditReportMarkdown } from './report.js';

test('derives per-vector next actions only from terminal outcome and error code', () => {
  expect(auditVectorNextAction({ outcome: 'completed', errorCode: null })).toBe(
    'Audit execution is complete for this vector. Continue with normal report review.',
  );
  expect(auditVectorNextAction({ outcome: 'not-applicable', errorCode: null })).toContain(
    'neutral not-applicable outcome',
  );
  expect(auditVectorNextAction({ outcome: 'skipped', errorCode: null })).toContain(
    'did not execute',
  );
  expect(auditVectorNextAction({ outcome: 'incomplete', errorCode: 'coverage-incomplete' })).toBe(
    'Investigate the recorded terminal state, then explicitly resume the same run before treating this vector as covered. Recorded terminal code: coverage-incomplete.',
  );
  expect(auditVectorNextAction({ outcome: 'failed', errorCode: 'provider-failed' })).toContain(
    'Recorded terminal code: provider-failed.',
  );
  expect(
    auditVectorNextAction({ outcome: 'cancelled', errorCode: 'provider-cancelled' }),
  ).toContain('not covered');
});

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
  const publicReport = createPublicAuditReport(report);
  const first = renderAuditReportMarkdown(publicReport);
  expect(first).toContain('## Outcome');
  expect(first).toContain('## Coverage and review state');
  expect(first).toContain('## What to do next');
  expect(first).toContain('Each action is derived only from the vector terminal state');
  expect(first).toContain('No accepted source-backed findings were produced.');
  expect(renderAuditReportMarkdown(publicReport)).toBe(first);
});

test('renders every verified evidence role without Markdown table injection', async () => {
  const report = AuditReportSchema.parse({
    schemaVersion: 21,
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
                path: 'src/query.ts',
                startLine: 8,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
                role: 'operation',
              },
            ],
          },
          {
            role: 'unsafe-condition',
            evidence: [
              {
                path: 'src/query.ts',
                startLine: 3,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
                role: 'unsafe-condition',
              },
            ],
          },
        ],
        planObligations: [{ obligationId: 'report-evidence-obligation-01' }],
        status: 'accepted',
        verification: {
          status: 'verified',
          checks: [
            'approved-obligation',
            'scope',
            'source-path',
            'line-range',
            'source-content-digest',
          ],
        },
      },
    ],
    reviewRequired: [],
    errors: [],
  });
  const markdown = renderAuditReportMarkdown(createPublicAuditReport(report));
  expect(markdown).toContain('## Actionable findings');
  expect(markdown).toContain('Accepted source-backed finding');
  expect(markdown).toContain('Developer next step:');
  expect(markdown).toContain(
    '| operation | `src/query.ts:8` | `sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |',
  );
  expect(markdown).toContain(
    '| unsafe-condition | `src/query.ts:3` | `sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` |',
  );

  const reviewRequiredReport = AuditReportSchema.parse({
    ...report,
    coverage: [{ ...report.coverage[0], findingCount: 0, reviewRequiredCount: 1 }],
    findings: [],
    reviewRequired: report.findings.map((finding) => ({
      ...finding,
      status: 'needs-review' as const,
      verification: {
        status: 'insufficient-evidence' as const,
        checks: finding.verification.checks,
      },
    })),
  });
  const reviewRequiredMarkdown = renderAuditReportMarkdown(
    createPublicAuditReport(reviewRequiredReport),
  );
  expect(reviewRequiredMarkdown).toContain('## Human review required');
  expect(reviewRequiredMarkdown).toContain(
    'The reviewed operation may be reached with an unsafe condition.',
  );
  expect(reviewRequiredMarkdown).toContain('The operation evidence identifies the action.');
});

test('renders independent stage token, cost, and tool aggregates without model content', async () => {
  const report = AuditReportSchema.parse({
    schemaVersion: 21,
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
          duplicateCollapsedCount: 0,
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
          },
          cacheRoutingEnabled: false,
        },
      },
    ],
    findings: [],
    reviewRequired: [],
    errors: [],
  });
  const markdown = renderAuditReportMarkdown(createPublicAuditReport(report));
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
