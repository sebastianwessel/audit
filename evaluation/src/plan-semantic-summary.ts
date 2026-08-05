import type { EvaluationTrial, PlanEvaluationProfile } from './corpus.schema.js';

export type SemanticPlanMeasurementSummary = Readonly<{
  eligibleTrialCount: number;
  completedMeasurementCount: number;
  completionRate: number | null;
  scenarioRecall: number | null;
  relevantVectorPrecision: number | null;
  unrelatedVectorCount: number | null;
  additionalObservationCount: number | null;
  appropriateObservationCount: number | null;
  misplacedObservationCount: number | null;
}>;

/**
 * Derives evaluator-only planning metrics from complete semantic mappings. A
 * missing or incomplete mapping remains unavailable rather than becoming zero.
 */
export function summarizeSemanticPlanMeasurements(
  planProfile: PlanEvaluationProfile,
  trials: readonly EvaluationTrial[],
): SemanticPlanMeasurementSummary | null {
  if (planProfile === 'audit-reviewed-plan') return null;
  const completed = trials.flatMap((trial) =>
    trial.semanticPlanMeasurement?.status === 'completed'
      ? [trial.semanticPlanMeasurement.score]
      : [],
  );
  const expectedScenarioCount = completed.reduce(
    (total, score) => total + score.expectedScenarioCount,
    0,
  );
  const coveredScenarioCount = completed.reduce(
    (total, score) => total + score.coveredScenarioCount,
    0,
  );
  const enabledVectorCount = completed.reduce(
    (total, score) => total + score.enabledVectorCount,
    0,
  );
  const relevantVectorCount = completed.reduce(
    (total, score) => total + score.relevantVectorCount,
    0,
  );
  return {
    eligibleTrialCount: trials.length,
    completedMeasurementCount: completed.length,
    completionRate: ratio(completed.length, trials.length),
    scenarioRecall: ratio(coveredScenarioCount, expectedScenarioCount),
    relevantVectorPrecision: ratio(relevantVectorCount, enabledVectorCount),
    unrelatedVectorCount:
      completed.length === 0
        ? null
        : completed.reduce((total, score) => total + score.unrelatedVectorCount, 0),
    additionalObservationCount:
      completed.length === 0
        ? null
        : completed.reduce((total, score) => total + score.additionalObservationCount, 0),
    appropriateObservationCount:
      completed.length === 0
        ? null
        : completed.reduce((total, score) => total + score.appropriateObservationCount, 0),
    misplacedObservationCount:
      completed.length === 0
        ? null
        : completed.reduce((total, score) => total + score.misplacedObservationCount, 0),
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
