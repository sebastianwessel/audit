import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StageIsolatedEvaluationStagePackSchema } from './stage-isolated.schema.js';
import {
  createStageIsolatedCheckpoint,
  loadStageIsolatedCheckpoint,
} from './stage-isolated-artifacts.js';

test('binds a stage checkpoint to the exact source-free canonical identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stage-artifacts-'));
  const pack = StageIsolatedEvaluationStagePackSchema.parse({
    schemaVersion: 4,
    packId: 'stage-pack-01',
    stage: 'planning',
    corpusPackId: 'corpus-pack-01',
    corpusPackVersion: '1.0.0',
    corpusManifestFingerprint: 'a'.repeat(64),
    caseId: 'case-01',
    variant: 'vulnerable',
    repetition: 1,
    planProfile: 'planning-generated',
    corpusSourceDigest: 'b'.repeat(64),
    targetFingerprint: 'c'.repeat(64),
    contextDigest: 'c'.repeat(64),
    workflowProtocolFingerprint: 'd'.repeat(64),
    stageProtocolFingerprint: 'e'.repeat(64),
    evaluatorProtocolFingerprint: 'f'.repeat(64),
    provider: 'product',
    model: 'product-model',
    route: 'primary',
    evaluatorProvider: 'evaluator',
    evaluatorModel: 'evaluator-model',
    evaluatorRoute: 'primary',
    productInput: { stage: 'planning', referenceId: 'input-01', fingerprint: '0'.repeat(64) },
    expectedOutcome: {
      privateReferenceId: 'rubric-01',
      fingerprint: '1'.repeat(64),
      expectedOutcomeCount: 0,
    },
  });
  await createStageIsolatedCheckpoint({
    evaluatorWorkRoot: root,
    pack,
    canonicalInputFingerprint: '2'.repeat(64),
    rubricFingerprint: '1'.repeat(64),
    startedAt: '2026-08-03T12:00:00.000Z',
  });
  await expect(
    loadStageIsolatedCheckpoint({
      evaluatorWorkRoot: root,
      pack,
      canonicalInputFingerprint: '3'.repeat(64),
      rubricFingerprint: '1'.repeat(64),
    }),
  ).rejects.toThrow();
});
