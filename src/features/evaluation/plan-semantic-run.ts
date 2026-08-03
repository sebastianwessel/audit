import { ArtifactStoreError } from '../../platform/artifact-store/json-artifact-store.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';

import type { RealWorldEvaluationRun } from './corpus.schema.js';
import {
  type PlanSemanticEvaluation,
  type PlanSemanticRunEvaluation,
  PlanSemanticRunEvaluationSchema,
} from './plan-semantic-adjudication.schema.js';
import { evaluationTrialId } from './real-world-runner.js';

type SemanticEvaluationReader = (
  artifactPath: string,
) => Promise<PlanSemanticEvaluation | undefined>;

/** Aggregates only complete AI-assisted adjudications and leaves absent ones visible. */
export async function summarizePlanSemanticRun(input: {
  run: RealWorldEvaluationRun;
  read: SemanticEvaluationReader;
}): Promise<PlanSemanticRunEvaluation> {
  if (input.run.planProfile !== 'generated-plan') {
    throw new SecurityReviewerError(
      'invalid-input',
      'A semantic plan run summary requires a generated-plan evaluation run.',
    );
  }
  const eligibleTrials = input.run.trials.filter((trial) => trial.planScore !== null);
  const evaluations = await Promise.all(
    eligibleTrials.map(async (trial) => {
      const trialId = evaluationTrialId({
        runId: input.run.runId,
        caseId: trial.caseId,
        variant: trial.variant,
        repetition: trial.repetition,
      });
      const evaluation = await input.read(
        `${input.run.runId}/plan-semantic-evaluations/${trialId}.json`,
      );
      if (evaluation !== undefined)
        assertEvaluationMatchesTrial(evaluation, input.run, trialId, trial);
      return evaluation;
    }),
  );
  const completed = evaluations.filter(
    (evaluation): evaluation is PlanSemanticEvaluation => evaluation !== undefined,
  );
  const score = completed.reduce(
    (total, evaluation) => ({
      expectedScenarioCount: total.expectedScenarioCount + evaluation.score.expectedScenarioCount,
      coveredScenarioCount: total.coveredScenarioCount + evaluation.score.coveredScenarioCount,
      enabledVectorCount: total.enabledVectorCount + evaluation.score.enabledVectorCount,
      relevantVectorCount: total.relevantVectorCount + evaluation.score.relevantVectorCount,
      unrelatedVectorCount: total.unrelatedVectorCount + evaluation.score.unrelatedVectorCount,
      duplicateRelevantVectorCount:
        total.duplicateRelevantVectorCount + evaluation.score.duplicateRelevantVectorCount,
    }),
    {
      expectedScenarioCount: 0,
      coveredScenarioCount: 0,
      enabledVectorCount: 0,
      relevantVectorCount: 0,
      unrelatedVectorCount: 0,
      duplicateRelevantVectorCount: 0,
    },
  );
  return PlanSemanticRunEvaluationSchema.parse({
    schemaVersion: 2,
    runId: input.run.runId,
    packId: input.run.packId,
    packVersion: input.run.packVersion,
    selectedSplit: input.run.selectedSplit,
    promptProtocolFingerprint: input.run.promptProtocolFingerprint,
    adjudicationQualification: 'single-ai-assisted-development-review',
    eligibleTrialCount: eligibleTrials.length,
    adjudicatedTrialCount: completed.length,
    missingAdjudicationTrialCount: eligibleTrials.length - completed.length,
    ...score,
    scenarioRecall: ratio(score.coveredScenarioCount, score.expectedScenarioCount),
    relevantVectorPrecision: ratio(score.relevantVectorCount, score.enabledVectorCount),
  });
}

/** Converts an absent evaluator artifact to an explicit unavailable measurement, never a zero. */
export async function readOptionalPlanSemanticEvaluation(input: {
  read: (artifactPath: string) => Promise<PlanSemanticEvaluation>;
  artifactPath: string;
}): Promise<PlanSemanticEvaluation | undefined> {
  try {
    return await input.read(input.artifactPath);
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}

function assertEvaluationMatchesTrial(
  evaluation: PlanSemanticEvaluation,
  run: RealWorldEvaluationRun,
  trialId: string,
  trial: RealWorldEvaluationRun['trials'][number],
): void {
  const adjudication = evaluation.adjudication;
  if (
    adjudication.runId !== run.runId ||
    adjudication.packId !== run.packId ||
    adjudication.packVersion !== run.packVersion ||
    adjudication.trialId !== trialId ||
    adjudication.caseId !== trial.caseId ||
    adjudication.variant !== trial.variant ||
    adjudication.repetition !== trial.repetition
  ) {
    throw new SecurityReviewerError(
      'artifact-invalid',
      'Plan semantic evaluation does not match its selected evaluation trial.',
    );
  }
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
