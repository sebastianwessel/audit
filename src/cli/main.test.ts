import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPlan } from '../features/attack-planning/plan.js';
import {
  AuditReportSchema,
  type AuditRunAttempt,
  type VectorCoverage,
} from '../features/audit-execution/audit.schema.js';
import { AuditReportLineageSchema } from '../features/audit-lineage/contract.js';
import {
  readJsonArtifact,
  writeJsonArtifact,
} from '../platform/artifact-store/json-artifact-store.js';
import { createStableId } from '../shared/contracts/core.js';
import { SecurityReviewerError } from '../shared/errors/security-reviewer-error.js';

import {
  assertAuditRunReuse,
  auditRunOutcome,
  cliFailureExitCode,
  parseCliArguments,
  prepareProductRoots,
  runCli,
} from './main.js';

test('CLI parsing accepts only explicit command option pairs', () => {
  expect(parseCliArguments(['plan', '--target', 'fixture', '--output', 'artifacts'])).toEqual({
    command: 'plan',
    options: { target: 'fixture', output: 'artifacts' },
  });
  expect(
    parseCliArguments([
      'lineage',
      '--previous',
      'reports/previous.json',
      '--current',
      'reports/current.json',
    ]),
  ).toEqual({
    command: 'lineage',
    options: { previous: 'reports/previous.json', current: 'reports/current.json' },
  });
  expect(() => parseCliArguments(['plan', '--target'])).toThrow('Options must be unique');
  expect(() => parseCliArguments(['scan'])).toThrow('Expected one of');
});

test('CLI rejects an unknown option before loading configuration or opening roots', async () => {
  await expect(
    runCli(['plan', '--target', 'does-not-matter', '--targett', 'typo']),
  ).rejects.toThrow('Invalid options');
});

test('CLI reserves exit code 4 for a provider failure that prevented report publication', () => {
  expect(cliFailureExitCode(new SecurityReviewerError('provider-failure', 'Unavailable.'))).toBe(4);
  expect(
    cliFailureExitCode(
      new SecurityReviewerError('agent-loop-budget-exceeded', 'The agent loop stopped.'),
    ),
  ).toBe(4);
  expect(cliFailureExitCode(new SecurityReviewerError('invalid-input', 'Invalid.'))).toBe(2);
});

test('audit run status never labels incomplete vector coverage as completed', () => {
  const incompleteCoverage = {
    vectorId: 'vector-incomplete-01',
    planned: true,
    completed: false,
    matchedSourcePaths: 1,
    deterministicCandidateCount: 0,
    evidenceMapFactCount: 1,
    evidenceMapUnansweredObligationCount: 0,
    sourcePostureAssessmentCount: 1,
    sourcePostureSupportedCount: 0,
    sourcePostureContradictedCount: 0,
    sourcePostureInconclusiveCount: 1,
    findingCount: 0,
    outcome: 'incomplete' as const,
    errorCode: 'provider-failure',
    limitations: [],
    obligationClosure: [
      {
        obligationId: 'incomplete-obligation-01',
        planObligation: { obligationId: 'incomplete-obligation-01' },
        mapState: 'mapped' as const,
        evidenceMapFactCount: 1,
        sourcePostureConclusion: 'inconclusive' as const,
        investigationState: 'no-source-backed-candidate' as const,
        candidateCount: 0,
        admittedFindingCount: 0,
        terminalDisposition: 'incomplete' as const,
      },
    ],
  } satisfies VectorCoverage;
  const report = {
    schemaVersion: 15 as const,
    reportId: 'report-incomplete-01',
    runId: 'audit-incomplete-01',
    planId: 'plan-incomplete-01',
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-07-31T12:00:00.000Z',
    coverage: [incompleteCoverage],
    findings: [],
    reviewRequired: [],
    errors: [],
  };
  expect(auditRunOutcome(AuditReportSchema.parse(report))).toBe('partial');
});

test('run reuse rejects stale or mismatched recovery identity before dispatch', () => {
  const plan = createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    createdAt: '2026-08-03T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review bounded behavior',
        rationale: 'The run identity needs a plan fixture.',
        enabled: true,
        scopeGlobs: ['source.unknown'],
        reviewObligations: [
          {
            obligationId: 'reuse-obligation-01',
            riskStatement: 'The bounded source may require review.',
            evidenceRequirement: 'Preserve the sealed plan identity.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const prior: AuditRunAttempt = {
    schemaVersion: 1,
    runId: 'audit-reuse-01',
    planId: plan.planId,
    planDigest: plan.planDigest,
    targetFingerprint: plan.targetFingerprint,
    startedAt: '2026-08-03T12:00:00.000Z',
    finishedAt: null,
    status: 'starting',
  };
  expect(() => assertAuditRunReuse({ resume: false, plan, priorAttempt: prior })).toThrow(
    'already has retained audit state',
  );
  expect(() => assertAuditRunReuse({ resume: true, plan, priorAttempt: undefined })).toThrow(
    'requires its retained attempt record',
  );
  expect(() =>
    assertAuditRunReuse({
      resume: true,
      plan,
      priorAttempt: { ...prior, planDigest: 'c'.repeat(64) },
    }),
  ).toThrow('does not match');
  expect(() =>
    assertAuditRunReuse({ resume: true, plan, priorAttempt: { ...prior, status: 'completed' } }),
  ).toThrow('cannot be resumed');
  expect(() => assertAuditRunReuse({ resume: true, plan, priorAttempt: prior })).not.toThrow();
});

test('product roots reject output overlap before output creation', async () => {
  const target = await mkdtemp(join(tmpdir(), 'security-reviewer-cli-overlap-'));
  try {
    await expect(
      prepareProductRoots({ targetRoot: target, outputRoot: target }),
    ).rejects.toMatchObject({ code: 'artifact-root-topology-invalid' });
  } finally {
    await rm(target, { force: true, recursive: true });
  }
});

test('lineage command compares only two jailed report artifacts without a provider or target', async () => {
  const output = await mkdtemp(join(tmpdir(), 'security-reviewer-lineage-'));
  const coverage = {
    vectorId: 'vector-lineage-01',
    planned: true,
    completed: true,
    matchedSourcePaths: 1,
    deterministicCandidateCount: 0,
    evidenceMapFactCount: 1,
    evidenceMapUnansweredObligationCount: 0,
    sourcePostureAssessmentCount: 1,
    sourcePostureSupportedCount: 0,
    sourcePostureContradictedCount: 0,
    sourcePostureInconclusiveCount: 1,
    findingCount: 0,
    outcome: 'completed',
    errorCode: null,
    limitations: [],
    obligationClosure: [
      {
        obligationId: 'lineage-obligation-01',
        planObligation: { obligationId: 'lineage-obligation-01' },
        mapState: 'mapped',
        evidenceMapFactCount: 1,
        sourcePostureConclusion: 'inconclusive',
        investigationState: 'no-source-backed-candidate',
        candidateCount: 0,
        admittedFindingCount: 0,
        terminalDisposition: 'no-source-backed-candidate',
      },
    ],
  } satisfies VectorCoverage;
  const createReport = (reportId: string) => ({
    schemaVersion: 15 as const,
    reportId,
    runId: `run-${reportId.slice(7)}`,
    planId: `plan-${reportId.slice(7)}`,
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-07-30T12:00:00.000Z',
    coverage: [coverage],
    findings: [],
    reviewRequired: [],
    errors: [],
  });
  const previous = createReport('report-previous-01');
  const current = createReport('report-current-001');
  await writeJsonArtifact(output, 'reports/previous.json', AuditReportSchema, previous);
  await writeJsonArtifact(output, 'reports/current.json', AuditReportSchema, current);

  expect(
    await runCli([
      'lineage',
      '--output',
      output,
      '--previous',
      'reports/previous.json',
      '--current',
      'reports/current.json',
    ]),
  ).toBe(0);

  const lineageId = createStableId('lineage', `${previous.reportId}\0${current.reportId}`);
  expect(
    await readJsonArtifact(output, `lineage/${lineageId}.json`, AuditReportLineageSchema),
  ).toMatchObject({ counts: { new: 0, persisting: 0, resolved: 0, unknown: 0 } });
});
