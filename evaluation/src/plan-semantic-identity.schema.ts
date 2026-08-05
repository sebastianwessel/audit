import { z } from 'zod';
import { ModelRouteSchema } from '../../src/features/model-operations/model-operations.schema.js';
import { Sha256Schema } from '../../src/shared/contracts/core.js';

/**
 * Run-level identity of the evaluator-only semantic-plan protocol. It contains
 * neither the plan, the rubric, nor model-authored output.
 */
export const SemanticPlanEvaluatorIdentitySchema = z.strictObject({
  protocolFingerprint: Sha256Schema,
  route: ModelRouteSchema,
});

/**
 * Per-trial binding for a semantic-plan measurement after a generated plan
 * exists. This is the smallest source-free identity needed to reject stale
 * semantic measurements during comparison or recovery.
 */
export const PlanSemanticMeasurementIdentitySchema = z.strictObject({
  planDigest: Sha256Schema,
  answerKeyScenarioDigest: Sha256Schema,
  ...SemanticPlanEvaluatorIdentitySchema.shape,
});

export type SemanticPlanEvaluatorIdentity = z.infer<typeof SemanticPlanEvaluatorIdentitySchema>;
export type PlanSemanticMeasurementIdentity = z.infer<typeof PlanSemanticMeasurementIdentitySchema>;
