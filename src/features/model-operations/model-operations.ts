import {
  isHarnessError,
  type JsonValue,
  ModelError,
  type ModelProvider,
  type ObjectRequest,
  type ObjectResponse,
} from '@purista/harness';

import { createStableId } from '../../shared/contracts/core.js';
import type { OutputValidationRetryGuidance } from '../../shared/contracts/model-retry-guidance.js';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import { errorCauseChain } from '../../shared/errors/cause-chain.js';
import {
  type EvaluatorFailureDiagnostic,
  EvaluatorFailureDiagnosticSchema,
  type ModelCostCeilingState,
  ModelCostCeilingStateSchema,
  type ModelCostCeilingUsd,
  ModelCostCeilingUsdSchema,
  ModelCostSummarySchema,
  type ModelPricing,
  ModelPricingSchema,
  ModelRequestObservationSchema,
  type ModelRoute,
  type ModelRunObservation,
  ModelRunObservationSchema,
  type ModelStage,
  type ModelStageObservation,
  ModelStageObservationSchema,
  type ModelStageTraceEvent,
  ModelStageTraceEventSchema,
  type ModelUsage,
  ModelUsageSchema,
  type ToolUsage,
  ToolUsageSchema,
} from './model-operations.schema.js';

export type {
  EvaluatorFailureDiagnostic,
  ModelCostCeilingState,
  ModelCostCeilingUsd,
  ModelPricing,
  ModelRequestObservation,
  ModelRoute,
  ModelRunObservation,
  ModelStage,
  ModelStageObservation,
  ModelStageTraceEvent,
  ModelUsage,
  ToolUsage,
} from './model-operations.schema.js';

/**
 * Evaluator-only best-effort diagnostic port. Product code never supplies it,
 * and diagnostic persistence has no model-state projection.
 */
export type EvaluatorFailureDiagnosticSink = Readonly<{
  evaluationRunId: string;
  protocolFingerprint: string;
  now: () => string;
  write: (diagnostic: EvaluatorFailureDiagnostic) => Promise<void>;
}>;

/** Projects a caught error to the sole evaluator-private, content-free diagnostic shape. */
export function createEvaluatorFailureDiagnostic(input: {
  evaluationRunId: string;
  occurredAt: string;
  stage: ModelStage;
  route: ModelRoute;
  stageId: string;
  attemptOrdinal: number;
  durationMs: number;
  scopeFingerprint: string;
  protocolFingerprint: string;
  errorCode: string;
  validationRetryGuidance?: OutputValidationRetryGuidance;
  error: unknown;
}): EvaluatorFailureDiagnostic {
  const causes = errorCauseChain(input.error);
  const modelError = causes.find((cause): cause is ModelError => cause instanceof ModelError);
  const modelMeta = modelError?.meta;
  return EvaluatorFailureDiagnosticSchema.parse({
    schemaVersion: 2,
    diagnosticId: createStableId(
      'evaluator-failure',
      `${input.evaluationRunId}\0${input.stage}\0${input.stageId}\0${input.attemptOrdinal}\0${input.occurredAt}`,
    ),
    evaluationRunId: input.evaluationRunId,
    occurredAt: input.occurredAt,
    stage: input.stage,
    route: input.route,
    stageId: input.stageId,
    attemptOrdinal: input.attemptOrdinal,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    scopeFingerprint: input.scopeFingerprint,
    protocolFingerprint: input.protocolFingerprint,
    errorCode: input.errorCode,
    validationRetryGuidance: input.validationRetryGuidance ?? null,
    errorClass:
      modelError !== undefined
        ? 'model-error'
        : causes.some(isHarnessError)
          ? 'harness-error'
          : causes.some((cause) => cause instanceof AuditRuntimeError)
            ? 'application-error'
            : 'unknown-error',
    modelFailure:
      modelMeta === undefined
        ? null
        : {
            provider: modelMeta.provider,
            model: modelMeta.model,
            method: modelMeta.method,
            reason: modelMeta.reason ?? null,
            status: modelMeta.status ?? null,
            providerCode: modelMeta.providerCode ?? null,
          },
  });
}

/**
 * Retains a private failure record only when its opt-in storage succeeds.
 * A private destination that fails cannot guarantee a durable marker for its
 * own failure, and its status must never alter normal evaluation state.
 */
export async function writeEvaluatorFailureDiagnostic(
  sink: EvaluatorFailureDiagnosticSink | undefined,
  input: Omit<
    Parameters<typeof createEvaluatorFailureDiagnostic>[0],
    'evaluationRunId' | 'occurredAt' | 'protocolFingerprint'
  >,
): Promise<void> {
  if (sink === undefined) return;
  try {
    await sink.write(
      createEvaluatorFailureDiagnostic({
        ...input,
        evaluationRunId: sink.evaluationRunId,
        occurredAt: sink.now(),
        protocolFingerprint: sink.protocolFingerprint,
      }),
    );
  } catch {
    // Explicitly best effort: do not log or project diagnostic-write failures.
  }
}

export function emptyToolUsage(): ToolUsage {
  return ToolUsageSchema.parse({
    toolCallCount: 0,
    listFilesCallCount: 0,
    readFileCallCount: 0,
    grepFilesCallCount: 0,
    successfulReadFileCallCount: 0,
    successfulGrepFilesCallCount: 0,
    rejectedCallCount: 0,
    returnedBytes: 0,
  });
}

export type ProviderUsageRecorder = Readonly<{
  provider: ModelProvider;
  usage: () => ModelUsage;
  requests: () => readonly ProviderRequestUsage[];
}>;

export type ProviderRequestUsage = Readonly<{
  durationMs: number;
  usage: ModelUsage;
}>;

export type ModelStageTraceRecorder = Readonly<{
  recordModelResponse: (request: ProviderRequestUsage) => void;
  recordToolCall: (input: {
    tool: 'repo_list' | 'repo_read' | 'repo_grep';
    outcome: 'completed' | 'rejected';
    durationMs: number;
    responseBytes: number;
    errorCode: string | null;
  }) => void;
  events: () => readonly ModelStageTraceEvent[];
}>;

export type ModelCostCeiling = Readonly<{
  beforeRequest: () => void;
  recordResponse: (usage: ModelUsage, pricing: ModelPricing) => void;
  /** Registers exact persisted stage observations recovered after process interruption. */
  recordPriorStages: (stages: readonly ModelStageObservation[]) => void;
  state: () => ModelCostCeilingState;
}>;

/** Captures numeric provider usage without retaining request or response content. */
export function createProviderUsageRecorder(
  provider: ModelProvider,
  options: Readonly<{
    costCeiling?: ModelCostCeiling;
    pricing?: ModelPricing;
    onResponse?: (request: ProviderRequestUsage) => void;
  }> = {},
): ProviderUsageRecorder {
  let modelCallCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  const requests: ProviderRequestUsage[] = [];
  const text = provider.text?.bind(provider);
  const object = provider.object?.bind(provider);

  const record = (
    durationMs: number,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cachedInputTokens?: number;
      reasoningTokens?: number;
    },
  ): void => {
    modelCallCount += 1;
    inputTokens += usage.inputTokens;
    outputTokens += usage.outputTokens;
    cachedInputTokens += usage.cachedInputTokens ?? 0;
    reasoningTokens += usage.reasoningTokens ?? 0;
    const request = {
      durationMs: Math.round(durationMs),
      usage: ModelUsageSchema.parse({
        modelCallCount: 1,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens ?? 0,
        reasoningTokens: usage.reasoningTokens ?? 0,
      }),
    };
    requests.push(request);
    options.onResponse?.(request);
  };
  const wrapped: ModelProvider = {
    ...provider,
    id: provider.id,
    genAiSystem: provider.genAiSystem,
    ...(provider.info === undefined ? {} : { info: provider.info }),
    ...(text === undefined
      ? {}
      : {
          text: async (request) => {
            options.costCeiling?.beforeRequest();
            const started = performance.now();
            const response = await text(request);
            record(performance.now() - started, response.usage);
            recordCostCeiling(options, response.usage);
            return response;
          },
        }),
    ...(object === undefined
      ? {}
      : {
          object: async <T extends JsonValue = JsonValue>(
            request: ObjectRequest<T>,
          ): Promise<ObjectResponse<T>> => {
            options.costCeiling?.beforeRequest();
            const started = performance.now();
            const response = await object(request);
            record(performance.now() - started, response.usage);
            recordCostCeiling(options, response.usage);
            return response;
          },
        }),
    ...(provider.textStream === undefined
      ? {}
      : { textStream: provider.textStream.bind(provider) }),
    ...(provider.objectStream === undefined
      ? {}
      : { objectStream: provider.objectStream.bind(provider) }),
    ...(provider.embed === undefined ? {} : { embed: provider.embed.bind(provider) }),
    ...(provider.rerank === undefined ? {} : { rerank: provider.rerank.bind(provider) }),
    ...(provider.close === undefined ? {} : { close: provider.close.bind(provider) }),
  };
  return Object.freeze({
    provider: wrapped,
    usage: () =>
      ModelUsageSchema.parse({
        modelCallCount,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningTokens,
      }),
    requests: () => requests.map((request) => ({ ...request, usage: { ...request.usage } })),
  });
}

/** Records complete model/tool control flow without retaining target or model content. */
export function createModelStageTraceRecorder(input: {
  pricing: ModelPricing;
}): ModelStageTraceRecorder {
  const events: ModelStageTraceEvent[] = [];
  let requestOrdinal = 0;
  const nextOrdinal = () => events.length + 1;
  return Object.freeze({
    recordModelResponse: (request) => {
      requestOrdinal += 1;
      events.push(
        ModelStageTraceEventSchema.parse({
          ordinal: nextOrdinal(),
          kind: 'model-response',
          requestOrdinal,
          durationMs: request.durationMs,
          usage: request.usage,
          cost: summarizeModelCost(request.usage, input.pricing),
        }),
      );
    },
    recordToolCall: (event) => {
      events.push(
        ModelStageTraceEventSchema.parse({
          ordinal: nextOrdinal(),
          kind: 'tool-call',
          ...event,
        }),
      );
    },
    events: () => events.map((event) => ({ ...event })),
  });
}

/**
 * Builds the shared observed-cost dispatch guard for a plan or audit run.
 * Provider usage arrives only after a response, so a crossing response is
 * retained and only later requests are stopped.
 */
export function createModelCostCeiling(input: {
  configuredUsd: ModelCostCeilingUsd;
  pricing: ModelPricing;
  priorStages?: readonly ModelStageObservation[];
}): ModelCostCeiling {
  const configuredUsd = ModelCostCeilingUsdSchema.parse(input.configuredUsd);
  if (summarizeModelCost(emptyModelUsage(), input.pricing).estimatedCostUsd === null) {
    throw costUnavailable();
  }
  const knownStages = new Set<string>();
  let accumulated = 0;
  const recordPriorStages = (stages: readonly ModelStageObservation[]): void => {
    for (const stage of stages) {
      const parsed = ModelStageObservationSchema.parse(stage);
      const identity = JSON.stringify(parsed);
      if (knownStages.has(identity)) continue;
      if (parsed.cost.estimatedCostUsd === null) throw costUnavailable();
      knownStages.add(identity);
      accumulated = roundUsd(accumulated + parsed.cost.estimatedCostUsd);
    }
  };
  recordPriorStages(input.priorStages ?? []);
  return Object.freeze({
    beforeRequest: () => {
      if (accumulated >= configuredUsd) {
        throw new AuditRuntimeError(
          'model-cost-ceiling-reached',
          'The observed model-cost ceiling was reached before another request could start.',
        );
      }
    },
    recordResponse: (usage, pricing) => {
      const cost = summarizeModelCost(usage, pricing);
      if (cost.estimatedCostUsd === null) throw costUnavailable();
      accumulated = roundUsd(accumulated + cost.estimatedCostUsd);
    },
    recordPriorStages,
    state: () =>
      ModelCostCeilingStateSchema.parse({
        configuredUsd,
        accumulatedEstimatedCostUsd: accumulated,
        reached: accumulated >= configuredUsd,
      }),
  });
}

function emptyModelUsage(): ModelUsage {
  return ModelUsageSchema.parse({
    modelCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  });
}

function recordCostCeiling(
  options: Readonly<{ costCeiling?: ModelCostCeiling; pricing?: ModelPricing }>,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
  },
): void {
  if (options.costCeiling === undefined) return;
  if (options.pricing === undefined) throw costUnavailable();
  options.costCeiling.recordResponse(
    ModelUsageSchema.parse({
      modelCallCount: 1,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens ?? 0,
      reasoningTokens: usage.reasoningTokens ?? 0,
    }),
    options.pricing,
  );
}

function costUnavailable(): AuditRuntimeError {
  return new AuditRuntimeError(
    'model-cost-unavailable',
    'A model-cost ceiling requires known exact-model catalogue pricing.',
  );
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function summarizeModelCost(usage: ModelUsage, pricing: ModelPricing) {
  const parsedUsage = ModelUsageSchema.parse(usage);
  const parsedPricing = ModelPricingSchema.parse(pricing);
  const totalTokens = parsedUsage.inputTokens + parsedUsage.outputTokens;
  if (parsedPricing.inputPerMillion === undefined || parsedPricing.outputPerMillion === undefined) {
    return ModelCostSummarySchema.parse({
      totalTokens,
      estimatedCostUsd: null,
      source: 'unavailable',
    });
  }
  const cachedRate = parsedPricing.cachedInputPerMillion ?? parsedPricing.inputPerMillion;
  const cost =
    ((parsedUsage.inputTokens - parsedUsage.cachedInputTokens) / 1_000_000) *
      parsedPricing.inputPerMillion +
    (parsedUsage.cachedInputTokens / 1_000_000) * cachedRate +
    (parsedUsage.outputTokens / 1_000_000) * parsedPricing.outputPerMillion;
  return ModelCostSummarySchema.parse({
    totalTokens,
    estimatedCostUsd: Math.round(cost * 1_000_000) / 1_000_000,
    source: 'catalogue',
  });
}

export function observeModelRun(input: {
  usage: ModelUsage;
  pricing: ModelPricing;
  cacheRoutingEnabled: boolean;
  toolUsage?: ToolUsage;
  stages?: readonly ModelStageObservation[];
}): ModelRunObservation {
  return ModelRunObservationSchema.parse({
    usage: input.usage,
    cost: summarizeModelCost(input.usage, input.pricing),
    toolUsage: input.toolUsage ?? emptyToolUsage(),
    cacheRoutingEnabled: input.cacheRoutingEnabled,
    stages: input.stages ?? [],
  });
}

export function observeModelStage(input: {
  stage: ModelStageObservation['stage'];
  route: ModelRoute;
  stageId: string;
  status: ModelStageObservation['status'];
  durationMs: number;
  errorCode: string | null;
  recoveredErrorCodes?: readonly string[];
  requests: readonly ProviderRequestUsage[];
  pricing: ModelPricing;
  toolUsage?: ToolUsage;
  trace?: readonly ModelStageTraceEvent[];
  cacheRoutingEnabled: boolean;
}): ModelStageObservation {
  const requests = input.requests.map((request, index) =>
    ModelRequestObservationSchema.parse({
      ordinal: index + 1,
      durationMs: Math.round(request.durationMs),
      usage: request.usage,
      cost: summarizeModelCost(request.usage, input.pricing),
    }),
  );
  const usage = combineModelUsage(requests.map((request) => request.usage));
  return ModelStageObservationSchema.parse({
    stage: input.stage,
    route: input.route,
    stageId: input.stageId,
    status: input.status,
    durationMs: Math.round(input.durationMs),
    errorCode: input.errorCode,
    recoveredErrorCodes: input.recoveredErrorCodes ?? [],
    usage,
    cost: summarizeModelCost(usage, input.pricing),
    requests,
    toolUsage: input.toolUsage ?? emptyToolUsage(),
    trace: input.trace ?? [],
    cacheRoutingEnabled: input.cacheRoutingEnabled,
  });
}

/**
 * Joins repeated attempts of one exact stage without discarding any request,
 * tool operation, cost state, or trace. This is for durable resume artifacts,
 * not for combining distinct stages or routes.
 */
export function mergeModelStageObservations(
  observations: readonly ModelStageObservation[],
): ModelStageObservation {
  const stages = observations.map((observation) => ModelStageObservationSchema.parse(observation));
  const first = stages[0];
  if (first === undefined) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A merged model-stage observation requires at least one source-free stage observation.',
    );
  }
  if (
    stages.some(
      (stage) =>
        stage.stage !== first.stage ||
        stage.route !== first.route ||
        stage.cacheRoutingEnabled !== first.cacheRoutingEnabled,
    )
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'Only observations for one model stage, route, and cache mode may be merged.',
    );
  }
  const requests = stages
    .flatMap((stage) => stage.requests)
    .map((request, index) => ({
      ...request,
      ordinal: index + 1,
    }));
  const trace = stages.every((stage) => stage.trace.length > 0) ? mergeStageTraces(stages) : [];
  const usage = combineModelUsage(requests.map((request) => request.usage));
  return ModelStageObservationSchema.parse({
    stage: first.stage,
    route: first.route,
    stageId: first.stageId,
    status: stages.every((stage) => stage.status === 'completed') ? 'completed' : 'failed',
    durationMs: stages.reduce((total, stage) => total + stage.durationMs, 0),
    errorCode: stages.every((stage) => stage.status === 'completed')
      ? null
      : (stages.find((stage) => stage.errorCode !== null)?.errorCode ?? 'provider-failure'),
    recoveredErrorCodes: uniqueSorted(stages.flatMap((stage) => stage.recoveredErrorCodes)),
    usage,
    cost: summarizeStageCosts(stages, usage),
    requests,
    toolUsage: combineToolUsage(stages.map((stage) => stage.toolUsage)),
    trace,
    cacheRoutingEnabled: first.cacheRoutingEnabled,
  });
}

/** Derives a run total exclusively from the independently recorded stages. */
export function summarizeModelStages(
  stages: readonly ModelStageObservation[],
  pricing: ModelPricing,
): ModelRunObservation {
  const parsedStages = stages.map((stage) => ModelStageObservationSchema.parse(stage));
  const usage = combineModelUsage(parsedStages.map((stage) => stage.usage));
  const toolUsage = combineToolUsage(parsedStages.map((stage) => stage.toolUsage));
  const observation = observeModelRun({
    usage,
    pricing,
    toolUsage,
    cacheRoutingEnabled:
      parsedStages.length > 0 && parsedStages.every((stage) => stage.cacheRoutingEnabled),
    stages: parsedStages,
  });
  if (parsedStages.length === 0) return observation;
  return ModelRunObservationSchema.parse({
    ...observation,
    cost: summarizeStageCosts(parsedStages, usage),
  });
}

function summarizeStageCosts(stages: readonly ModelStageObservation[], usage: ModelUsage) {
  const totalTokens = usage.inputTokens + usage.outputTokens;
  if (stages.some((stage) => stage.cost.estimatedCostUsd === null)) {
    return ModelCostSummarySchema.parse({
      totalTokens,
      estimatedCostUsd: null,
      source: 'unavailable',
    });
  }
  const sources = new Set(stages.map((stage) => stage.cost.source));
  const source = sources.size > 1 ? 'mixed' : sources.has('catalogue') ? 'catalogue' : 'provider';
  return ModelCostSummarySchema.parse({
    totalTokens,
    estimatedCostUsd:
      Math.round(
        stages.reduce((total, stage) => total + (stage.cost.estimatedCostUsd ?? 0), 0) * 1_000_000,
      ) / 1_000_000,
    source,
  });
}

function mergeStageTraces(
  stages: readonly ModelStageObservation[],
): readonly ModelStageTraceEvent[] {
  let ordinal = 0;
  let requestOrdinal = 0;
  return stages.flatMap((stage) =>
    stage.trace.map((event) => {
      ordinal += 1;
      if (event.kind === 'model-response') {
        requestOrdinal += 1;
        return { ...event, ordinal, requestOrdinal };
      }
      return { ...event, ordinal };
    }),
  );
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function combineToolUsage(usages: readonly ToolUsage[]): ToolUsage {
  return ToolUsageSchema.parse(
    usages.reduce(
      (combined, usage) => ({
        toolCallCount: combined.toolCallCount + usage.toolCallCount,
        listFilesCallCount: combined.listFilesCallCount + usage.listFilesCallCount,
        readFileCallCount: combined.readFileCallCount + usage.readFileCallCount,
        grepFilesCallCount: combined.grepFilesCallCount + usage.grepFilesCallCount,
        successfulReadFileCallCount:
          combined.successfulReadFileCallCount + usage.successfulReadFileCallCount,
        successfulGrepFilesCallCount:
          combined.successfulGrepFilesCallCount + usage.successfulGrepFilesCallCount,
        rejectedCallCount: combined.rejectedCallCount + usage.rejectedCallCount,
        returnedBytes: combined.returnedBytes + usage.returnedBytes,
      }),
      emptyToolUsage(),
    ),
  );
}

/** True only when a scoped source read or search returned a result to the model. */
export function hasSuccessfulScopedSourceInspection(usage: ToolUsage): boolean {
  return usage.successfulReadFileCallCount + usage.successfulGrepFilesCallCount > 0;
}

export function combineModelUsage(usages: readonly ModelUsage[]): ModelUsage {
  return ModelUsageSchema.parse(
    usages.reduce(
      (combined, usage) => ({
        modelCallCount: combined.modelCallCount + usage.modelCallCount,
        inputTokens: combined.inputTokens + usage.inputTokens,
        outputTokens: combined.outputTokens + usage.outputTokens,
        cachedInputTokens: combined.cachedInputTokens + usage.cachedInputTokens,
        reasoningTokens: combined.reasoningTokens + usage.reasoningTokens,
      }),
      {
        modelCallCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    ),
  );
}
