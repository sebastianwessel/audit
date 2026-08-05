import { expect, test } from 'bun:test';

import { AuditReportSchema } from '../audit-execution/audit.schema.js';
import { createPublicAuditReport, PublicAuditReportSchema } from './public-contract.js';
import { renderAuditReportMarkdown } from './report.js';

test('permits only structured redacted narratives and closed coverage limitations', () => {
  const sentinel = 'UNIQUE_MODEL_ECHO_SENTINEL';
  const internal = AuditReportSchema.parse({
    schemaVersion: 21,
    reportId: 'report-public-projection-01',
    runId: 'run-public-projection-01',
    planId: 'plan-public-projection-01',
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-08-04T12:00:00.000Z',
    coverage: [
      {
        vectorId: 'vector-public-projection-01',
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
        limitations: ['model-declared-limitation'],
        obligationClosure: [
          {
            obligationId: 'public-projection-obligation-01',
            planObligation: { obligationId: 'public-projection-obligation-01' },
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
        findingId: 'finding-public-projection-01',
        vectorId: 'vector-public-projection-01',
        narrative: {
          ...narrative(),
          statement: `The reviewed operation contains password = '${sentinel}'.`,
        },
        claimEvidenceBundles: [
          {
            role: 'operation',
            evidence: [
              {
                path: 'source.unknown',
                startLine: 4,
                contentDigest: 'b'.repeat(64),
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
                startLine: 8,
                contentDigest: 'c'.repeat(64),
                kind: 'source',
                role: 'unsafe-condition',
              },
            ],
          },
        ],
        planObligations: [{ obligationId: 'public-projection-obligation-01' }],
        status: 'accepted',
        verification: {
          status: 'verified',
          checks: ['scope', 'source-path', 'line-range', 'source-content-digest'],
        },
      },
    ],
    reviewRequired: [],
    errors: [
      {
        code: 'provider-failure',
        stage: 'provider',
        retryable: true,
      },
    ],
  });

  const published = PublicAuditReportSchema.parse(createPublicAuditReport(internal));
  expect(published.schemaVersion).toBe(5);
  expect(published.coverage[0]?.limitations).toEqual(['model-declared-limitation']);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      findings: [{ ...published.findings[0], statement: sentinel }],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      findings: [
        {
          ...published.findings[0],
          claimEvidenceBundles: published.findings[0]?.claimEvidenceBundles.map((bundle) => ({
            ...bundle,
            explanation: sentinel,
          })),
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      coverage: [{ ...published.coverage[0], limitations: [sentinel] }],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      findings: [
        {
          ...published.findings[0],
          verification: {
            ...published.findings[0]?.verification,
            reason: sentinel,
          },
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      errors: [{ ...published.errors[0], message: sentinel }],
    }).success,
  ).toBe(false);
  expect(JSON.stringify(internal)).not.toContain(sentinel);
  expect(JSON.stringify(published)).not.toContain(sentinel);
  expect(renderAuditReportMarkdown(published)).not.toContain(sentinel);
  expect(JSON.stringify(published)).toContain('[REDACTED_SECRET]');
  expect(JSON.stringify(published)).toContain('source.unknown');
  expect(renderAuditReportMarkdown(published)).toContain('source.unknown:4');
  expect(renderAuditReportMarkdown(published)).toContain('model-declared-limitation');
});

test('requires status-correct, covered findings and reconciled public coverage counts', () => {
  const published = createPublicAuditReport(
    AuditReportSchema.parse({
      schemaVersion: 21,
      reportId: 'report-public-integrity-01',
      runId: 'run-public-integrity-01',
      planId: 'plan-public-integrity-01',
      targetFingerprint: 'a'.repeat(64),
      generatedAt: '2026-08-04T12:00:00.000Z',
      coverage: [
        {
          vectorId: 'vector-public-integrity-01',
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
          reviewRequiredCount: 0,
          outcome: 'completed',
          errorCode: null,
          limitations: [],
          obligationClosure: [
            {
              obligationId: 'public-integrity-obligation-01',
              planObligation: { obligationId: 'public-integrity-obligation-01' },
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
          findingId: 'finding-public-integrity-01',
          vectorId: 'vector-public-integrity-01',
          narrative: narrative(),
          claimEvidenceBundles: [
            {
              role: 'operation',
              evidence: [
                {
                  path: 'source.unknown',
                  startLine: 4,
                  contentDigest: 'b'.repeat(64),
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
                  startLine: 8,
                  contentDigest: 'c'.repeat(64),
                  kind: 'source',
                  role: 'unsafe-condition',
                },
              ],
            },
          ],
          planObligations: [{ obligationId: 'public-integrity-obligation-01' }],
          status: 'accepted',
          verification: {
            status: 'verified',
            checks: ['approved-obligation'],
          },
        },
      ],
      reviewRequired: [],
      errors: [],
    }),
  );

  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      findings: [{ ...published.findings[0], status: 'needs-review' }],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      reviewRequired: [{ ...published.findings[0], status: 'accepted' }],
      findings: [],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      findings: [{ ...published.findings[0], vectorId: 'vector-missing-01' }],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      coverage: [{ ...published.coverage[0], findingCount: 0 }],
    }).success,
  ).toBe(false);
  expect(
    PublicAuditReportSchema.safeParse({
      ...published,
      coverage: [{ ...published.coverage[0], reviewRequiredCount: 1 }],
    }).success,
  ).toBe(false);
});

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
