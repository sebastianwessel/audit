import { z } from 'zod';

export const ModelUsageSchema = z
  .strictObject({
    modelCallCount: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    reasoningTokens: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (value.cachedInputTokens > value.inputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['cachedInputTokens'],
        message: 'cachedInputTokens must not exceed inputTokens.',
      });
    }
  });

export const ModelPricingSchema = z
  .strictObject({
    inputPerMillion: z.number().finite().nonnegative().optional(),
    cachedInputPerMillion: z.number().finite().nonnegative().optional(),
    outputPerMillion: z.number().finite().nonnegative().optional(),
    source: z.literal('catalogue').optional(),
  })
  .superRefine((value, context) => {
    const hasInput = value.inputPerMillion !== undefined;
    const hasOutput = value.outputPerMillion !== undefined;
    if (hasInput !== hasOutput) {
      context.addIssue({
        code: 'custom',
        message: 'inputPerMillion and outputPerMillion must be configured together.',
      });
    }
    if (hasInput && value.source !== 'catalogue') {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'Exact-model price rates must come from the bundled catalogue.',
      });
    }
    if (!hasInput && value.source !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['source'],
        message: 'A missing price must not declare a price source.',
      });
    }
    if (value.cachedInputPerMillion !== undefined && !hasInput) {
      context.addIssue({
        code: 'custom',
        path: ['cachedInputPerMillion'],
        message: 'cachedInputPerMillion requires inputPerMillion.',
      });
    }
  });

export const ModelCostSourceSchema = z.enum(['provider', 'catalogue', 'mixed', 'unavailable']);

export const ModelRouteSchema = z.enum(['primary', 'independent']);

export const ModelCostSummarySchema = z.strictObject({
  totalTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().finite().nonnegative().nullable(),
  source: ModelCostSourceSchema,
});

/** Operator-selected dispatch ceiling, never a model-price override. */
export const ModelCostCeilingUsdSchema = z.number().finite().positive().max(1_000_000);

/** Source-free state of one run-wide observed-cost dispatch guard. */
export const ModelCostCeilingStateSchema = z
  .strictObject({
    configuredUsd: ModelCostCeilingUsdSchema.nullable(),
    accumulatedEstimatedCostUsd: z.number().finite().nonnegative().nullable(),
    reached: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.configuredUsd === null) {
      if (value.accumulatedEstimatedCostUsd !== null || value.reached) {
        context.addIssue({
          code: 'custom',
          message: 'A disabled cost ceiling cannot have observed state.',
        });
      }
      return;
    }
    if (value.accumulatedEstimatedCostUsd === null) {
      context.addIssue({
        code: 'custom',
        path: ['accumulatedEstimatedCostUsd'],
        message: 'An enabled cost ceiling requires a known observed estimate.',
      });
    }
    if (
      value.reached &&
      (value.accumulatedEstimatedCostUsd === null ||
        value.accumulatedEstimatedCostUsd < value.configuredUsd)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reached'],
        message: 'A reached ceiling requires observed cost at or above the configured value.',
      });
    }
  });

/** One successful provider response. This never contains provider identifiers or content. */
export const ModelRequestObservationSchema = z
  .strictObject({
    ordinal: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
    usage: ModelUsageSchema,
    cost: ModelCostSummarySchema,
  })
  .superRefine((value, context) => {
    if (value.usage.modelCallCount !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['usage', 'modelCallCount'],
        message: 'A request observation must represent exactly one provider response.',
      });
    }
  });

export const ModelStageErrorCodeSchema = z.string().trim().min(1).max(64);

/**
 * Ordered, source-free control-flow telemetry from one model stage. It never
 * contains a prompt, source, tool arguments/results, provider request id, or
 * model response content.
 */
export const ModelStageTraceEventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ordinal: z.number().int().positive(),
    kind: z.literal('model-response'),
    requestOrdinal: z.number().int().positive(),
    durationMs: z.number().int().nonnegative(),
    usage: ModelUsageSchema,
    cost: ModelCostSummarySchema,
  }),
  z.strictObject({
    ordinal: z.number().int().positive(),
    kind: z.literal('tool-call'),
    tool: z.enum(['repo_list', 'repo_read', 'repo_grep']),
    outcome: z.enum(['completed', 'rejected']),
    durationMs: z.number().int().nonnegative(),
    responseBytes: z.number().int().nonnegative(),
    errorCode: ModelStageErrorCodeSchema.nullable(),
  }),
]);

/** Aggregate-only file-tool usage. It deliberately contains no target-derived text. */
export const ToolUsageSchema = z
  .strictObject({
    toolCallCount: z.number().int().nonnegative(),
    listFilesCallCount: z.number().int().nonnegative(),
    readFileCallCount: z.number().int().nonnegative(),
    grepFilesCallCount: z.number().int().nonnegative(),
    successfulReadFileCallCount: z.number().int().nonnegative(),
    successfulGrepFilesCallCount: z.number().int().nonnegative(),
    rejectedCallCount: z.number().int().nonnegative(),
    returnedBytes: z.number().int().nonnegative(),
    budgetExhausted: z.boolean(),
  })
  .superRefine((value, context) => {
    if (
      value.listFilesCallCount + value.readFileCallCount + value.grepFilesCallCount !==
      value.toolCallCount
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Tool-specific call counts must equal toolCallCount.',
      });
    }
    if (value.rejectedCallCount > value.toolCallCount) {
      context.addIssue({
        code: 'custom',
        path: ['rejectedCallCount'],
        message: 'rejectedCallCount must not exceed toolCallCount.',
      });
    }
    if (value.successfulReadFileCallCount > value.readFileCallCount) {
      context.addIssue({
        code: 'custom',
        path: ['successfulReadFileCallCount'],
        message: 'successfulReadFileCallCount must not exceed readFileCallCount.',
      });
    }
    if (value.successfulGrepFilesCallCount > value.grepFilesCallCount) {
      context.addIssue({
        code: 'custom',
        path: ['successfulGrepFilesCallCount'],
        message: 'successfulGrepFilesCallCount must not exceed grepFilesCallCount.',
      });
    }
  });

/** A content-free, independently retryable model-workflow boundary. */
export const ModelStageSchema = z.enum([
  'planning',
  'evidence-mapping',
  'source-posture',
  'investigation',
  'candidate-grounding',
  'verification',
  'countercheck',
]);

export const ModelStageIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9._:-]+$/u);

export const ModelStageObservationSchema = z
  .strictObject({
    stage: ModelStageSchema,
    route: ModelRouteSchema,
    stageId: ModelStageIdSchema,
    status: z.enum(['completed', 'failed']),
    durationMs: z.number().int().nonnegative(),
    errorCode: ModelStageErrorCodeSchema.nullable(),
    /** Content-free recoverable failures from attempts before this stage completed. */
    recoveredErrorCodes: z.array(ModelStageErrorCodeSchema).default([]),
    usage: ModelUsageSchema,
    cost: ModelCostSummarySchema,
    requests: z.array(ModelRequestObservationSchema).default([]),
    toolUsage: ToolUsageSchema,
    trace: z.array(ModelStageTraceEventSchema).default([]),
    cacheRoutingEnabled: z.boolean(),
  })
  .superRefine((value, context) => {
    const requestUsage = value.requests.reduce(
      (combined, request) => ({
        modelCallCount: combined.modelCallCount + request.usage.modelCallCount,
        inputTokens: combined.inputTokens + request.usage.inputTokens,
        outputTokens: combined.outputTokens + request.usage.outputTokens,
        cachedInputTokens: combined.cachedInputTokens + request.usage.cachedInputTokens,
        reasoningTokens: combined.reasoningTokens + request.usage.reasoningTokens,
      }),
      {
        modelCallCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    );
    if (
      requestUsage.modelCallCount !== value.usage.modelCallCount ||
      requestUsage.inputTokens !== value.usage.inputTokens ||
      requestUsage.outputTokens !== value.usage.outputTokens ||
      requestUsage.cachedInputTokens !== value.usage.cachedInputTokens ||
      requestUsage.reasoningTokens !== value.usage.reasoningTokens
    ) {
      context.addIssue({
        code: 'custom',
        path: ['usage'],
        message: 'Stage usage must equal the sum of request observations.',
      });
    }
    if (value.cost.totalTokens !== value.usage.inputTokens + value.usage.outputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['cost', 'totalTokens'],
        message: 'Stage cost totalTokens must equal stage input plus output tokens.',
      });
    }
    if (value.trace.length === 0) return;
    for (const [index, event] of value.trace.entries()) {
      if (event.ordinal !== index + 1) {
        context.addIssue({
          code: 'custom',
          path: ['trace', index, 'ordinal'],
          message: 'Trace event ordinals must be contiguous and start at one.',
        });
      }
    }
    const responseEvents = value.trace.filter((event) => event.kind === 'model-response');
    if (responseEvents.length !== value.requests.length) {
      context.addIssue({
        code: 'custom',
        path: ['trace'],
        message: 'Trace model responses must exactly represent request observations.',
      });
    }
    for (const [index, event] of responseEvents.entries()) {
      const request = value.requests[index];
      if (
        request === undefined ||
        event.requestOrdinal !== request.ordinal ||
        event.durationMs !== request.durationMs ||
        JSON.stringify(event.usage) !== JSON.stringify(request.usage) ||
        JSON.stringify(event.cost) !== JSON.stringify(request.cost)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['trace', event.ordinal - 1],
          message: 'Trace model response must match its request observation exactly.',
        });
      }
    }
    const toolEvents = value.trace.filter((event) => event.kind === 'tool-call');
    const byTool = (tool: 'repo_list' | 'repo_read' | 'repo_grep') =>
      toolEvents.filter((event) => event.tool === tool).length;
    if (
      toolEvents.length !== value.toolUsage.toolCallCount ||
      byTool('repo_list') !== value.toolUsage.listFilesCallCount ||
      byTool('repo_read') !== value.toolUsage.readFileCallCount ||
      byTool('repo_grep') !== value.toolUsage.grepFilesCallCount ||
      toolEvents.filter((event) => event.tool === 'repo_read' && event.outcome === 'completed')
        .length !== value.toolUsage.successfulReadFileCallCount ||
      toolEvents.filter((event) => event.tool === 'repo_grep' && event.outcome === 'completed')
        .length !== value.toolUsage.successfulGrepFilesCallCount ||
      toolEvents.filter((event) => event.outcome === 'rejected').length !==
        value.toolUsage.rejectedCallCount ||
      toolEvents.reduce((total, event) => total + event.responseBytes, 0) !==
        value.toolUsage.returnedBytes
    ) {
      context.addIssue({
        code: 'custom',
        path: ['trace'],
        message: 'Trace tool events must exactly represent aggregate tool usage.',
      });
    }
    for (const event of toolEvents) {
      if ((event.outcome === 'completed') !== (event.errorCode === null)) {
        context.addIssue({
          code: 'custom',
          path: ['trace', event.ordinal - 1],
          message: 'Completed tool calls have no error code and rejected calls require one.',
        });
      }
    }
  });

export const ModelRunObservationSchema = z.strictObject({
  usage: ModelUsageSchema,
  cost: ModelCostSummarySchema,
  toolUsage: ToolUsageSchema,
  cacheRoutingEnabled: z.boolean(),
  stages: z.array(ModelStageObservationSchema).default([]),
});

export type ModelUsage = z.infer<typeof ModelUsageSchema>;
export type ModelPricing = z.infer<typeof ModelPricingSchema>;
export type ModelCostSource = z.infer<typeof ModelCostSourceSchema>;
export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export type ModelCostSummary = z.infer<typeof ModelCostSummarySchema>;
export type ModelCostCeilingUsd = z.infer<typeof ModelCostCeilingUsdSchema>;
export type ModelCostCeilingState = z.infer<typeof ModelCostCeilingStateSchema>;
export type ModelRequestObservation = z.infer<typeof ModelRequestObservationSchema>;
export type ModelStageTraceEvent = z.infer<typeof ModelStageTraceEventSchema>;
export type ToolUsage = z.infer<typeof ToolUsageSchema>;
export type ModelStage = z.infer<typeof ModelStageSchema>;
export type ModelStageObservation = z.infer<typeof ModelStageObservationSchema>;
export type ModelRunObservation = z.infer<typeof ModelRunObservationSchema>;
