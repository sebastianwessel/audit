import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';
import { prepareProductRoots, runAudit } from '../../src/cli/main.js';
import { AttackPlanSchema, createPlan } from '../../src/features/attack-planning/index.js';
import {
  AuditRunAttemptSchema,
  AuditRunManifestSchema,
  AuditVectorCheckpointSchema,
} from '../../src/features/audit-execution/audit.schema.js';
import { auditCheckpointPath } from '../../src/features/audit-execution/checkpoints.js';
import { PublicAuditReportSchema } from '../../src/features/audit-report/public-contract.js';
import { captureTargetInventory } from '../../src/features/target-inventory/inventory.js';
import { loadRetainedTargetSnapshot } from '../../src/features/target-inventory/snapshot-store.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  readOptionalJsonArtifact,
  writeJsonArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { RuntimeConfigurationSchema } from '../../src/platform/configuration/environment.js';
import { createJailedReadOnlyFilesystem } from '../../src/platform/filesystem/index.js';
import { createStableId } from '../../src/shared/contracts/core.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('audit resume uses the retained snapshot after the target changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-audit-lifecycle-'));
  roots.push(root);
  const targetRoot = join(root, 'target');
  const publicArtifactRoot = join(root, 'public-artifacts');
  const privateWorkRoot = join(root, 'private-work');
  await mkdir(targetRoot);
  await writeFile(join(targetRoot, 'service.custom'), 'original source\n', 'utf8');
  const capture = await captureTargetInventory(
    await createJailedReadOnlyFilesystem({ targetRoot }),
  );
  const plan = createPlan({
    targetFingerprint: capture.inventory.targetFingerprint,
    contextDigest: capture.inventory.contextDigest,
    targetDisplayName: 'lifecycle fixture',
    createdAt: '2026-08-03T12:00:00.000Z',
    inventorySummary: capture.inventory.summary,
    vectors: [
      {
        title: 'Review an intentionally unmatched scope',
        rationale: 'This fixture reaches incomplete coverage without a provider request.',
        enabled: true,
        scopeGlobs: ['not-present.unknown'],
        reviewObligations: [
          {
            obligationId: 'lifecycle-obligation-01',
            riskStatement: 'The plan must preserve its evidence boundary across resume.',
            evidenceRequirement: 'The unmatched scope remains explicit and incomplete.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const rootsTopology = await prepareProductRoots({
    targetRoot,
    publicArtifactRoot,
    privateWorkRoot,
  });
  await writeJsonArtifact(
    rootsTopology.privateWorkRoot,
    `plans/${plan.planId}.json`,
    AttackPlanSchema,
    plan,
  );
  const runtime = RuntimeConfigurationSchema.parse({
    provider: 'openai',
    model: 'fixture-model',
    publicArtifactDirectory: publicArtifactRoot,
    privateWorkDirectory: privateWorkRoot,
    evaluationCorpusRoot: 'evaluation/data/corpora',
    evaluationOutputRoot: 'evaluation/runs',
    maxParallelVectors: 1,
    modelPricing: {},
    verificationMode: 'same-route',
  });
  const runId = 'audit-lifecycle-01';
  const options = { plan: `plans/${plan.planId}.json`, 'run-id': runId };
  const provider = new FakeModelProvider();

  await expect(runAudit(options, runtime, provider, rootsTopology)).resolves.toBe(3);
  const reportId = createStableId('report', `${plan.planId}\0${runId}`);
  await expect(
    readJsonArtifact(
      rootsTopology.publicArtifactRoot,
      `reports/${reportId}.json`,
      PublicAuditReportSchema,
    ),
  ).resolves.toMatchObject({ runId, targetFingerprint: plan.targetFingerprint });
  await expect(
    readFile(join(rootsTopology.publicArtifactRoot, `reports/${reportId}.md`), 'utf8'),
  ).resolves.toContain('## Outcome');
  await expect(
    readJsonArtifact(
      rootsTopology.privateWorkRoot,
      `runs/${runId}.attempt.json`,
      AuditRunAttemptSchema,
    ),
  ).resolves.toMatchObject({ status: 'partial' });
  await expect(
    readJsonArtifact(
      rootsTopology.publicArtifactRoot,
      `runs/${runId}.json`,
      AuditRunManifestSchema,
    ),
  ).resolves.toMatchObject({ outcome: 'partial' });

  await writeFile(join(targetRoot, 'service.custom'), 'changed source\n', 'utf8');
  await expect(
    runAudit(
      { ...options, resume: 'true', 'retry-unfinished': 'true' },
      runtime,
      provider,
      rootsTopology,
    ),
  ).resolves.toBe(3);
  const retained = await loadRetainedTargetSnapshot({
    outputRoot: rootsTopology.privateWorkRoot,
    runId,
    targetFingerprint: plan.targetFingerprint,
    contextDigest: plan.contextDigest,
  });
  expect(retained.snapshot.documents()).toEqual([
    { path: 'service.custom', content: 'original source\n', languageHint: null },
  ]);

  const blockedRunId = 'audit-lifecycle-held-lease-01';
  const heldLease = await acquireArtifactLease(
    rootsTopology.privateWorkRoot,
    `work/leases/${blockedRunId}.lock`,
  );
  try {
    await expect(
      runAudit(
        { plan: `plans/${plan.planId}.json`, 'run-id': blockedRunId },
        runtime,
        provider,
        rootsTopology,
      ),
    ).rejects.toMatchObject({ code: 'artifact-lease-unavailable' });
    await expect(
      readOptionalJsonArtifact(
        rootsTopology.privateWorkRoot,
        `runs/${blockedRunId}.attempt.json`,
        AuditRunAttemptSchema,
      ),
    ).resolves.toBeUndefined();
  } finally {
    await heldLease.release();
  }
});

test('a manifest publication failure retains private ownership after report files are public', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-audit-report-failure-'));
  roots.push(root);
  const targetRoot = join(root, 'target');
  const publicArtifactRoot = join(root, 'public-artifacts');
  const privateWorkRoot = join(root, 'private-work');
  await mkdir(targetRoot);
  await writeFile(join(targetRoot, 'service.custom'), 'source\n', 'utf8');
  const capture = await captureTargetInventory(
    await createJailedReadOnlyFilesystem({ targetRoot }),
  );
  const plan = createPlan({
    targetFingerprint: capture.inventory.targetFingerprint,
    contextDigest: capture.inventory.contextDigest,
    targetDisplayName: 'report failure fixture',
    createdAt: '2026-08-03T12:00:00.000Z',
    inventorySummary: capture.inventory.summary,
    vectors: [
      {
        title: 'Keep incomplete scope checkpointed',
        rationale: 'Publication failure must not erase reached audit coverage.',
        enabled: true,
        scopeGlobs: ['not-present.unknown'],
        reviewObligations: [
          {
            obligationId: 'report-failure-obligation-01',
            riskStatement: 'Reached audit state must survive report publication failure.',
            evidenceRequirement: 'Retain a terminal vector checkpoint and failed attempt.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const rootsTopology = await prepareProductRoots({
    targetRoot,
    publicArtifactRoot,
    privateWorkRoot,
  });
  await writeJsonArtifact(
    rootsTopology.privateWorkRoot,
    `plans/${plan.planId}.json`,
    AttackPlanSchema,
    plan,
  );
  await mkdir(join(rootsTopology.publicArtifactRoot, 'reports'));
  await writeFile(join(rootsTopology.publicArtifactRoot, 'runs'), 'not a directory', 'utf8');
  const runtime = RuntimeConfigurationSchema.parse({
    provider: 'openai',
    model: 'fixture-model',
    publicArtifactDirectory: publicArtifactRoot,
    privateWorkDirectory: privateWorkRoot,
    evaluationCorpusRoot: 'evaluation/data/corpora',
    evaluationOutputRoot: 'evaluation/runs',
    maxParallelVectors: 1,
    modelPricing: {},
    verificationMode: 'same-route',
  });
  const runId = 'audit-report-failure-01';
  const reportId = createStableId('report', `${plan.planId}\0${runId}`);

  await expect(
    runAudit(
      { plan: `plans/${plan.planId}.json`, 'run-id': runId },
      runtime,
      new FakeModelProvider(),
      rootsTopology,
    ),
  ).rejects.toMatchObject({ code: 'artifact-invalid-output-path' });
  await expect(
    readJsonArtifact(
      rootsTopology.publicArtifactRoot,
      `reports/${reportId}.json`,
      PublicAuditReportSchema,
    ),
  ).resolves.toMatchObject({ reportId, runId });
  await expect(
    readFile(join(rootsTopology.publicArtifactRoot, `reports/${reportId}.md`), 'utf8'),
  ).resolves.toContain('## Outcome');
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('The fixture needs one vector.');
  await expect(
    readJsonArtifact(
      rootsTopology.privateWorkRoot,
      auditCheckpointPath(runId, vector.vectorId),
      AuditVectorCheckpointSchema,
    ),
  ).resolves.toMatchObject({ result: { coverage: { outcome: 'incomplete' } } });
  await expect(
    readJsonArtifact(
      rootsTopology.privateWorkRoot,
      `runs/${runId}.attempt.json`,
      AuditRunAttemptSchema,
    ),
  ).resolves.toMatchObject({
    status: 'failed',
    publicationState: 'prepared',
    snapshotState: 'retained',
    publicReport: { reportId },
  });
});
