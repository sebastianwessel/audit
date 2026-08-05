import { expect, test } from 'bun:test';

import { AuditReportSchema } from './audit.schema.ts';
import { classifyAuditTerminal } from './terminal-classification.ts';

function reportFor(
  outcome: 'completed' | 'not-applicable' | 'incomplete' | 'skipped' | 'failed' | 'cancelled',
  findingCount = 0,
  reviewRequiredCount = 0,
) {
  const isClosed = outcome === 'completed' || outcome === 'not-applicable' || outcome === 'skipped';
  const isNotApplicable = outcome === 'not-applicable';
  const hasCandidate = findingCount > 0 || reviewRequiredCount > 0;
  const hasMappedEvidence = outcome === 'completed' || outcome === 'not-applicable';
  const hasPosture = hasMappedEvidence;
  return AuditReportSchema.parse({
    schemaVersion: 21,
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
        evidenceMapFactCount: hasMappedEvidence ? 1 : 0,
        evidenceMapUnansweredObligationCount: 0,
        sourcePostureAssessmentCount: hasPosture ? 1 : 0,
        sourcePostureSupportedCount: 0,
        sourcePostureContradictedCount: 0,
        sourcePostureInconclusiveCount: outcome === 'completed' && hasCandidate ? 1 : 0,
        ...(outcome === 'completed' && !hasCandidate ? { sourcePostureContradictedCount: 1 } : {}),
        sourcePostureNotApplicableCount: isNotApplicable ? 1 : 0,
        findingCount,
        reviewRequiredCount,
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
              : outcome === 'completed' && hasCandidate
                ? 'inconclusive'
                : outcome === 'completed'
                  ? 'risk-contradicted'
                  : null,
            ...(isNotApplicable
              ? {
                  notApplicableReason: 'no-relevant-operation-in-scope',
                  notApplicableEvidence: [
                    {
                      path: 'source.unknown',
                      startLine: 1,
                      endLine: null,
                      contentDigest: 'a'.repeat(64),
                      kind: 'source',
                      role: null,
                    },
                  ],
                }
              : {}),
            investigationState: isNotApplicable
              ? 'not-applicable'
              : outcome === 'completed'
                ? hasCandidate
                  ? 'candidate-raised'
                  : 'no-source-backed-candidate'
                : 'not-reached',
            candidateCount: hasCandidate ? 1 : 0,
            admittedFindingCount: findingCount,
            terminalDisposition: isNotApplicable
              ? 'not-applicable'
              : findingCount > 0
                ? 'finding-admitted'
                : reviewRequiredCount > 0
                  ? 'review-required'
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
              narrative: narrative(),
              claimEvidenceBundles: [
                {
                  role: 'operation',
                  evidence: [
                    {
                      path: 'source.unknown',
                      startLine: 1,
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
                      path: 'source.unknown',
                      startLine: 2,
                      contentDigest: 'a'.repeat(64),
                      kind: 'source',
                      role: 'unsafe-condition',
                    },
                  ],
                },
              ],
              planObligations: [{ obligationId: 'terminal-obligation-01' }],
              status: 'accepted',
              verification: {
                status: 'verified',
                checks: ['approved-obligation'],
              },
            },
          ],
    reviewRequired:
      reviewRequiredCount === 0
        ? []
        : [
            {
              findingId: 'review-required-terminal-01',
              vectorId: 'vector-terminal-01',
              narrative: narrative(),
              claimEvidenceBundles: [
                {
                  role: 'operation',
                  evidence: [
                    {
                      path: 'source.unknown',
                      startLine: 1,
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
                      path: 'source.unknown',
                      startLine: 2,
                      contentDigest: 'a'.repeat(64),
                      kind: 'source',
                      role: 'unsafe-condition',
                    },
                  ],
                },
              ],
              planObligations: [{ obligationId: 'terminal-obligation-01' }],
              status: 'needs-review',
              verification: {
                status: 'insufficient-evidence',
                checks: ['approved-obligation'],
              },
            },
          ],
    errors: [],
  });
}

function narrative() {
  return {
    statement: 'The reviewed operation may be reached with an unsafe condition.',
    roleExplanations: [
      { role: 'operation' as const, explanation: 'The operation evidence identifies the action.' },
      {
        role: 'unsafe-condition' as const,
        explanation: 'The condition evidence identifies the unsafe state.',
      },
    ],
    limitations: [],
  };
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
  expect(classifyAuditTerminal(reportFor('completed', 0, 1))).toMatchObject({
    outcome: 'completed',
    exitCode: 0,
  });
});

test('never classifies unfinished terminal work as complete', () => {
  for (const outcome of ['incomplete', 'failed', 'cancelled'] as const) {
    expect(classifyAuditTerminal(reportFor(outcome))).toMatchObject({ exitCode: 3 });
  }
});
