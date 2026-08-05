import { z } from 'zod';
import {
  ModelCostSourceSchema,
  ModelRouteSchema,
  ModelStageSchema,
} from '../../src/features/model-operations/model-operations.schema.js';
import { MaxParallelVectorsSchema } from '../../src/platform/configuration/environment.js';
import { IdentifierSchema, Sha256Schema } from '../../src/shared/contracts/core.js';
import {
  ModelIdentifierSchema,
  ModelProviderIdentifierSchema,
} from '../../src/shared/contracts/model-identity.js';

import {
  CorpusSplitSchema,
  FindingCoverageClassSchema,
  PlanEvaluationProfileSchema,
} from './corpus.schema.js';
import { SemanticPlanEvaluatorIdentitySchema } from './plan-semantic-identity.schema.js';

export const EvaluationComparisonIdentitySchema = z.strictObject({
  runId: IdentifierSchema,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  corpusManifestDigest: Sha256Schema,
  populationDigest: Sha256Schema,
  benchmarkProtocolFingerprint: Sha256Schema,
  primaryModelExperimentFingerprint: Sha256Schema,
  mode: z.enum(['deterministic', 'provider']),
  provider: ModelProviderIdentifierSchema,
  model: ModelIdentifierSchema,
  verificationMode: z.enum(['same-route', 'independent-route']),
  verificationRouteFingerprint: Sha256Schema,
  selectedSplit: CorpusSplitSchema,
  caseIdFilter: IdentifierSchema.nullable(),
  findingCoverage: FindingCoverageClassSchema,
  repetitions: z.number().int().positive(),
  planProfile: PlanEvaluationProfileSchema,
  semanticPlanEvaluator: SemanticPlanEvaluatorIdentitySchema.nullable(),
  executionBudgetFingerprint: Sha256Schema,
  maxParallelVectors: MaxParallelVectorsSchema,
  promptProtocolFingerprint: Sha256Schema,
  holdoutAttestationFingerprint: Sha256Schema.nullable(),
  costSource: ModelCostSourceSchema.nullable(),
});

/** Ordinary regressions require identical routes; experiments may vary only the sole primary route. */
export const EvaluationComparisonKindSchema = z.enum([
  'same-route-regression',
  'primary-model-experiment',
]);

export const EvaluationComparisonMetricSchema = z.strictObject({
  baseline: z.number().finite().nullable(),
  candidate: z.number().finite().nullable(),
  delta: z.number().finite().nullable(),
});

export const EvaluationComparisonMetricsSchema = z.strictObject({
  completionRate: EvaluationComparisonMetricSchema,
  semanticEvaluatorCompletionRate: EvaluationComparisonMetricSchema,
  semanticScenarioRecall: EvaluationComparisonMetricSchema,
  semanticRelevantVectorPrecision: EvaluationComparisonMetricSchema,
  semanticUnrelatedVectorCount: EvaluationComparisonMetricSchema,
  findingJaccard: EvaluationComparisonMetricSchema,
  findingRecallMedian: EvaluationComparisonMetricSchema,
  allTerminalDurationMsP95: EvaluationComparisonMetricSchema,
  truePositives: EvaluationComparisonMetricSchema,
  adjudicatedFalsePositives: EvaluationComparisonMetricSchema,
  unadjudicatedFindings: EvaluationComparisonMetricSchema,
  falseNegatives: EvaluationComparisonMetricSchema,
  modelCalls: EvaluationComparisonMetricSchema,
  inputTokens: EvaluationComparisonMetricSchema,
  cachedInputTokens: EvaluationComparisonMetricSchema,
  outputTokens: EvaluationComparisonMetricSchema,
  reasoningTokens: EvaluationComparisonMetricSchema,
  toolCalls: EvaluationComparisonMetricSchema,
  returnedBytes: EvaluationComparisonMetricSchema,
  estimatedCostUsd: EvaluationComparisonMetricSchema,
});

export const EvaluationStageComparisonSchema = z.strictObject({
  stage: ModelStageSchema,
  route: ModelRouteSchema,
  modelCalls: EvaluationComparisonMetricSchema,
  inputTokens: EvaluationComparisonMetricSchema,
  outputTokens: EvaluationComparisonMetricSchema,
  toolCalls: EvaluationComparisonMetricSchema,
  durationMs: EvaluationComparisonMetricSchema,
  estimatedCostUsd: EvaluationComparisonMetricSchema,
});

export const EvaluationRunComparisonSchema = z.strictObject({
  schemaVersion: z.literal(2),
  kind: EvaluationComparisonKindSchema,
  baseline: EvaluationComparisonIdentitySchema,
  candidate: EvaluationComparisonIdentitySchema,
  comparable: z.boolean(),
  incompatibilities: z.array(z.string().trim().min(1).max(500)),
  /** Withheld unless every comparison identity dimension is identical. */
  metrics: EvaluationComparisonMetricsSchema.nullable(),
  stages: z.array(EvaluationStageComparisonSchema),
});

export type EvaluationRunComparison = z.infer<typeof EvaluationRunComparisonSchema>;
export type EvaluationComparisonKind = z.infer<typeof EvaluationComparisonKindSchema>;
