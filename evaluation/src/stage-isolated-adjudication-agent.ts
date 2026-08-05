import { defineHarness, inMemorySandbox, type ModelProvider } from '@purista/harness';
import {
  createModelStageTraceRecorder,
  createProviderUsageRecorder,
  type EvaluatorFailureDiagnosticSink,
  emptyToolUsage,
  type ModelPricing,
  type ModelRoute,
  type ModelStageObservation,
  observeModelStage,
  writeEvaluatorFailureDiagnostic,
} from '../../src/features/model-operations/model-operations.js';
import { stageErrorCode } from '../../src/features/review-workflow/runtime/invocation.js';
import {
  assertLiveHarnessStructuredOutputCompatibility,
  type HarnessExecutionConfiguration,
  harnessProviderRetry,
} from '../../src/platform/harness/audit-harness.js';
import { NoContentLogger } from '../../src/platform/harness/no-content-logger.js';

import {
  type StageIsolatedAdjudicationModelInput,
  StageIsolatedAdjudicationModelInputSchema,
  type StageIsolatedAdjudicationModelOutput,
  StageIsolatedAdjudicationModelOutputSchema,
} from './stage-isolated-adjudication-agent.contract.js';
import { stageIsolatedAdjudicationAgentInstructions } from './stage-isolated-adjudication-agent.instructions.js';
import { stageIsolatedStructuredOutputRegistry } from './structured-output-registry.js';

/**
 * Evaluator-only semantic adjudicator. It owns no product tools, filesystem,
 * state, or persistence; callers retain the in-memory packet and validate the
 * response before projecting any source-free measurement artifact.
 */
export function createStageIsolatedAdjudicationHarness(input: {
  provider: string;
  modelProvider: ModelProvider;
  modelName: string;
  execution: HarnessExecutionConfiguration;
  modelCacheRoutingKey?: string;
}) {
  assertLiveHarnessStructuredOutputCompatibility({
    provider: input.provider,
    registry: stageIsolatedStructuredOutputRegistry,
  });
  return defineHarness({ name: 'audit-stage-isolated-adjudicator' })
    .logger(new NoContentLogger())
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .sandbox(inMemorySandbox())
    .defaults({
      agentMaxIterations: Number.POSITIVE_INFINITY,
      maxParallelToolCalls: 1,
      runTimeoutMs: input.execution.runTimeoutMs,
      modelTimeoutMs: input.execution.modelTimeoutMs,
      toolTimeoutMs: 0,
    })
    .models({
      evaluator: {
        provider: input.modelProvider,
        model: input.modelName,
        capabilities: ['object'],
        retry: harnessProviderRetry(input.execution.modelRetry),
        ...(input.modelCacheRoutingKey === undefined
          ? {}
          : { defaults: { providerOptions: { prompt_cache_key: input.modelCacheRoutingKey } } }),
      },
    })
    .agents(({ agent }) => ({
      stageAdjudicator: agent({
        model: 'evaluator',
        input: StageIsolatedAdjudicationModelInputSchema,
        output: StageIsolatedAdjudicationModelOutputSchema,
        builtinTools: false,
        tools: [],
        instructions: stageIsolatedAdjudicationAgentInstructions,
      }),
    }))
    .workflows(({ workflow }) => ({
      adjudicate_isolated_stage: workflow({
        input: StageIsolatedAdjudicationModelInputSchema,
        output: StageIsolatedAdjudicationModelOutputSchema,
        delegation: {
          agents: ['stageAdjudicator'],
          modelAliases: ['evaluator'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context): Promise<StageIsolatedAdjudicationModelOutput> =>
          context.agents.stageAdjudicator(context.input),
      }),
    }))
    .build();
}

export async function adjudicateIsolatedStage(input: {
  provider: string;
  modelProvider: ModelProvider;
  modelName: string;
  execution: HarnessExecutionConfiguration;
  sessionId: string;
  request: StageIsolatedAdjudicationModelInput;
  route: ModelRoute;
  stageId: string;
  modelPricing: ModelPricing;
  cacheRoutingEnabled: boolean;
  modelCacheRoutingKey?: string;
  scopeFingerprint: string;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
}): Promise<
  | Readonly<{
      status: 'completed';
      output: StageIsolatedAdjudicationModelOutput;
      modelObservation: ModelStageObservation;
    }>
  | Readonly<{
      status: 'failed';
      errorCode: string;
      modelObservation: ModelStageObservation;
    }>
> {
  const started = performance.now();
  const trace = createModelStageTraceRecorder({ pricing: input.modelPricing });
  const recorder = createProviderUsageRecorder(input.modelProvider, {
    pricing: input.modelPricing,
    onResponse: trace.recordModelResponse,
  });
  const harness = createStageIsolatedAdjudicationHarness({
    ...input,
    modelProvider: recorder.provider,
  });
  const session = await harness.getSession(input.sessionId);
  try {
    const output = await session.workflows.adjudicate_isolated_stage.prompt(input.request);
    return {
      status: 'completed',
      output,
      modelObservation: observeModelStage({
        // Stage-isolated semantic adjudication is evaluator-only and retains
        // its own observation field. The shared model-operation vocabulary
        // names this generic evaluator operation without treating it as plan
        // quality or a product workflow stage.
        stage: 'plan-semantic-adjudication',
        route: input.route,
        stageId: input.stageId,
        status: 'completed',
        durationMs: performance.now() - started,
        errorCode: null,
        requests: recorder.requests(),
        pricing: input.modelPricing,
        toolUsage: emptyToolUsage(),
        trace: trace.events(),
        cacheRoutingEnabled: input.cacheRoutingEnabled,
      }),
    };
  } catch (error) {
    const errorCode = stageErrorCode(error);
    const durationMs = performance.now() - started;
    const modelObservation = observeModelStage({
      stage: 'plan-semantic-adjudication',
      route: input.route,
      stageId: input.stageId,
      status: 'failed',
      durationMs,
      errorCode,
      requests: recorder.requests(),
      pricing: input.modelPricing,
      toolUsage: emptyToolUsage(),
      trace: trace.events(),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    await writeEvaluatorFailureDiagnostic(input.evaluatorFailureDiagnosticSink, {
      stage: 'plan-semantic-adjudication',
      route: input.route,
      stageId: input.stageId,
      attemptOrdinal: 1,
      durationMs,
      scopeFingerprint: input.scopeFingerprint,
      errorCode,
      error,
    });
    return {
      status: 'failed',
      errorCode,
      modelObservation,
    };
  } finally {
    await session.close();
    await harness.shutdown();
  }
}
