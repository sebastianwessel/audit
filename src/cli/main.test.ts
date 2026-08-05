import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AttackPlanDraftSchema,
  AttackPlanSchema,
  createPlan,
  resealAttackPlanDraft,
} from '../features/attack-planning/index.js';
import {
  AuditReportSchema,
  type AuditRunAttempt,
  AuditRunAttemptSchema,
  type VectorCoverage,
} from '../features/audit-execution/audit.schema.js';
import { AuditReportLineageSchema } from '../features/audit-lineage/contract.js';
import {
  createPublicAuditReport,
  PublicAuditReportSchema,
} from '../features/audit-report/public-contract.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  writeJsonArtifact,
} from '../platform/artifact-store/json-artifact-store.js';
import { createJailedReadOnlyFilesystem } from '../platform/filesystem/index.js';
import {
  captureTargetInventory,
  createPrivateSourceCapture,
  retainTargetSnapshot,
} from '../features/target-inventory/index.js';
import { createStableId, sha256 } from '../shared/contracts/core.js';
import { AuditRuntimeError } from '../shared/errors/audit-runtime-error.js';
import { parseHelpRequest, renderCliHelp } from './command-catalog.js';
import {
  assertAuditRunDiscardBinding,
  assertAuditRunReuse,
  auditRunOutcome,
  cliFailureExitCode,
  parseCliArguments,
  prepareProductRoots,
  recoverAuditResumeSourceCapture,
  runCli,
} from './main.js';

test('CLI parsing accepts only explicit command option pairs', () => {
  expect(parseCliArguments(['plan', '--target', 'fixture', '--work', 'work'])).toEqual({
    command: 'plan',
    options: { target: 'fixture', work: 'work' },
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
  expect(
    parseCliArguments([
      'plan-draft',
      '--work',
      'private-work',
      '--plan',
      'plans/plan.json',
      '--draft',
      'plan-drafts/review.json',
    ]),
  ).toEqual({
    command: 'plan-draft',
    options: { work: 'private-work', plan: 'plans/plan.json', draft: 'plan-drafts/review.json' },
  });
  expect(() => parseCliArguments(['plan', '--target'])).toThrow('Options must be unique');
  expect(() => parseCliArguments(['scan'])).toThrow('Expected one of');
});

test('CLI help is available without configuration, roots, or a provider', async () => {
  expect(parseHelpRequest(['--help'])).toBeNull();
  expect(parseHelpRequest(['help', 'audit'])).toBe('audit');
  expect(parseHelpRequest(['audit', '--help'])).toBe('audit');
  expect(parseHelpRequest(['help', 'unknown'])).toBeUndefined();
  expect(renderCliHelp()).toContain('`plan-reseal`');
  expect(renderCliHelp('discard')).toContain('--run-id');
  expect(renderCliHelp('audit')).toContain('--plan');
  await expect(runCli(['--help'])).resolves.toBe(0);
});

test('discard removes only the exact plan-bound private audit run without a provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-discard-'));
  const privateWork = join(root, 'private-work');
  const publicArtifacts = join(root, 'public-artifacts');
  await Promise.all([mkdir(privateWork), mkdir(publicArtifacts)]);
  try {
    const plan = discardPlan('discard-binding-01');
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
    await mkdir(join(privateWork, 'checkpoints', secondRunId), { recursive: true });
    await writeFile(join(privateWork, 'checkpoints', secondRunId, 'private.json'), '{}\n', 'utf8');
    await writeFile(join(publicArtifacts, 'preserved.json'), '{}\n', 'utf8');

    await expect(
      runCli([
        'discard',
        '--work',
        privateWork,
        '--plan',
        `plans/${plan.planId}.json`,
        '--run-id',
        runId,
      ]),
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
    const plan = discardPlan('discard-binding-02');
    const otherPlan = discardPlan('discard-binding-03');
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
      assertAuditRunDiscardBinding({ runId, plan: otherPlan, attempt: retainedAttempt }),
    ).toThrow('does not match');

    const activeLease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`);
    await expect(
      runCli([
        'discard',
        '--work',
        privateWork,
        '--plan',
        `plans/${plan.planId}.json`,
        '--run-id',
        runId,
      ]),
    ).rejects.toMatchObject({ code: 'artifact-lease-unavailable' });
    await expect(access(join(privateWork, 'checkpoints', runId))).resolves.toBeNull();
    await activeLease.release();

    const vector = plan.vectors[0];
    if (vector === undefined) throw new Error('Fixture requires one audit vector.');
    const tamperedPlan = AttackPlanSchema.parse({
      ...plan,
      vectors: [{ ...vector, rationale: 'This schema-valid plan was edited without resealing.' }],
    });
    await writeJsonArtifact(
      privateWork,
      'plans/tampered-plan.json',
      AttackPlanSchema,
      tamperedPlan,
    );
    await expect(
      runCli([
        'discard',
        '--work',
        privateWork,
        '--plan',
        'plans/tampered-plan.json',
        '--run-id',
        runId,
      ]),
    ).rejects.toMatchObject({ code: 'artifact-invalid' });
    await expect(access(join(privateWork, 'checkpoints', runId))).resolves.toBeNull();

    await expect(
      runCli([
        'discard',
        '--work',
        privateWork,
        '--plan',
        `plans/${otherPlan.planId}.json`,
        '--run-id',
        runId,
      ]),
    ).rejects.toMatchObject({ code: 'artifact-invalid' });
    await expect(access(join(privateWork, 'checkpoints', runId))).resolves.toBeNull();
    await expect(
      runCli([
        'discard',
        '--work',
        privateWork,
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

test('CLI rejects an unknown option before loading configuration or opening roots', async () => {
  await expect(
    runCli(['plan', '--target', 'does-not-matter', '--targett', 'typo']),
  ).rejects.toThrow('Unknown option --targett');
});

test('product CLI validates structured-output compatibility before opening product roots', async () => {
  const source = await readFile(new URL('./main.ts', import.meta.url), 'utf8');

  expect(source.indexOf('assertAuditWorkflowStructuredOutputCompatibility(')).toBeGreaterThan(-1);
  expect(source.indexOf('assertAuditWorkflowStructuredOutputCompatibility(')).toBeLessThan(
    source.indexOf('const roots = await prepareProductRoots('),
  );
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
      runCli([
        'plan-draft',
        '--work',
        work,
        '--plan',
        `plans/${basePlan.planId}.json`,
        '--draft',
        'plan-drafts/review.json',
      ]),
    ).resolves.toBe(0);

    const draft = await readJsonArtifact(work, 'plan-drafts/review.json', AttackPlanDraftSchema);
    const vector = draft.vectors[0];
    if (vector === undefined) throw new Error('Fixture requires one draft vector.');
    const editedDraft = { ...draft, vectors: [{ ...vector, scopeGlobs: ['private.unknown'] }] };
    await writeJsonArtifact(work, 'plan-drafts/review.json', AttackPlanDraftSchema, editedDraft);
    const resealed = resealAttackPlanDraft({
      basePlan,
      draft: editedDraft,
      resealedAt: '2026-08-04T12:01:00.000Z',
    });

    await expect(
      runCli([
        'plan-reseal',
        '--work',
        work,
        '--plan',
        `plans/${basePlan.planId}.json`,
        '--draft',
        'plan-drafts/review.json',
      ]),
    ).resolves.toBe(0);

    await expect(
      readJsonArtifact(work, `plans/${resealed.planId}.json`, AttackPlanSchema),
    ).resolves.toMatchObject({ ...resealed, resealedAt: expect.any(String) });
    await expect(readFile(join(work, `plans/${resealed.planId}.md`), 'utf8')).resolves.toContain(
      'read-only review projection',
    );
    await expect(
      runCli([
        'plan-draft',
        '--work',
        work,
        '--plan',
        `plans/${basePlan.planId}.json`,
        '--draft',
        'plan-drafts/review.json',
      ]),
    ).rejects.toMatchObject({ code: 'artifact-already-exists' });
  } finally {
    await rm(work, { force: true, recursive: true });
  }
});

test('CLI reserves exit code 4 for a provider failure that prevented report publication', () => {
  expect(cliFailureExitCode(new AuditRuntimeError('provider-failure', 'Unavailable.'))).toBe(4);
  expect(
    cliFailureExitCode(
      new AuditRuntimeError('agent-loop-budget-exceeded', 'The agent loop stopped.'),
    ),
  ).toBe(4);
  expect(cliFailureExitCode(new AuditRuntimeError('invalid-input', 'Invalid.'))).toBe(2);
});

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
    assertAuditRunReuse({ resume: true, plan, priorAttempt: { ...prior, status: 'completed' } }),
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
    const sourceCapture = await createPrivateSourceCapture({ outputRoot: privateWork, captureId: runId });
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
    await retainTargetSnapshot({ outputRoot: privateWork, runId, capture: captured });
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
      expect(await recovered.retainedSnapshot.snapshot.documents(['source.unknown'])).toEqual([
        { path: 'source.unknown', content: 'sealed before crash\n', languageHint: null },
      ]);
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

test('guidance refuses concurrent same-run ownership before opening a source capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-guidance-lease-'));
  try {
    const privateWork = join(root, 'private-work');
    const publicArtifacts = join(root, 'public-artifacts');
    const targetRoot = join(root, 'target');
    await Promise.all([mkdir(privateWork), mkdir(publicArtifacts), mkdir(targetRoot)]);
    const runId = 'guidance-lease-01';
    const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`);
    try {
      await expect(
        runCli([
          'guidance',
          '--target',
          targetRoot,
          '--work',
          privateWork,
          '--public-output',
          publicArtifacts,
          '--plan',
          'plans/missing.json',
          '--report',
          'reports/missing.json',
          '--run-id',
          runId,
        ]),
      ).rejects.toMatchObject({ code: 'artifact-lease-unavailable' });
      expect(await Bun.file(join(privateWork, 'work', 'snapshots', runId)).exists()).toBe(false);
    } finally {
      await lease.release();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('discard binding requires the exact retained attempt identity', () => {
  const plan = discardPlan('discard-binding-04');
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
    assertAuditRunDiscardBinding({ runId: attempt.runId, plan, attempt: undefined }),
  ).toThrow('requires its retained immutable attempt record');
});

function discardPlan(targetFingerprintSeed: string) {
  return createPlan({
    targetFingerprint: sha256(targetFingerprintSeed),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'discard fixture',
    createdAt: '2026-08-04T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review discard fixture',
        rationale: 'Private work needs an exact immutable binding.',
        enabled: true,
        scopeGlobs: ['source.unknown'],
        reviewObligations: [
          {
            obligationId: `discard-obligation-${targetFingerprintSeed}`,
            riskStatement: 'The private run must not be removed by another run.',
            evidenceRequirement: 'The immutable plan binding must match.',
          },
        ],
        limitations: [],
      },
    ],
  });
}

test('product roots reject output overlap before output creation', async () => {
  const target = await mkdtemp(join(tmpdir(), 'audit-cli-overlap-'));
  try {
    await expect(
      prepareProductRoots({
        targetRoot: target,
        publicArtifactRoot: target,
        privateWorkRoot: join(target, 'private-work'),
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

  expect(
    await runCli([
      'lineage',
      '--public-output',
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
