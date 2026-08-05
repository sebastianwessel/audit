import { expect, test } from 'bun:test';

import { observeModelStage } from '../../src/features/model-operations/model-operations.js';
import { compareEvaluationBaseline } from './baseline.js';
import { EvaluationBaselineSchema, RealWorldEvaluationRunSchema } from './corpus.schema.js';

const evaluationIdentity = {
  corpusManifestDigest: 'c'.repeat(64),
  populationDigest: 'd'.repeat(64),
  benchmarkProtocolFingerprint: 'e'.repeat(64),
};
const semanticPlanEvaluator = {
  protocolFingerprint: 'f'.repeat(64),
  route: 'primary' as const,
};
const semanticIdentity = {
  planDigest: '1'.repeat(64),
  answerKeyScenarioDigest: '2'.repeat(64),
  ...semanticPlanEvaluator,
};
const semanticObservation = observeModelStage({
  stage: 'plan-semantic-adjudication',
  route: 'primary',
  stageId: 'semantic-stage-001',
  status: 'completed',
  durationMs: 1,
  errorCode: null,
  requests: [],
  pricing: {},
  trace: [],
  cacheRoutingEnabled: false,
});

function planningRun() {
  return RealWorldEvaluationRunSchema.parse({
    schemaVersion: 15,
    runId: 'planning-run-001',
    packId: 'seed-pack',
    packVersion: '1.0.0',
    ...evaluationIdentity,
    mode: 'provider',
    provider: 'fixture',
    model: 'fixture',
    verificationMode: 'same-route',
    verificationRouteFingerprint: 'a'.repeat(64),
    selectedSplit: 'development',
    findingCoverage: 'targeted',
    evidenceQualification: 'development-pilot',
    repetitions: 1,
    planProfile: 'planning-generated',
    semanticPlanEvaluator,
    executionBudget: { modelTimeoutMs: 20_000, runTimeoutMs: 30_000, modelRetry: 'default' },
    maxParallelVectors: 1,
    modelCostCeilingState: {
      configuredUsd: null,
      accumulatedEstimatedCostUsd: null,
      reached: false,
    },
    promptProtocolFingerprint: 'b'.repeat(64),
    startedAt: '2026-08-04T12:00:00.000Z',
    finishedAt: '2026-08-04T12:00:01.000Z',
    selectedTrialPopulation: [{ caseId: 'case-001', variant: 'vulnerable', repetition: 1 }],
    trials: [
      {
        caseId: 'case-001',
        variant: 'vulnerable',
        repetition: 1,
        status: 'completed',
        reviewedPlanFingerprint: null,
        pathReachability: {
          eligibleScenarioCount: 1,
          pathReachableScenarioCount: 1,
          notApplicableScenarioCount: 0,
          relevantPathCoverage: 1,
          enabledVectorCount: 1,
        },
        semanticPlanMeasurement: {
          status: 'completed',
          identity: semanticIdentity,
          score: {
            expectedScenarioCount: 1,
            coveredScenarioCount: 1,
            scenarioRecall: 1,
            enabledVectorCount: 1,
            relevantVectorCount: 1,
            unrelatedVectorCount: 0,
            relevantVectorPrecision: 1,
            duplicateRelevantVectorCount: 0,
            additionalObservationCount: 0,
            appropriateObservationCount: 0,
            misplacedObservationCount: 0,
          },
          modelObservation: semanticObservation,
        },
        findingScore: null,
        planKeys: ['a'.repeat(64)],
        findingKeys: [],
        durationMs: 1,
        errorCode: null,
      },
    ],
    reliability: {
      completedTrials: 1,
      incompleteTrials: 0,
      failedTrials: 0,
      cancelledTrials: 0,
      completionRate: 1,
      planJaccard: null,
      findingJaccard: null,
      findingRecallMedian: null,
      findingRecallMinimum: null,
      allTerminalDurationMsMedian: 1,
      allTerminalDurationMsP95: 1,
      completedDurationMsMedian: 1,
      completedDurationMsP95: 1,
    },
    measurementState: { workflow: 'complete', semanticPlan: 'complete', finding: 'not-applicable' },
    safetyViolations: 0,
    diagnosticGatePassed: true,
  });
}

function planningBaseline() {
  return EvaluationBaselineSchema.parse({
    schemaVersion: 2,
    packId: 'seed-pack',
    packVersion: '1.0.0',
    ...evaluationIdentity,
    planProfile: 'planning-generated',
    semanticPlanEvaluator,
    verificationMode: 'same-route',
    verificationRouteFingerprint: 'a'.repeat(64),
    reviewedAt: '2026-08-04T12:00:00.000Z',
    reviewNote: 'Semantic planning threshold.',
    requiredCaseIds: ['case-001'],
    thresholds: {
      minimumCompletionRate: 1,
      minimumSemanticEvaluatorCompletionRate: 1,
      minimumSemanticScenarioRecall: 1,
      minimumRelevantVectorPrecision: 1,
    },
  });
}

test('allows an all-green planning run to pass a planning-only semantic baseline', () => {
  expect(compareEvaluationBaseline(planningBaseline(), planningRun())).toEqual({
    passed: true,
    violations: [],
  });
});

test('rejects the same planning run before evaluating an audit baseline', () => {
  const auditBaseline = EvaluationBaselineSchema.parse({
    schemaVersion: 2,
    packId: 'seed-pack',
    packVersion: '1.0.0',
    ...evaluationIdentity,
    planProfile: 'audit-reviewed-plan',
    semanticPlanEvaluator: null,
    findingCoverage: 'exhaustive',
    verificationMode: 'same-route',
    verificationRouteFingerprint: 'a'.repeat(64),
    reviewedAt: '2026-08-04T12:00:00.000Z',
    reviewNote: 'Audit threshold.',
    requiredCaseIds: ['case-001'],
    thresholds: {
      minimumCompletionRate: 1,
      minimumVulnerableFindingRecall: 1,
      maximumNonVulnerableFalsePositives: 0,
    },
  });
  expect(compareEvaluationBaseline(auditBaseline, planningRun())).toEqual({
    passed: false,
    violations: ['Baseline plan profile does not match this evaluation run.'],
  });
});

test('rejects semantic baselines when the evaluator protocol changes', () => {
  const run = planningRun();
  const changed = RealWorldEvaluationRunSchema.parse({
    ...run,
    semanticPlanEvaluator: { ...semanticPlanEvaluator, protocolFingerprint: '3'.repeat(64) },
    trials: run.trials.map((trial) => ({
      ...trial,
      semanticPlanMeasurement:
        trial.semanticPlanMeasurement?.status === 'completed'
          ? {
              ...trial.semanticPlanMeasurement,
              identity: { ...semanticIdentity, protocolFingerprint: '3'.repeat(64) },
            }
          : trial.semanticPlanMeasurement,
    })),
  });
  expect(compareEvaluationBaseline(planningBaseline(), changed).violations).toContain(
    'Baseline semantic evaluator identity does not match this evaluation run.',
  );
});
