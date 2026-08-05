import { z } from 'zod';

/** Source-free metrics derived only from a structurally closed semantic plan mapping. */
export const PlanSemanticScoreSchema = z.strictObject({
  expectedScenarioCount: z.int().nonnegative(),
  coveredScenarioCount: z.int().nonnegative(),
  scenarioRecall: z.number().min(0).max(1).nullable(),
  enabledVectorCount: z.int().nonnegative(),
  relevantVectorCount: z.int().nonnegative(),
  unrelatedVectorCount: z.int().nonnegative(),
  relevantVectorPrecision: z.number().min(0).max(1).nullable(),
  duplicateRelevantVectorCount: z.int().nonnegative(),
  additionalObservationCount: z.int().nonnegative(),
  appropriateObservationCount: z.int().nonnegative(),
  misplacedObservationCount: z.int().nonnegative(),
});

export type PlanSemanticScore = z.infer<typeof PlanSemanticScoreSchema>;
