import { expect, test } from 'bun:test';
import { StageIsolatedEvaluationStagePackSchema } from './stage-isolated.schema.js';

test('rejects legacy v3 and requires exact evaluator route identity', () => {
  const pack = {
    schemaVersion: 2,
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
    contextDigest: 'd'.repeat(64),
    workflowProtocolFingerprint: 'd'.repeat(64),
    stageProtocolFingerprint: 'e'.repeat(64),
    evaluatorProtocolFingerprint: 'f'.repeat(64),
    provider: 'product',
    model: 'product-model',
    route: 'primary',
    productInput: { stage: 'planning', referenceId: 'input-01', fingerprint: '0'.repeat(64) },
    expectedOutcome: {
      privateReferenceId: 'rubric-01',
      fingerprint: '1'.repeat(64),
      expectedOutcomeCount: 0,
    },
  };
  expect(() => StageIsolatedEvaluationStagePackSchema.parse(pack)).toThrow();
  expect(() =>
    StageIsolatedEvaluationStagePackSchema.parse({ ...pack, schemaVersion: 3 }),
  ).toThrow();
  expect(
    StageIsolatedEvaluationStagePackSchema.parse({
      ...pack,
      schemaVersion: 4,
      evaluatorProvider: 'evaluator',
      evaluatorModel: 'evaluator-model',
      evaluatorRoute: 'primary',
    }).schemaVersion,
  ).toBe(4);
});
