import { expect, test } from 'bun:test';

import { AuditReportSchema } from './audit.schema.ts';
import { classifyAuditTerminal } from './terminal-classification.ts';

function reportFor(
  outcome: 'completed' | 'not-applicable' | 'incomplete' | 'skipped' | 'failed' | 'cancelled',
  findingCount = 0,
) {
  const isClosed = outcome === 'completed' || outcome === 'not-applicable' || outcome === 'skipped';
  const isNotApplicable = outcome === 'not-applicable';
  const hasFinding = findingCount > 0;
  const hasMappedEvidence = outcome === 'completed' || outcome === 'not-applicable';
  const hasPosture = hasMappedEvidence;
  return AuditReportSchema.parse({
    schemaVersion: 15,
    reportId: 'report-terminal-01',
    runId: 'audit-terminal-01',
    planId: 'plan-terminal-01',
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-08-02T12:00:00.000Z',
    coverage: [
      {
        vectorId: 'vector-terminal-01',
        planned: true,
        completed: isClosed,
        matchedSourcePaths: 0,
        deterministicCandidateCount: 0,
        evidenceMapFactCount: hasMappedEvidence ? 1 : 0,
        evidenceMapUnansweredObligationCount: 0,
        sourcePostureAssessmentCount: hasPosture ? 1 : 0,
        sourcePostureSupportedCount: 0,
        sourcePostureContradictedCount: 0,
        sourcePostureInconclusiveCount: outcome === 'completed' ? 1 : 0,
        sourcePostureNotApplicableCount: isNotApplicable ? 1 : 0,
        findingCount,
        outcome,
        errorCode: isClosed ? null : 'provider-failure',
        limitations: [],
        obligationClosure: [
          {
            obligationId: 'terminal-obligation-01',
            planObligation: { obligationId: 'terminal-obligation-01' },
            mapState: hasMappedEvidence ? 'mapped' : 'not-reached',
            evidenceMapFactCount: hasMappedEvidence ? 1 : 0,
            sourcePostureConclusion: isNotApplicable
              ? 'not-applicable'
              : outcome === 'completed'
                ? 'inconclusive'
                : null,
            ...(isNotApplicable
              ? { notApplicableReason: 'The scoped source has no applicable review capability.' }
              : {}),
            investigationState: isNotApplicable
              ? 'not-applicable'
              : outcome === 'completed'
                ? hasFinding
                  ? 'candidate-raised'
                  : 'no-source-backed-candidate'
                : 'not-reached',
            candidateCount: hasFinding ? 1 : 0,
            admittedFindingCount: findingCount,
            terminalDisposition: isNotApplicable
              ? 'not-applicable'
              : hasFinding
                ? 'finding-admitted'
                : outcome === 'completed'
                  ? 'no-source-backed-candidate'
                  : 'not-reached',
          },
        ],
      },
    ],
    findings:
      findingCount === 0
        ? []
        : [
            {
              findingId: 'finding-terminal-01',
              vectorId: 'vector-terminal-01',
              statement: 'The verified review found a source-backed issue.',
              evidence: [
                {
                  path: 'source.unknown',
                  startLine: 1,
                  snippet: 'source',
                  kind: 'source',
                  role: 'operation',
                },
              ],
              planObligations: [{ obligationId: 'terminal-obligation-01' }],
              limitations: [],
              status: 'accepted',
              verification: {
                status: 'verified',
                reason: 'The verifier selected source-backed evidence.',
                checks: ['approved-obligation'],
              },
            },
          ],
    reviewRequired: [],
    errors: [],
  });
}

test('classifies complete, neutral, and finding reports deterministically', () => {
  expect(classifyAuditTerminal(reportFor('completed'))).toMatchObject({
    outcome: 'completed',
    exitCode: 0,
  });
  expect(classifyAuditTerminal(reportFor('not-applicable'))).toMatchObject({
    outcome: 'completed',
    exitCode: 0,
  });
  expect(classifyAuditTerminal(reportFor('skipped'))).toMatchObject({
    outcome: 'completed',
    exitCode: 0,
  });
  expect(classifyAuditTerminal(reportFor('completed', 1))).toMatchObject({
    outcome: 'completed',
    exitCode: 1,
  });
});

test('never classifies unfinished terminal work as complete', () => {
  for (const outcome of ['incomplete', 'failed', 'cancelled'] as const) {
    expect(classifyAuditTerminal(reportFor(outcome))).toMatchObject({ exitCode: 3 });
  }
});
