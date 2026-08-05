import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiscardPlan } from '../../../../tests/test-support/cli-fixtures.js';
import { createPlan } from '../../../features/attack-planning/index.js';
import {
  AuditReportSchema,
  type AuditRunAttempt,
  AuditRunAttemptSchema,
  type VectorCoverage,
} from '../../../features/audit-execution/index.js';
import { createPublicAuditReport } from '../../../features/audit-report/index.js';
import {
  captureTargetInventory,
  createPrivateSourceCapture,
  retainTargetSnapshot,
} from '../../../features/target-inventory/index.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  writeJsonArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import {
  assertAuditRunDiscardBinding,
  assertAuditRunReuse,
  auditRunOutcome,
  recoverAuditResumeSourceCapture,
} from './index.js';

test('audit run status never labels incomplete vector coverage as completed', () => {
  const incompleteCoverage = {
    vectorId: 'vector-incomplete-01',
    planned: true,
    completed: false,
    matchedSourcePaths: 1,
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
    schemaVersion: 21 as const,
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
  expect(auditRunOutcome(createPublicAuditReport(AuditReportSchema.parse(report)))).toBe('partial');
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
    schemaVersion: 3,
    runId: 'audit-reuse-01',
    planId: plan.planId,
    planDigest: plan.planDigest,
    targetFingerprint: plan.targetFingerprint,
    startedAt: '2026-08-03T12:00:00.000Z',
    finishedAt: null,
    status: 'starting',
    publicReport: null,
    publicationState: 'not-prepared',
    snapshotState: 'not-retained',
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
    assertAuditRunReuse({
      resume: true,
      plan,
      priorAttempt: { ...prior, status: 'completed' },
    }),
  ).toThrow('cannot be resumed');
  expect(() => assertAuditRunReuse({ resume: true, plan, priorAttempt: prior })).not.toThrow();
});

test('audit resume promotes a sealed snapshot that survived before attempt-state promotion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-resume-sealed-capture-'));
  try {
    const privateWork = join(root, 'private-work');
    const targetRoot = join(root, 'target');
    await Promise.all([mkdir(privateWork), mkdir(targetRoot)]);
    await writeFile(join(targetRoot, 'source.unknown'), 'sealed before crash\n', 'utf8');
    const runId = 'audit-resume-sealed-01';
    const sourceCapture = await createPrivateSourceCapture({
      outputRoot: privateWork,
      captureId: runId,
    });
    const captured = await captureTargetInventory(
      await createJailedReadOnlyFilesystem({ targetRoot }),
      { sourceCapture },
    );
    const plan = createPlan({
      targetFingerprint: captured.inventory.targetFingerprint,
      contextDigest: captured.inventory.contextDigest,
      targetDisplayName: 'resume fixture',
      createdAt: '2026-08-05T12:00:00.000Z',
      inventorySummary: captured.inventory.summary,
      vectors: [
        {
          title: 'Review sealed recovery',
          rationale: 'The exact pre-crash snapshot must remain resumable.',
          enabled: true,
          scopeGlobs: ['source.unknown'],
          reviewObligations: [
            {
              obligationId: 'sealed-recovery-obligation-01',
              riskStatement: 'A recovery run must not reopen mutable target bytes.',
              evidenceRequirement: 'Load the retained source capture bound to the sealed plan.',
            },
          ],
          limitations: [],
        },
      ],
    });
    await retainTargetSnapshot({
      outputRoot: privateWork,
      runId,
      capture: captured,
    });
    await writeFile(join(targetRoot, 'source.unknown'), 'changed after crash\n', 'utf8');
    const priorAttempt = AuditRunAttemptSchema.parse({
      schemaVersion: 3,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: '2026-08-05T12:00:00.000Z',
      finishedAt: null,
      status: 'starting',
      publicReport: null,
      publicationState: 'not-prepared',
      snapshotState: 'not-retained',
    });
    await writeJsonArtifact(
      privateWork,
      `runs/${runId}.attempt.json`,
      AuditRunAttemptSchema,
      priorAttempt,
    );
    const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`);
    try {
      const recovered = await recoverAuditResumeSourceCapture({
        privateWork,
        runId,
        plan,
        priorAttempt,
      });
      if (recovered?.retainedSnapshot === undefined) {
        throw new Error('Expected a recovered retained source snapshot.');
      }
      expect(recovered.attempt.snapshotState).toBe('retained');
      expect(await recovered.retainedSnapshot.snapshot.document('source.unknown')).toEqual({
        path: 'source.unknown',
        content: 'sealed before crash\n',
        languageHint: null,
      });
      await expect(
        readJsonArtifact(privateWork, `runs/${runId}.attempt.json`, AuditRunAttemptSchema),
      ).resolves.toMatchObject({ snapshotState: 'retained' });
    } finally {
      await lease.release();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('discard binding requires the exact retained attempt identity', () => {
  const plan = createDiscardPlan('discard-binding-04');
  const attempt: AuditRunAttempt = {
    schemaVersion: 3,
    runId: 'audit-discard-04',
    planId: plan.planId,
    planDigest: plan.planDigest,
    targetFingerprint: plan.targetFingerprint,
    startedAt: '2026-08-04T12:00:00.000Z',
    finishedAt: null,
    status: 'starting',
    publicReport: null,
    publicationState: 'not-prepared',
    snapshotState: 'not-retained',
  };
  expect(() => assertAuditRunDiscardBinding({ runId: attempt.runId, plan, attempt })).not.toThrow();
  expect(() => assertAuditRunDiscardBinding({ runId: 'audit-other-04', plan, attempt })).toThrow(
    'does not match',
  );
  expect(() =>
    assertAuditRunDiscardBinding({
      runId: attempt.runId,
      plan,
      attempt: undefined,
    }),
  ).toThrow('requires its retained immutable attempt record');
});
