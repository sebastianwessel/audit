import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertAuditRunDiscardBinding } from '../../src/cli/commands/audit/index.js';
import { prepareConfiguredProductRoots } from '../../src/cli/configured-roots.js';
import { runCli } from '../../src/cli/main.js';
import {
  AttackPlanDraftSchema,
  AttackPlanSchema,
  createPlan,
  resealAttackPlanDraft,
} from '../../src/features/attack-planning/index.js';
import {
  AuditReportSchema,
  AuditRunAttemptSchema,
  type VectorCoverage,
} from '../../src/features/audit-execution/audit.schema.js';
import { AuditReportLineageSchema } from '../../src/features/audit-lineage/contract.js';
import {
  createPublicAuditReport,
  PublicAuditReportSchema,
} from '../../src/features/audit-report/public-contract.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  writeJsonArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { loadRuntimeConfiguration } from '../../src/platform/configuration/environment.js';
import { createStableId } from '../../src/shared/contracts/core.js';
import { createDiscardPlan } from '../test-support/cli-fixtures.js';

function runtimeForRoots(privateWorkDirectory: string, publicArtifactDirectory: string) {
  return () =>
    loadRuntimeConfiguration({
      environment: {
        AUDIT_PRIVATE_WORK_DIR: privateWorkDirectory,
        AUDIT_PUBLIC_ARTIFACT_DIR: publicArtifactDirectory,
      },
      loadDotEnv: false,
    });
}

test('discard removes only the exact plan-bound private audit run without a provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-discard-'));
  const privateWork = join(root, 'private-work');
  const publicArtifacts = join(root, 'public-artifacts');
  await Promise.all([mkdir(privateWork), mkdir(publicArtifacts)]);
  try {
    const plan = createDiscardPlan('discard-binding-01');
    const runId = 'audit-discard-01';
    const secondRunId = 'audit-discard-02';
    await writeJsonArtifact(privateWork, `plans/${plan.planId}.json`, AttackPlanSchema, plan);
    await writeJsonArtifact(privateWork, `runs/${runId}.attempt.json`, AuditRunAttemptSchema, {
      schemaVersion: 3,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: '2026-08-04T12:00:00.000Z',
      finishedAt: '2026-08-04T12:01:00.000Z',
      status: 'failed',
      publicReport: null,
      publicationState: 'not-prepared',
      snapshotState: 'not-retained',
    });
    await mkdir(join(privateWork, 'checkpoints', runId), { recursive: true });
    await writeFile(join(privateWork, 'checkpoints', runId, 'private.json'), '{}\n', 'utf8');
    await writeJsonArtifact(
      privateWork,
      `runs/${secondRunId}.attempt.json`,
      AuditRunAttemptSchema,
      {
        schemaVersion: 3,
        runId: secondRunId,
        planId: plan.planId,
        planDigest: plan.planDigest,
        targetFingerprint: plan.targetFingerprint,
        startedAt: '2026-08-04T12:00:00.000Z',
        finishedAt: '2026-08-04T12:01:00.000Z',
        status: 'failed',
        publicReport: null,
        publicationState: 'not-prepared',
        snapshotState: 'not-retained',
      },
    );
    await mkdir(join(privateWork, 'checkpoints', secondRunId), {
      recursive: true,
    });
    await writeFile(join(privateWork, 'checkpoints', secondRunId, 'private.json'), '{}\n', 'utf8');
    await writeFile(join(publicArtifacts, 'preserved.json'), '{}\n', 'utf8');

    await expect(
      runCli(['discard', '--plan', `plans/${plan.planId}.json`, '--run-id', runId], {
        loadRuntimeConfiguration: runtimeForRoots(privateWork, publicArtifacts),
      }),
    ).resolves.toBe(0);

    expect(await Bun.file(join(privateWork, `runs/${runId}.attempt.json`)).exists()).toBe(false);
    await expect(access(join(privateWork, 'checkpoints', runId))).rejects.toThrow();
    expect(await Bun.file(join(privateWork, `plans/${plan.planId}.json`)).exists()).toBe(true);
    expect(await Bun.file(join(privateWork, `runs/${secondRunId}.attempt.json`)).exists()).toBe(
      true,
    );
    await expect(access(join(privateWork, 'checkpoints', secondRunId))).resolves.toBeNull();
    expect(await Bun.file(join(publicArtifacts, 'preserved.json')).exists()).toBe(true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('discard rejects an active lease, mismatched binding, and out-of-scope roots before deleting run state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-discard-reject-'));
  const privateWork = join(root, 'private-work');
  const publicArtifacts = join(root, 'public-artifacts');
  await Promise.all([mkdir(privateWork), mkdir(publicArtifacts)]);
  try {
    const plan = createDiscardPlan('discard-binding-02');
    const otherPlan = createDiscardPlan('discard-binding-03');
    const runId = 'audit-discard-02';
    await writeJsonArtifact(privateWork, `plans/${plan.planId}.json`, AttackPlanSchema, plan);
    await writeJsonArtifact(
      privateWork,
      `plans/${otherPlan.planId}.json`,
      AttackPlanSchema,
      otherPlan,
    );
    await writeJsonArtifact(privateWork, `runs/${runId}.attempt.json`, AuditRunAttemptSchema, {
      schemaVersion: 3,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: '2026-08-04T12:00:00.000Z',
      finishedAt: null,
      status: 'starting',
      publicReport: null,
      publicationState: 'not-prepared',
      snapshotState: 'not-retained',
    });
    await mkdir(join(privateWork, 'checkpoints', runId), { recursive: true });
    await writeFile(join(privateWork, 'checkpoints', runId, 'private.json'), '{}\n', 'utf8');
    const retainedAttempt = await readJsonArtifact(
      privateWork,
      `runs/${runId}.attempt.json`,
      AuditRunAttemptSchema,
    );
    expect(plan.planId).not.toBe(otherPlan.planId);
    expect(() =>
      assertAuditRunDiscardBinding({
        runId,
        plan: otherPlan,
        attempt: retainedAttempt,
      }),
    ).toThrow('does not match');

    const activeLease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`);
    await expect(
      runCli(['discard', '--plan', `plans/${plan.planId}.json`, '--run-id', runId], {
        loadRuntimeConfiguration: runtimeForRoots(privateWork, publicArtifacts),
      }),
    ).rejects.toMatchObject({ code: 'artifact-lease-unavailable' });
    await expect(access(join(privateWork, 'checkpoints', runId))).resolves.toBeNull();
    await activeLease.release();

    const vector = plan.vectors[0];
    if (vector === undefined) throw new Error('Fixture requires one audit vector.');
    const tamperedPlan = AttackPlanSchema.parse({
      ...plan,
      vectors: [
        {
          ...vector,
          rationale: 'This schema-valid plan was edited without resealing.',
        },
      ],
    });
    await writeJsonArtifact(
      privateWork,
      'plans/tampered-plan.json',
      AttackPlanSchema,
      tamperedPlan,
    );
    await expect(
      runCli(['discard', '--plan', 'plans/tampered-plan.json', '--run-id', runId], {
        loadRuntimeConfiguration: runtimeForRoots(privateWork, publicArtifacts),
      }),
    ).rejects.toMatchObject({ code: 'artifact-invalid' });
    await expect(access(join(privateWork, 'checkpoints', runId))).resolves.toBeNull();

    await expect(
      runCli(['discard', '--plan', `plans/${otherPlan.planId}.json`, '--run-id', runId], {
        loadRuntimeConfiguration: runtimeForRoots(privateWork, publicArtifacts),
      }),
    ).rejects.toMatchObject({ code: 'artifact-invalid' });
    await expect(access(join(privateWork, 'checkpoints', runId))).resolves.toBeNull();
    await expect(
      runCli([
        'discard',
        '--public-output',
        publicArtifacts,
        '--plan',
        `plans/${plan.planId}.json`,
        '--run-id',
        runId,
      ]),
    ).rejects.toThrow('Unknown option --public-output');
    expect(await Bun.file(join(privateWork, `runs/${runId}.attempt.json`)).exists()).toBe(true);
    await expect(access(join(privateWork, 'checkpoints', runId))).resolves.toBeNull();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('plan authoring commands create a constrained draft and publish a new plan pair without target access', async () => {
  const work = await mkdtemp(join(tmpdir(), 'audit-plan-authoring-'));
  try {
    const basePlan = createPlan({
      targetFingerprint: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      targetDisplayName: 'fixture',
      createdAt: '2026-08-03T12:00:00.000Z',
      inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
      vectors: [
        {
          title: 'Review authorization boundaries',
          rationale: 'Protected behavior requires an explicit review.',
          enabled: true,
          scopeGlobs: ['source.unknown'],
          reviewObligations: [
            {
              obligationId: 'authoring-obligation-01',
              riskStatement: 'A caller may reach protected data without authorization.',
              evidenceRequirement: 'Source evidence identifies the protected operation.',
            },
          ],
          limitations: [],
        },
      ],
    });
    await writeJsonArtifact(work, `plans/${basePlan.planId}.json`, AttackPlanSchema, basePlan);

    await expect(
      runCli(
        [
          'plan-draft',
          '--plan',
          `plans/${basePlan.planId}.json`,
          '--draft',
          'plan-drafts/review.json',
        ],
        {
          loadRuntimeConfiguration: runtimeForRoots(work, join(work, 'public-artifacts')),
        },
      ),
    ).resolves.toBe(0);

    const draft = await readJsonArtifact(work, 'plan-drafts/review.json', AttackPlanDraftSchema);
    const vector = draft.vectors[0];
    if (vector === undefined) throw new Error('Fixture requires one draft vector.');
    const editedDraft = {
      ...draft,
      vectors: [{ ...vector, scopeGlobs: ['private.unknown'] }],
    };
    await writeJsonArtifact(work, 'plan-drafts/review.json', AttackPlanDraftSchema, editedDraft);
    const resealed = resealAttackPlanDraft({
      basePlan,
      draft: editedDraft,
      resealedAt: '2026-08-04T12:01:00.000Z',
    });

    await expect(
      runCli(
        [
          'plan-reseal',
          '--plan',
          `plans/${basePlan.planId}.json`,
          '--draft',
          'plan-drafts/review.json',
        ],
        {
          loadRuntimeConfiguration: runtimeForRoots(work, join(work, 'public-artifacts')),
        },
      ),
    ).resolves.toBe(0);

    await expect(
      readJsonArtifact(work, `plans/${resealed.planId}.json`, AttackPlanSchema),
    ).resolves.toMatchObject({ ...resealed, resealedAt: expect.any(String) });
    await expect(readFile(join(work, `plans/${resealed.planId}.md`), 'utf8')).resolves.toContain(
      'read-only review projection',
    );
    await expect(
      runCli(
        [
          'plan-draft',
          '--plan',
          `plans/${basePlan.planId}.json`,
          '--draft',
          'plan-drafts/review.json',
        ],
        {
          loadRuntimeConfiguration: runtimeForRoots(work, join(work, 'public-artifacts')),
        },
      ),
    ).rejects.toMatchObject({ code: 'artifact-already-exists' });
  } finally {
    await rm(work, { force: true, recursive: true });
  }
});

test('product roots reject output overlap before output creation', async () => {
  const target = await mkdtemp(join(tmpdir(), 'audit-cli-overlap-'));
  try {
    await expect(
      prepareConfiguredProductRoots({
        configuration: {
          privateWorkDirectory: join(target, 'private-work'),
          publicArtifactDirectory: target,
        },
        targetRoot: target,
      }),
    ).rejects.toMatchObject({ code: 'artifact-root-topology-invalid' });
  } finally {
    await rm(target, { force: true, recursive: true });
  }
});

test('lineage command compares only two jailed report artifacts without a provider or target', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-lineage-'));
  const coverage = {
    vectorId: 'vector-lineage-01',
    planned: true,
    completed: true,
    matchedSourcePaths: 1,
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
    schemaVersion: 21 as const,
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
  const previous = createPublicAuditReport(
    AuditReportSchema.parse(createReport('report-previous-01')),
  );
  const current = createPublicAuditReport(
    AuditReportSchema.parse(createReport('report-current-001')),
  );
  await writeJsonArtifact(output, 'reports/previous.json', PublicAuditReportSchema, previous);
  await writeJsonArtifact(output, 'reports/current.json', PublicAuditReportSchema, current);

  await expect(
    runCli(['report', '--report', 'reports/current.json'], {
      loadRuntimeConfiguration: runtimeForRoots(join(output, 'private-work'), output),
    }),
  ).resolves.toBe(0);

  expect(
    await runCli(
      ['lineage', '--previous', 'reports/previous.json', '--current', 'reports/current.json'],
      {
        loadRuntimeConfiguration: runtimeForRoots(join(output, 'private-work'), output),
      },
    ),
  ).toBe(0);

  const lineageId = createStableId('lineage', `${previous.reportId}\0${current.reportId}`);
  expect(
    await readJsonArtifact(output, `lineage/${lineageId}.json`, AuditReportLineageSchema),
  ).toMatchObject({
    counts: { new: 0, persisting: 0, resolved: 0, unknown: 0 },
  });
});
