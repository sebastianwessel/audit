import { expect, test } from 'bun:test';
import { StageIsolatedEvaluationStagePublicResultSchema } from './stage-isolated.schema.js';
import { compareStageIsolatedEvaluations } from './stage-isolated-comparison.js';

test('withholds comparisons when evaluator identity differs', () => {
  const result = StageIsolatedEvaluationStagePublicResultSchema.parse({
    schemaVersion: 3,
    pack: {
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
      expectedOutcomeCount: 0,
    },
    completion: { status: 'incomplete', errorCode: 'provider-failure' },
    validation: {
      input: { status: 'passed', errorCodes: [] },
      output: { status: 'failed', errorCodes: ['provider-failure'] },
    },
    toolInspection: {
      scopedManifestEntryCount: 0,
      inspectionRequired: false,
      inspectedWithReadOrGrep: false,
      usage: {
        toolCallCount: 0,
        listFilesCallCount: 0,
        readFileCallCount: 0,
        grepFilesCallCount: 0,
        successfulReadFileCallCount: 0,
        successfulGrepFilesCallCount: 0,
        rejectedCallCount: 0,
        returnedBytes: 0,
      },
    },
    telemetry: {
      latencyMs: 0,
      usage: {
        modelCallCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      cost: { totalTokens: 0, estimatedCostUsd: null, source: 'unavailable' },
      trace: [],
    },
    modelObservations: [],
    evaluatorObservation: null,
    semanticOutcome: {
      matchedExpectedOutcomeCount: 0,
      missingExpectedOutcomeCount: 0,
      notApplicableExpectedOutcomeCount: 0,
      unexpectedOutcomeCount: 0,
    },
    localization: {
      matchedExpectedOutcomeWithRoleBundleCount: 0,
      roleBundleCount: 0,
      roleCount: 0,
      locationCount: 0,
    },
  });
  expect(
    compareStageIsolatedEvaluations({
      comparisonKind: 'same-stage-regression',
      baseline: result,
      candidate: {
        ...result,
        pack: { ...result.pack, evaluatorProtocolFingerprint: '0'.repeat(64) },
      },
    }).comparable,
  ).toBeFalse();
});
