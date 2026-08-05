import { z } from 'zod';
import {
  ModelRouteSchema,
  ModelStageErrorCodeSchema,
  ModelStageObservationSchema,
} from '../../src/features/model-operations/model-operations.schema.js';
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';

import { CorpusVariantSchema } from './evaluation.schema.js';
import { PlanSemanticScoreSchema } from './plan-semantic-score.schema.js';

export {
  type PlanSemanticScore,
  PlanSemanticScoreSchema,
} from './plan-semantic-score.schema.js';

export const PlanScenarioAdjudicationOutcomeSchema = z.enum(['covered', 'uncovered']);
export const PlanVectorAdjudicationOutcomeSchema = z.enum(['relevant', 'unrelated']);
export const PlanObservationAdjudicationOutcomeSchema = z.enum(['appropriate', 'misplaced']);

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

/** Evaluator-only placement judgment; an observation is never executable work. */
export const PlanObservationAdjudicationSchema = z.strictObject({
  observationId: IdentifierSchema,
  outcome: PlanObservationAdjudicationOutcomeSchema,
  scenarioIds: z.array(IdentifierSchema),
});

const PlanSemanticAdjudicationBindingFields = {
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
  reviewerProtocolFingerprint: Sha256Schema,
  reviewerRoute: ModelRouteSchema,
};

/** Immutable source-free identity for one evaluator-only semantic review. */
export const PlanSemanticAdjudicationBindingSchema = z.strictObject(
  PlanSemanticAdjudicationBindingFields,
);

/** AI-assisted evaluator-only mapping of one exact generated plan. */
export const PlanSemanticAdjudicationSchema = z.strictObject({
  schemaVersion: z.literal(5),
  ...PlanSemanticAdjudicationBindingSchema.shape,
  reviewer: IdentifierSchema,
  reviewerKind: z.literal('ai-assisted'),
  reviewedAt: IsoDateTimeSchema,
  scenarios: z.array(PlanScenarioAdjudicationSchema),
  vectors: z.array(PlanVectorAdjudicationSchema),
  observations: z.array(PlanObservationAdjudicationSchema),
});

/** A reusable source-free projection for reports and offline comparisons. */
export const PlanSemanticEvaluationSchema = z.strictObject({
  schemaVersion: z.literal(5),
  adjudication: PlanSemanticAdjudicationSchema,
  modelObservation: ModelStageObservationSchema.refine(
    (observation) => observation.stage === 'plan-semantic-adjudication',
    { message: 'A plan semantic evaluation requires its evaluator-stage observation.' },
  ),
  score: PlanSemanticScoreSchema,
});

/** Exact evaluator-only semantic stage checkpoint; it never contains source or prompt content. */
export const PlanSemanticAdjudicationCheckpointSchema = z.discriminatedUnion('status', [
  z.strictObject({
    schemaVersion: z.literal(4),
    ...PlanSemanticAdjudicationBindingSchema.shape,
    status: z.literal('running'),
    startedAt: IsoDateTimeSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(4),
    ...PlanSemanticAdjudicationBindingSchema.shape,
    status: z.literal('completed'),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    evaluation: PlanSemanticEvaluationSchema,
  }),
  z.strictObject({
    schemaVersion: z.literal(4),
    ...PlanSemanticAdjudicationBindingSchema.shape,
    status: z.literal('incomplete'),
    startedAt: IsoDateTimeSchema,
    stoppedAt: IsoDateTimeSchema,
    errorCode: ModelStageErrorCodeSchema,
    modelObservation: ModelStageObservationSchema.refine(
      (observation) => observation.stage === 'plan-semantic-adjudication',
      {
        message: 'An incomplete plan semantic checkpoint requires its evaluator-stage observation.',
      },
    ),
  }),
  z.strictObject({
    schemaVersion: z.literal(4),
    ...PlanSemanticAdjudicationBindingSchema.shape,
    status: z.literal('cancelled'),
    startedAt: IsoDateTimeSchema,
    stoppedAt: IsoDateTimeSchema,
    errorCode: z.literal('provider-cancelled'),
    modelObservation: ModelStageObservationSchema.refine(
      (observation) =>
        observation.stage === 'plan-semantic-adjudication' &&
        observation.errorCode === 'provider-cancelled',
      { message: 'A cancelled plan semantic checkpoint requires its cancellation observation.' },
    ),
  }),
]);

/** Source-free terminal result returned by the evaluator invocation boundary. */
export const PlanSemanticEvaluatorOperationSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('completed'),
    evaluation: PlanSemanticEvaluationSchema,
  }),
  z.strictObject({
    status: z.literal('incomplete'),
    errorCode: ModelStageErrorCodeSchema,
    modelObservation: ModelStageObservationSchema.refine(
      (observation) => observation.stage === 'plan-semantic-adjudication',
      { message: 'An incomplete semantic evaluator result requires its evaluator observation.' },
    ),
  }),
  z.strictObject({
    status: z.literal('cancelled'),
    errorCode: z.literal('provider-cancelled'),
    modelObservation: ModelStageObservationSchema.refine(
      (observation) =>
        observation.stage === 'plan-semantic-adjudication' &&
        observation.errorCode === 'provider-cancelled',
      { message: 'A cancelled semantic evaluator result requires its cancellation observation.' },
    ),
  }),
]);

export type PlanSemanticAdjudication = z.infer<typeof PlanSemanticAdjudicationSchema>;
export type PlanSemanticAdjudicationBinding = z.infer<typeof PlanSemanticAdjudicationBindingSchema>;
export type PlanSemanticEvaluation = z.infer<typeof PlanSemanticEvaluationSchema>;
export type PlanSemanticAdjudicationCheckpoint = z.infer<
  typeof PlanSemanticAdjudicationCheckpointSchema
>;
export type PlanSemanticEvaluatorOperation = z.infer<typeof PlanSemanticEvaluatorOperationSchema>;
