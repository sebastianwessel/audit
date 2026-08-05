import { defineHarness, inMemorySandbox, type ModelProvider } from '@purista/harness';
import type { AttackPlan } from '../../src/features/attack-planning/plan.schema.js';
import {
  createModelStageTraceRecorder,
  createProviderUsageRecorder,
  type EvaluatorFailureDiagnosticSink,
  emptyToolUsage,
  type ModelCostCeiling,
  type ModelPricing,
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
import type { CorpusAnswerKey } from './corpus.schema.js';

import {
  bindPlanSemanticModelOutput,
  createPlanSemanticEvaluation,
  type PlanSemanticAdjudicationBinding,
} from './plan-semantic-adjudication.js';
import type { PlanSemanticEvaluatorOperation } from './plan-semantic-adjudication.schema.js';
import {
  createPlanSemanticModelInput,
  type PlanSemanticModelInput,
  PlanSemanticModelInputSchema,
  type PlanSemanticModelOutput,
  PlanSemanticModelOutputSchema,
} from './plan-semantic-agent.contract.js';
import { planSemanticAgentInstructions } from './plan-semantic-agent.instructions.js';
import { planSemanticStructuredOutputRegistry } from './structured-output-registry.js';

/**
 * Separate evaluator harness: it has no repository tools and is never used by
 * product planning or audit workflows. Its only model-visible data is the
 * generated plan and the evaluator-owned source-free scenario rubric.
 */
export function createPlanSemanticEvaluatorHarness(input: {
  provider: string;
  modelProvider: ModelProvider;
  modelName: string;
  execution: HarnessExecutionConfiguration;
  modelCacheRoutingKey?: string;
}) {
  assertLiveHarnessStructuredOutputCompatibility({
    provider: input.provider,
    registry: planSemanticStructuredOutputRegistry,
  });
  return defineHarness({ name: 'audit-plan-semantic-evaluator' })
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
      planSemanticReviewer: agent({
        model: 'evaluator',
        input: PlanSemanticModelInputSchema,
        output: PlanSemanticModelOutputSchema,
        builtinTools: false,
        tools: [],
        instructions: planSemanticAgentInstructions,
      }),
    }))
    .workflows(({ workflow }) => ({
      review_generated_plan_semantics: workflow({
        input: PlanSemanticModelInputSchema,
        output: PlanSemanticModelOutputSchema,
        delegation: {
          agents: ['planSemanticReviewer'],
          modelAliases: ['evaluator'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context): Promise<PlanSemanticModelOutput> =>
          context.agents.planSemanticReviewer(context.input),
      }),
    }))
    .build();
}

export async function reviewGeneratedPlanSemantics(input: {
  provider: string;
  modelProvider: ModelProvider;
  modelName: string;
  execution: HarnessExecutionConfiguration;
  request: PlanSemanticModelInput;
  sessionId: string;
  modelCacheRoutingKey?: string;
}): Promise<PlanSemanticModelOutput> {
  const harness = createPlanSemanticEvaluatorHarness(input);
  const session = await harness.getSession(input.sessionId);
  try {
    return await session.workflows.review_generated_plan_semantics.prompt(input.request);
  } finally {
    await session.close();
    await harness.shutdown();
  }
}

/** One evaluator-only operation; product planning and audit never call this. */
export async function evaluateGeneratedPlanSemantics(input: {
  provider: string;
  modelProvider: ModelProvider;
  modelName: string;
  execution: HarnessExecutionConfiguration;
  sessionId: string;
  binding: PlanSemanticAdjudicationBinding;
  plan: AttackPlan;
  answerKey: CorpusAnswerKey;
  reviewer: string;
  reviewedAt: string;
  modelPricing: ModelPricing;
  /** Optional shared run-wide observed-cost dispatch guard. */
  modelCostCeiling?: ModelCostCeiling;
  modelCacheRoutingKey?: string;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
}): Promise<PlanSemanticEvaluatorOperation> {
  const started = performance.now();
  const trace = createModelStageTraceRecorder({ pricing: input.modelPricing });
  const recorder = createProviderUsageRecorder(input.modelProvider, {
    ...(input.modelCostCeiling === undefined ? {} : { costCeiling: input.modelCostCeiling }),
    pricing: input.modelPricing,
    onResponse: trace.recordModelResponse,
  });
  try {
    const output = await reviewGeneratedPlanSemantics({
      provider: input.provider,
      modelProvider: recorder.provider,
      modelName: input.modelName,
      execution: input.execution,
      sessionId: input.sessionId,
      request: createPlanSemanticModelInput({ plan: input.plan, answerKey: input.answerKey }),
      ...(input.modelCacheRoutingKey === undefined
        ? {}
        : { modelCacheRoutingKey: input.modelCacheRoutingKey }),
    });
    const modelObservation = observeModelStage({
      stage: 'plan-semantic-adjudication',
      route: input.binding.reviewerRoute,
      stageId: `plan-semantic-${input.binding.trialId}`,
      status: 'completed',
      durationMs: performance.now() - started,
      errorCode: null,
      requests: recorder.requests(),
      pricing: input.modelPricing,
      toolUsage: emptyToolUsage(),
      trace: trace.events(),
      cacheRoutingEnabled: input.modelCacheRoutingKey !== undefined,
    });
    const adjudication = bindPlanSemanticModelOutput({
      output,
      binding: input.binding,
      plan: input.plan,
      answerKey: input.answerKey,
      reviewer: input.reviewer,
      reviewedAt: input.reviewedAt,
    });
    return {
      status: 'completed',
      evaluation: createPlanSemanticEvaluation({
        adjudication,
        binding: input.binding,
        plan: input.plan,
        answerKey: input.answerKey,
        modelObservation,
      }),
    };
  } catch (error) {
    const errorCode = stageErrorCode(error);
    const durationMs = performance.now() - started;
    const modelObservation = observeModelStage({
      stage: 'plan-semantic-adjudication',
      route: input.binding.reviewerRoute,
      stageId: `plan-semantic-${input.binding.trialId}`,
      status: 'failed',
      durationMs,
      errorCode,
      requests: recorder.requests(),
      pricing: input.modelPricing,
      toolUsage: emptyToolUsage(),
      trace: trace.events(),
      cacheRoutingEnabled: input.modelCacheRoutingKey !== undefined,
    });
    await writeEvaluatorFailureDiagnostic(input.evaluatorFailureDiagnosticSink, {
      stage: 'plan-semantic-adjudication',
      route: input.binding.reviewerRoute,
      stageId: `plan-semantic-${input.binding.trialId}`,
      attemptOrdinal: 1,
      durationMs,
      scopeFingerprint: input.plan.planDigest,
      errorCode,
      error,
    });
    if (errorCode === 'provider-cancelled') {
      return { status: 'cancelled', errorCode, modelObservation };
    }
    return { status: 'incomplete', errorCode, modelObservation };
  }
}
