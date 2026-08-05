import { z } from 'zod';

import type {
  EvaluationTrial,
  PlanEvaluationProfile,
  PlanSemanticMeasurement,
} from './corpus.schema.js';

/**
 * Source-free statement of which evaluation dimensions actually completed.
 * It deliberately separates measurement availability from any quality score.
 */
export const EvaluationMeasurementStateSchema = z.strictObject({
  workflow: z.enum(['complete', 'incomplete']),
  semanticPlan: z.enum(['complete', 'incomplete', 'not-applicable']),
  finding: z.enum(['complete', 'incomplete', 'not-applicable']),
});

export type EvaluationMeasurementState = z.infer<typeof EvaluationMeasurementStateSchema>;

/** Derives one canonical state from persisted trial terminals; no model semantics are inferred. */
export function deriveEvaluationMeasurementState(input: {
  planProfile: PlanEvaluationProfile;
  trials: readonly (Pick<EvaluationTrial, 'status'> & {
    semanticPlanMeasurement?: Pick<PlanSemanticMeasurement, 'status'>;
  })[];
}): EvaluationMeasurementState {
  const workflow = input.trials.every((trial) => trial.status === 'completed')
    ? 'complete'
    : 'incomplete';
  const semanticPlan =
    input.planProfile === 'audit-reviewed-plan'
      ? 'not-applicable'
      : input.trials.every((trial) => trial.semanticPlanMeasurement?.status === 'completed')
        ? 'complete'
        : 'incomplete';
  const finding =
    input.planProfile === 'planning-generated'
      ? 'not-applicable'
      : workflow === 'complete'
        ? 'complete'
        : 'incomplete';
  return EvaluationMeasurementStateSchema.parse({ workflow, semanticPlan, finding });
}
