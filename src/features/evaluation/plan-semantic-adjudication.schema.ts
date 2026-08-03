import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from '../../shared/contracts/core.js';

import { CorpusVariantSchema } from './corpus.schema.js';

export const PlanScenarioAdjudicationOutcomeSchema = z.enum(['covered', 'uncovered']);
export const PlanVectorAdjudicationOutcomeSchema = z.enum(['relevant', 'unrelated']);

export const PlanScenarioAdjudicationSchema = z.strictObject({
  scenarioId: IdentifierSchema,
  outcome: PlanScenarioAdjudicationOutcomeSchema,
  vectorIds: z.array(IdentifierSchema),
});

export const PlanVectorAdjudicationSchema = z.strictObject({
  vectorId: IdentifierSchema,
  outcome: PlanVectorAdjudicationOutcomeSchema,
  scenarioIds: z.array(IdentifierSchema),
});

const PlanSemanticAdjudicationBindingFields = {
  schemaVersion: z.literal(1),
  runId: IdentifierSchema,
  trialId: IdentifierSchema,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  caseId: IdentifierSchema,
  variant: CorpusVariantSchema,
  repetition: z.int().positive(),
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  answerKeyScenarioDigest: Sha256Schema,
};

/**
 * Human-only semantic mapping of one exact generated plan. It contains stable
 * identities and no model prompt, source, answer-key wording, or finding text.
 */
export const PlanSemanticAdjudicationSchema = z.strictObject({
  ...PlanSemanticAdjudicationBindingFields,
  reviewer: IdentifierSchema,
  reviewedAt: IsoDateTimeSchema,
  rationale: BoundedTextSchema.max(2_000).optional(),
  scenarios: z.array(PlanScenarioAdjudicationSchema),
  vectors: z.array(PlanVectorAdjudicationSchema),
});

/**
 * Safe, intentionally incomplete file generated for a human evaluator. It
 * contains only stable IDs and must be completed before scoring can begin.
 */
export const PlanSemanticAdjudicationTemplateSchema = z.strictObject({
  ...PlanSemanticAdjudicationBindingFields,
  reviewer: z.null(),
  reviewedAt: z.null(),
  rationale: z.null(),
  scenarios: z.array(
    z.strictObject({
      scenarioId: IdentifierSchema,
      outcome: z.null(),
      vectorIds: z.array(IdentifierSchema),
    }),
  ),
  vectors: z.array(
    z.strictObject({
      vectorId: IdentifierSchema,
      outcome: z.null(),
      scenarioIds: z.array(IdentifierSchema),
    }),
  ),
});

export const PlanSemanticScoreSchema = z.strictObject({
  expectedScenarioCount: z.int().nonnegative(),
  coveredScenarioCount: z.int().nonnegative(),
  scenarioRecall: z.number().min(0).max(1).nullable(),
  enabledVectorCount: z.int().nonnegative(),
  relevantVectorCount: z.int().nonnegative(),
  unrelatedVectorCount: z.int().nonnegative(),
  relevantVectorPrecision: z.number().min(0).max(1).nullable(),
  duplicateRelevantVectorCount: z.int().nonnegative(),
});

/** A reusable source-free projection for reports and offline comparisons. */
export const PlanSemanticEvaluationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  adjudication: PlanSemanticAdjudicationSchema,
  score: PlanSemanticScoreSchema,
});

/** Aggregate evaluator-only plan-quality evidence for one generated-plan run. */
export const PlanSemanticRunEvaluationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: IdentifierSchema,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  selectedSplit: z.enum(['development', 'test', 'private-holdout']),
  promptProtocolFingerprint: Sha256Schema,
  adjudicationQualification: z.literal('single-human-review'),
  eligibleTrialCount: z.int().nonnegative(),
  adjudicatedTrialCount: z.int().nonnegative(),
  missingAdjudicationTrialCount: z.int().nonnegative(),
  expectedScenarioCount: z.int().nonnegative(),
  coveredScenarioCount: z.int().nonnegative(),
  scenarioRecall: z.number().min(0).max(1).nullable(),
  enabledVectorCount: z.int().nonnegative(),
  relevantVectorCount: z.int().nonnegative(),
  unrelatedVectorCount: z.int().nonnegative(),
  relevantVectorPrecision: z.number().min(0).max(1).nullable(),
  duplicateRelevantVectorCount: z.int().nonnegative(),
});

export type PlanSemanticAdjudication = z.infer<typeof PlanSemanticAdjudicationSchema>;
export type PlanSemanticAdjudicationTemplate = z.infer<
  typeof PlanSemanticAdjudicationTemplateSchema
>;
export type PlanSemanticScore = z.infer<typeof PlanSemanticScoreSchema>;
export type PlanSemanticEvaluation = z.infer<typeof PlanSemanticEvaluationSchema>;
export type PlanSemanticRunEvaluation = z.infer<typeof PlanSemanticRunEvaluationSchema>;
