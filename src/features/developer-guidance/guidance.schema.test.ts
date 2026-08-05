import { expect, test } from 'bun:test';

import { DeveloperGuidanceCheckpointSchema } from './guidance.schema.js';

const digest = 'a'.repeat(64);

function checkpoint() {
  return {
    schemaVersion: 3,
    binding: {
      runId: 'guidance-run-001',
      reportId: 'report-001',
      reportDigest: digest,
      planId: 'plan-001',
      planDigest: digest,
      targetFingerprint: digest,
      contextDigest: digest,
      provider: 'openai',
      model: 'gpt-5.6-terra',
      protocolFingerprint: digest,
    },
    generatedAt: '2026-08-03T12:00:00.000Z',
    attempts: [
      {
        attempt: 1,
        item: {
          findingId: 'finding-001',
          findingFingerprint: digest,
          vectorId: 'vector-001',
          status: 'incomplete',
          reasonCode: 'provider-failure',
        },
        modelObservation: {
          stage: 'developer-guidance',
          route: 'primary',
          stageId: 'guidance-001',
          status: 'failed',
          durationMs: 0,
          errorCode: 'provider-failure',
          recoveredErrorCodes: [],
          usage: {
            modelCallCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
          cost: { totalTokens: 0, estimatedCostUsd: null, source: 'unavailable' },
          requests: [],
          toolUsage: {
            toolCallCount: 0,
            listFilesCallCount: 0,
            readFileCallCount: 0,
            grepFilesCallCount: 0,
            successfulReadFileCallCount: 0,
            successfulGrepFilesCallCount: 0,
            rejectedCallCount: 0,
            returnedBytes: 0,
          },
          trace: [],
          cacheRoutingEnabled: false,
        },
      },
    ],
  };
}

test('retains an exact terminal observation for every guidance attempt', () => {
  expect(DeveloperGuidanceCheckpointSchema.parse(checkpoint()).attempts).toHaveLength(1);
  expect(() =>
    DeveloperGuidanceCheckpointSchema.parse({
      ...checkpoint(),
      attempts: [
        {
          ...checkpoint().attempts[0],
          modelObservation: {
            ...checkpoint().attempts[0]?.modelObservation,
            stage: 'verification',
          },
        },
      ],
    }),
  ).toThrow('only developer-guidance');
  expect(() =>
    DeveloperGuidanceCheckpointSchema.parse({
      ...checkpoint(),
      attempts: [...checkpoint().attempts, { ...checkpoint().attempts[0], attempt: 3 }],
    }),
  ).toThrow('gap in attempt state');
});
