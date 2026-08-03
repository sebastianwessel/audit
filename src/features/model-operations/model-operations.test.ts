import { describe, expect, test } from 'bun:test';
import {
  combineModelUsage,
  combineToolUsage,
  createModelCostCeiling,
  createModelStageTraceRecorder,
  observeModelRun,
  observeModelStage,
  summarizeModelCost,
  summarizeModelStages,
} from './model-operations.js';
import { ModelStageObservationSchema } from './model-operations.schema.js';

describe('model operations', () => {
  test('calculates cached input as a subset of total input', () => {
    expect(
      summarizeModelCost(
        {
          modelCallCount: 2,
          inputTokens: 1_000_000,
          outputTokens: 500_000,
          cachedInputTokens: 400_000,
          reasoningTokens: 12,
        },
        {
          inputPerMillion: 2,
          cachedInputPerMillion: 0.5,
          outputPerMillion: 8,
          source: 'catalogue',
        },
      ),
    ).toEqual({
      totalTokens: 1_500_000,
      estimatedCostUsd: 5.4,
      source: 'catalogue',
    });
  });

  test('marks missing prices as unavailable instead of zero', () => {
    expect(
      summarizeModelCost(
        {
          modelCallCount: 1,
          inputTokens: 4,
          outputTokens: 2,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        {},
      ),
    ).toEqual({
      totalTokens: 6,
      estimatedCostUsd: null,
      source: 'unavailable',
    });
  });

  test('preserves a verified catalogue price source in the cost observation', () => {
    expect(
      summarizeModelCost(
        {
          modelCallCount: 1,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        { inputPerMillion: 1.75, outputPerMillion: 14, source: 'catalogue' },
      ),
    ).toEqual({
      totalTokens: 2_000_000,
      estimatedCostUsd: 15.75,
      source: 'catalogue',
    });
  });

  test('rejects ad-hoc price rates without the bundled catalogue source', () => {
    expect(() =>
      summarizeModelCost(
        {
          modelCallCount: 1,
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
        { inputPerMillion: 1, outputPerMillion: 1 },
      ),
    ).toThrow('bundled catalogue');
  });

  test('retains the crossing response and blocks the next model request', () => {
    const ceiling = createModelCostCeiling({
      configuredUsd: 0.000002,
      pricing: { inputPerMillion: 1, outputPerMillion: 1, source: 'catalogue' },
    });
    ceiling.beforeRequest();
    ceiling.recordResponse(
      {
        modelCallCount: 1,
        inputTokens: 1,
        outputTokens: 2,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
      { inputPerMillion: 1, outputPerMillion: 1, source: 'catalogue' },
    );
    expect(ceiling.state()).toEqual({
      configuredUsd: 0.000002,
      accumulatedEstimatedCostUsd: 0.000003,
      reached: true,
    });
    expect(() => ceiling.beforeRequest()).toThrow('model-cost ceiling');
  });

  test('rejects a cost ceiling when pricing cannot produce an estimate', () => {
    expect(() => createModelCostCeiling({ configuredUsd: 1, pricing: {} })).toThrow(
      'known exact-model catalogue pricing',
    );
  });

  test('adds an orphaned checkpoint stage once before resumed dispatch', () => {
    const stage = observeModelStage({
      stage: 'planning',
      route: 'primary',
      stageId: 'checkpointed-plan',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [
        {
          durationMs: 1,
          usage: {
            modelCallCount: 1,
            inputTokens: 1,
            outputTokens: 1,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
        },
      ],
      pricing: { inputPerMillion: 1, outputPerMillion: 1, source: 'catalogue' },
      cacheRoutingEnabled: false,
    });
    const ceiling = createModelCostCeiling({
      configuredUsd: 0.000002,
      pricing: { inputPerMillion: 1, outputPerMillion: 1, source: 'catalogue' },
    });
    ceiling.recordPriorStages([stage, stage]);
    expect(ceiling.state().accumulatedEstimatedCostUsd).toBe(0.000002);
    expect(() => ceiling.beforeRequest()).toThrow('model-cost ceiling');
  });

  test('combines numeric observations without content', () => {
    const observation = observeModelRun({
      usage: combineModelUsage([
        {
          modelCallCount: 1,
          inputTokens: 3,
          outputTokens: 2,
          cachedInputTokens: 1,
          reasoningTokens: 0,
        },
        {
          modelCallCount: 1,
          inputTokens: 5,
          outputTokens: 4,
          cachedInputTokens: 2,
          reasoningTokens: 1,
        },
      ]),
      pricing: {},
      cacheRoutingEnabled: true,
    });
    expect(observation).toEqual({
      usage: {
        modelCallCount: 2,
        inputTokens: 8,
        outputTokens: 6,
        cachedInputTokens: 3,
        reasoningTokens: 1,
      },
      cost: { totalTokens: 14, estimatedCostUsd: null, source: 'unavailable' },
      toolUsage: {
        toolCallCount: 0,
        listFilesCallCount: 0,
        readFileCallCount: 0,
        grepFilesCallCount: 0,
        successfulReadFileCallCount: 0,
        successfulGrepFilesCallCount: 0,
        rejectedCallCount: 0,
        returnedBytes: 0,
        budgetExhausted: false,
      },
      cacheRoutingEnabled: true,
      stages: [],
    });
  });

  test('keeps failed and completed workflow stages separately while deriving the run total', () => {
    const observation = summarizeModelStages(
      [
        observeModelStage({
          stage: 'planning',
          route: 'primary',
          stageId: 'plan-run-01',
          status: 'completed',
          durationMs: 12.4,
          errorCode: null,
          requests: [
            {
              durationMs: 12,
              usage: {
                modelCallCount: 1,
                inputTokens: 10,
                outputTokens: 2,
                cachedInputTokens: 0,
                reasoningTokens: 0,
              },
            },
          ],
          pricing: {},
          cacheRoutingEnabled: true,
        }),
        observeModelStage({
          stage: 'investigation',
          route: 'primary',
          stageId: 'vector-injection-01',
          status: 'failed',
          durationMs: 5.2,
          errorCode: 'provider-failure',
          requests: [],
          pricing: {},
          cacheRoutingEnabled: true,
        }),
        observeModelStage({
          stage: 'verification',
          route: 'primary',
          stageId: 'vector-injection-01-hypothesis-01',
          status: 'completed',
          durationMs: 7.4,
          errorCode: null,
          requests: [
            {
              durationMs: 7,
              usage: {
                modelCallCount: 1,
                inputTokens: 4,
                outputTokens: 1,
                cachedInputTokens: 0,
                reasoningTokens: 0,
              },
            },
          ],
          pricing: {},
          cacheRoutingEnabled: true,
        }),
      ],
      {},
    );
    expect(observation).toMatchObject({
      usage: { modelCallCount: 2, inputTokens: 14, outputTokens: 3 },
      stages: [
        { stage: 'planning', status: 'completed', durationMs: 12 },
        {
          stage: 'investigation',
          status: 'failed',
          errorCode: 'provider-failure',
          durationMs: 5,
        },
        { stage: 'verification', status: 'completed', durationMs: 7 },
      ],
    });
  });

  test('aggregates distinct route pricing and fails closed when one route is unavailable', () => {
    const primary = observeModelStage({
      stage: 'investigation',
      route: 'primary',
      stageId: 'route-primary-01',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [
        {
          durationMs: 1,
          usage: {
            modelCallCount: 1,
            inputTokens: 1_000,
            outputTokens: 100,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
        },
      ],
      pricing: { inputPerMillion: 1, outputPerMillion: 2, source: 'catalogue' },
      cacheRoutingEnabled: true,
    });
    const independent = observeModelStage({
      stage: 'verification',
      route: 'independent',
      stageId: 'route-independent-01',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [
        {
          durationMs: 1,
          usage: {
            modelCallCount: 1,
            inputTokens: 1_000,
            outputTokens: 100,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
        },
      ],
      pricing: { inputPerMillion: 3, outputPerMillion: 4, source: 'catalogue' },
      cacheRoutingEnabled: false,
    });
    expect(summarizeModelStages([primary, independent], {}).cost).toMatchObject({
      source: 'catalogue',
      estimatedCostUsd: 0.0046,
    });
    const unavailable = observeModelStage({
      ...independent,
      stageId: 'route-independent-02',
      requests: [],
      pricing: {},
    });
    expect(summarizeModelStages([primary, unavailable], {}).cost).toEqual({
      totalTokens: 1_100,
      estimatedCostUsd: null,
      source: 'unavailable',
    });
  });

  test('combines content-free tool usage without retaining tool data', () => {
    expect(
      combineToolUsage([
        {
          toolCallCount: 2,
          listFilesCallCount: 1,
          readFileCallCount: 1,
          grepFilesCallCount: 0,
          successfulReadFileCallCount: 1,
          successfulGrepFilesCallCount: 0,
          rejectedCallCount: 0,
          returnedBytes: 10,
          budgetExhausted: false,
        },
        {
          toolCallCount: 2,
          listFilesCallCount: 0,
          readFileCallCount: 0,
          grepFilesCallCount: 2,
          successfulReadFileCallCount: 0,
          successfulGrepFilesCallCount: 1,
          rejectedCallCount: 1,
          returnedBytes: 4,
          budgetExhausted: true,
        },
      ]),
    ).toEqual({
      toolCallCount: 4,
      listFilesCallCount: 1,
      readFileCallCount: 1,
      grepFilesCallCount: 2,
      successfulReadFileCallCount: 1,
      successfulGrepFilesCallCount: 1,
      rejectedCallCount: 1,
      returnedBytes: 14,
      budgetExhausted: true,
    });
  });

  test('retains an ordered, content-free model and tool trace for diagnosis', () => {
    const trace = createModelStageTraceRecorder({
      pricing: { inputPerMillion: 1, outputPerMillion: 2, source: 'catalogue' },
    });
    trace.recordModelResponse({
      durationMs: 5,
      usage: {
        modelCallCount: 1,
        inputTokens: 10,
        outputTokens: 2,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    });
    trace.recordToolCall({
      tool: 'repo_read',
      outcome: 'completed',
      durationMs: 1,
      responseBytes: 42,
      errorCode: null,
    });
    const stage = observeModelStage({
      stage: 'planning',
      route: 'primary',
      stageId: 'trace-stage-01',
      status: 'completed',
      durationMs: 8,
      errorCode: null,
      requests: [
        {
          durationMs: 5,
          usage: {
            modelCallCount: 1,
            inputTokens: 10,
            outputTokens: 2,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
        },
      ],
      pricing: { inputPerMillion: 1, outputPerMillion: 2, source: 'catalogue' },
      toolUsage: {
        toolCallCount: 1,
        listFilesCallCount: 0,
        readFileCallCount: 1,
        grepFilesCallCount: 0,
        successfulReadFileCallCount: 1,
        successfulGrepFilesCallCount: 0,
        rejectedCallCount: 0,
        returnedBytes: 42,
        budgetExhausted: false,
      },
      trace: trace.events(),
      cacheRoutingEnabled: false,
    });
    expect(stage.trace).toEqual([
      expect.objectContaining({
        ordinal: 1,
        kind: 'model-response',
        requestOrdinal: 1,
      }),
      expect.objectContaining({
        ordinal: 2,
        kind: 'tool-call',
        tool: 'repo_read',
      }),
    ]);
  });

  test('rejects retired discovery and refutation stage names from persisted telemetry', () => {
    const observation = {
      stageId: 'stage-01',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
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
        rejectedCallCount: 0,
        returnedBytes: 0,
        budgetExhausted: false,
      },
      cacheRoutingEnabled: false,
    };
    expect(
      ModelStageObservationSchema.safeParse({
        ...observation,
        stage: 'discovery',
      }).success,
    ).toBe(false);
    expect(
      ModelStageObservationSchema.safeParse({
        ...observation,
        stage: 'refutation',
      }).success,
    ).toBe(false);
  });
});
