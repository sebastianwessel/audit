import { z } from 'zod';

import { StageIsolatedEvaluationStagePublicResultSchema } from './stage-isolated.schema.js';

/** Same-route comparisons retain the primary route; experiments may vary only its provider/model. */
export const StageIsolatedComparisonKindSchema = z.enum([
  'same-stage-regression',
  'same-stage-model-experiment',
]);

/**
 * The input accepts only source-free v4 public stage artifacts. Normal
 * evaluation-run artifacts have a different closed shape and cannot enter this
 * comparison boundary.
 */
export const StageIsolatedEvaluationComparisonInputSchema = z.strictObject({
  comparisonKind: StageIsolatedComparisonKindSchema,
  baseline: StageIsolatedEvaluationStagePublicResultSchema,
  candidate: StageIsolatedEvaluationStagePublicResultSchema,
});

/** Stable, field-level rejection tokens. They contain no source or artifact identity values. */
export const StageIsolatedComparisonMismatchTokenSchema = z.enum([
  'stage',
  'plan-profile',
  'corpus-pack-id',
  'corpus-pack-version',
  'corpus-manifest-fingerprint',
  'corpus-source-digest',
  'target-fingerprint',
  'context-digest',
  'selected-trial',
  'workflow-protocol-fingerprint',
  'stage-protocol-fingerprint',
  'evaluator-protocol-fingerprint',
  'evaluator-provider',
  'evaluator-model',
  'evaluator-route',
  'expected-outcome-denominator',
  'route',
  'primary-route-required',
  'primary-provider',
  'primary-model',
]);

export const StageIsolatedComparisonMetricSchema = z
  .strictObject({
    baseline: z.number().finite().nullable(),
    candidate: z.number().finite().nullable(),
    delta: z.number().finite().nullable(),
  })
  .superRefine((metric, context) => {
    if (metric.baseline === null || metric.candidate === null) {
      if (metric.delta !== null) {
        context.addIssue({
          code: 'custom',
          path: ['delta'],
          message: 'A metric with an unavailable input cannot report a delta.',
        });
      }
      return;
    }
    if (metric.delta !== metric.candidate - metric.baseline) {
      context.addIssue({
        code: 'custom',
        path: ['delta'],
        message: 'A metric delta must equal candidate minus baseline.',
      });
    }
  });

const CountMetricSchema = z
  .strictObject({
    baseline: z.int().nonnegative(),
    candidate: z.int().nonnegative(),
    delta: z.int(),
  })
  .superRefine((metric, context) => {
    if (metric.delta !== metric.candidate - metric.baseline) {
      context.addIssue({
        code: 'custom',
        path: ['delta'],
        message: 'A count delta must equal candidate minus baseline.',
      });
    }
  });

export const StageIsolatedEvaluationComparisonDeltasSchema = z.strictObject({
  completion: z.strictObject({
    completed: CountMetricSchema,
    incomplete: CountMetricSchema,
    failed: CountMetricSchema,
    cancelled: CountMetricSchema,
  }),
  validation: z.strictObject({
    inputErrorCodeCount: CountMetricSchema,
    outputErrorCodeCount: CountMetricSchema,
  }),
  semanticOutcome: z.strictObject({
    expectedOutcomeCount: CountMetricSchema,
    matchedExpectedOutcomeCount: CountMetricSchema,
    missingExpectedOutcomeCount: CountMetricSchema,
    notApplicableExpectedOutcomeCount: CountMetricSchema,
    unexpectedOutcomeCount: CountMetricSchema,
  }),
  localization: z.strictObject({
    matchedExpectedOutcomeWithRoleBundleCount: CountMetricSchema,
    roleBundleCount: CountMetricSchema,
    roleCount: CountMetricSchema,
    locationCount: CountMetricSchema,
  }),
  toolInspection: z.strictObject({
    scopedManifestEntryCount: CountMetricSchema,
    toolCallCount: CountMetricSchema,
    listFilesCallCount: CountMetricSchema,
    readFileCallCount: CountMetricSchema,
    grepFilesCallCount: CountMetricSchema,
    successfulReadFileCallCount: CountMetricSchema,
    successfulGrepFilesCallCount: CountMetricSchema,
    rejectedCallCount: CountMetricSchema,
    returnedBytes: CountMetricSchema,
  }),
  telemetry: z.strictObject({
    latencyMs: CountMetricSchema,
    modelCallCount: CountMetricSchema,
    inputTokens: CountMetricSchema,
    cachedInputTokens: CountMetricSchema,
    outputTokens: CountMetricSchema,
    reasoningTokens: CountMetricSchema,
    totalTokens: CountMetricSchema,
    estimatedCostUsd: StageIsolatedComparisonMetricSchema,
  }),
});

/**
 * A deliberately minimal, source-free comparison result. The token list is
 * exhaustive when artifacts are incompatible; numeric deltas are withheld.
 */
export const StageIsolatedEvaluationComparisonSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    comparable: z.boolean(),
    mismatchTokens: z.array(StageIsolatedComparisonMismatchTokenSchema),
    deltas: StageIsolatedEvaluationComparisonDeltasSchema.nullable(),
  })
  .superRefine((comparison, context) => {
    if (
      comparison.comparable &&
      (comparison.mismatchTokens.length > 0 || comparison.deltas === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Comparable artifacts require no mismatch tokens and complete deltas.',
      });
    }
    if (
      !comparison.comparable &&
      (comparison.mismatchTokens.length === 0 || comparison.deltas !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Incompatible artifacts require mismatch tokens and withhold deltas.',
      });
    }
    if (new Set(comparison.mismatchTokens).size !== comparison.mismatchTokens.length) {
      context.addIssue({
        code: 'custom',
        path: ['mismatchTokens'],
        message: 'Comparison mismatch tokens must be unique.',
      });
    }
  });

export type StageIsolatedComparisonKind = z.infer<typeof StageIsolatedComparisonKindSchema>;
export type StageIsolatedEvaluationComparisonInput = z.infer<
  typeof StageIsolatedEvaluationComparisonInputSchema
>;
export type StageIsolatedComparisonMismatchToken = z.infer<
  typeof StageIsolatedComparisonMismatchTokenSchema
>;
export type StageIsolatedComparisonMetric = z.infer<typeof StageIsolatedComparisonMetricSchema>;
export type StageIsolatedEvaluationComparisonDeltas = z.infer<
  typeof StageIsolatedEvaluationComparisonDeltasSchema
>;
export type StageIsolatedEvaluationComparison = z.infer<
  typeof StageIsolatedEvaluationComparisonSchema
>;
