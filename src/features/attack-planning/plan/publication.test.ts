import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readJsonArtifact,
  readMarkdownArtifact,
  writeNewJsonArtifact,
  writeNewMarkdownArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import { createPlan } from './plan.js';
import { AttackPlanSchema } from './plan.schema.js';
import { renderAttackPlanMarkdown } from './plan-markdown.js';
import {
  beginPlanPublication,
  completePlanPublication,
  createPlanPublicationIntent,
  resumePlanPublication,
} from './publication.js';

function createFixturePlan() {
  return createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    createdAt: '2026-08-05T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review publication recovery',
        rationale: 'The publication pair must remain recoverable.',
        enabled: true,
        scopeGlobs: ['source.unknown'],
        reviewObligations: [
          {
            obligationId: 'publication-recovery-01',
            riskStatement: 'A private publication may stop between immutable artifacts.',
            evidenceRequirement: 'Retain one exact recovery intent.',
          },
        ],
        limitations: [],
      },
    ],
    additionalObservations: [],
  });
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'audit-plan-publication-'));
  await mkdir(root, { recursive: true });
  return root;
}

function createIntent(runId: string) {
  const plan = createFixturePlan();
  return createPlanPublicationIntent({
    command: 'plan',
    runId,
    plan,
    runManifest: {
      schemaVersion: 2,
      runId,
      command: 'plan',
      startedAt: '2026-08-05T12:00:00.000Z',
      finishedAt: '2026-08-05T12:01:00.000Z',
      targetFingerprint: plan.targetFingerprint,
      planId: plan.planId,
      provider: 'openai',
      model: 'gpt-5.6-terra',
      outcome: 'completed',
      counters: { plannedVectors: 1, completedVectors: 0, failedVectors: 0, findingCount: 0 },
    },
  });
}

test('recovers the full plan pair and manifest after interruption immediately after intent', async () => {
  const root = await createRoot();
  try {
    const intent = createIntent('plan-publication-intent-01');
    await beginPlanPublication(root, intent);

    await resumePlanPublication({ privateWork: root, command: 'plan', runId: intent.runId });

    await expect(readJsonArtifact(root, intent.planJsonPath, AttackPlanSchema)).resolves.toEqual(
      intent.plan,
    );
    await expect(readMarkdownArtifact(root, intent.planMarkdownPath)).resolves.toBe(
      renderAttackPlanMarkdown(intent.plan),
    );
    await expect(Bun.file(join(root, `runs/${intent.runId}.json`)).exists()).resolves.toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recovers only projections left after the plan JSON publication boundary', async () => {
  const root = await createRoot();
  try {
    const intent = createIntent('plan-publication-json-01');
    await beginPlanPublication(root, intent);
    await writeNewJsonArtifact(root, intent.planJsonPath, AttackPlanSchema, intent.plan);

    await completePlanPublication(root, intent);

    await expect(readMarkdownArtifact(root, intent.planMarkdownPath)).resolves.toBe(
      renderAttackPlanMarkdown(intent.plan),
    );
    await expect(Bun.file(join(root, `runs/${intent.runId}.json`)).exists()).resolves.toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recovers only the manifest left after the Markdown publication boundary', async () => {
  const root = await createRoot();
  try {
    const intent = createIntent('plan-publication-markdown-01');
    await beginPlanPublication(root, intent);
    await writeNewJsonArtifact(root, intent.planJsonPath, AttackPlanSchema, intent.plan);
    await writeNewMarkdownArtifact(
      root,
      intent.planMarkdownPath,
      renderAttackPlanMarkdown(intent.plan),
    );

    await completePlanPublication(root, intent);

    await expect(Bun.file(join(root, `runs/${intent.runId}.json`)).exists()).resolves.toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects an existing Markdown projection that does not exactly match the retained plan', async () => {
  const root = await createRoot();
  try {
    const intent = createIntent('plan-publication-mismatch-01');
    await beginPlanPublication(root, intent);
    await writeNewJsonArtifact(root, intent.planJsonPath, AttackPlanSchema, intent.plan);
    await writeNewMarkdownArtifact(root, intent.planMarkdownPath, '# altered projection\n');

    await expect(completePlanPublication(root, intent)).rejects.toMatchObject({
      code: 'artifact-invalid',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
