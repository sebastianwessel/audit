import { expect, test } from 'bun:test';

import { observeModelStage } from '../../src/features/model-operations/model-operations.js';
import { compareEvaluationRuns, renderEvaluationRunComparison } from './comparison.js';
import { RealWorldEvaluationRunSchema } from './corpus.schema.js';

const semanticPlanEvaluator = {
  protocolFingerprint: 'f'.repeat(64),
  route: 'primary' as const,
};
const semanticObservation = observeModelStage({
  stage: 'plan-semantic-adjudication',
  route: 'primary',
  stageId: 'comparison-semantic-stage',
  status: 'completed',
  durationMs: 1,
  errorCode: null,
  requests: [],
  pricing: {},
  trace: [],
  cacheRoutingEnabled: false,
});

function generatedRun(runId: string) {
  return RealWorldEvaluationRunSchema.parse({
    schemaVersion: 16,
    runId,
    packId: 'comparison-pack',
    packVersion: '1.0.0',
    corpusManifestDigest: 'b'.repeat(64),
    populationDigest: 'c'.repeat(64),
    benchmarkProtocolFingerprint: 'd'.repeat(64),
    mode: 'provider',
    provider: 'openai',
    model: 'test-model',
    verificationMode: 'same-route',
    verificationRouteFingerprint: 'a'.repeat(64),
    selectedSplit: 'development',
    findingCoverage: 'targeted',
    evidenceQualification: 'diagnostic',
    repetitions: 1,
    planProfile: 'planning-generated',
    semanticPlanEvaluator,
    executionBudget: { modelTimeoutMs: 20_000, runTimeoutMs: 30_000, modelRetry: 'default' },
    maxParallelVectors: 1,
    promptProtocolFingerprint: 'b'.repeat(64),
    startedAt: '2026-08-04T12:00:00.000Z',
    finishedAt: '2026-08-04T12:00:01.000Z',
    selectedTrialPopulation: [{ caseId: 'comparison-case', variant: 'vulnerable', repetition: 1 }],
    trials: [
      {
        caseId: 'comparison-case',
        variant: 'vulnerable',
        repetition: 1,
        status: 'completed',
        reviewedPlanFingerprint: null,
        pathReachability: {
          eligibleScenarioCount: 1,
          pathReachableScenarioCount: 1,
          notApplicableScenarioCount: 0,
          relevantPathCoverage: 1,
          enabledVectorCount: 2,
        },
        semanticPlanMeasurement: {
          status: 'completed',
          identity: {
            planDigest: '1'.repeat(64),
            answerKeyScenarioDigest: '2'.repeat(64),
            ...semanticPlanEvaluator,
          },
          score: {
            expectedScenarioCount: 1,
            coveredScenarioCount: 1,
            scenarioRecall: 1,
            enabledVectorCount: 2,
            relevantVectorCount: 1,
            unrelatedVectorCount: 1,
            relevantVectorPrecision: 0.5,
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
        durationMs: 10,
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
      allTerminalDurationMsMedian: 10,
      allTerminalDurationMsP95: 10,
      completedDurationMsMedian: 10,
      completedDurationMsP95: 10,
    },
    measurementState: { workflow: 'complete', semanticPlan: 'complete', finding: 'not-applicable' },
    safetyViolations: 0,
    diagnosticGatePassed: true,
  });
}

test('compares compatible generated-plan artifacts with every semantic delta', () => {
  const comparison = compareEvaluationRuns(
    generatedRun('comparison-baseline'),
    generatedRun('comparison-candidate'),
  );
  expect(comparison.comparable).toBe(true);
  expect(comparison.metrics?.semanticEvaluatorCompletionRate.delta).toBe(0);
  expect(comparison.metrics?.semanticScenarioRecall.delta).toBe(0);
  expect(comparison.metrics?.semanticRelevantVectorPrecision.delta).toBe(0);
  expect(comparison.metrics?.semanticUnrelatedVectorCount.delta).toBe(0);
  expect(renderEvaluationRunComparison(comparison)).toContain('semanticScenarioRecall');
});

test('rejects generated-plan comparisons when only semantic evaluator protocol or route changes', () => {
  const baseline = generatedRun('semantic-baseline');
  for (const semanticPlanEvaluatorChange of [
    { ...semanticPlanEvaluator, protocolFingerprint: '3'.repeat(64) },
    { ...semanticPlanEvaluator, route: 'independent' as const },
  ]) {
    const candidate = RealWorldEvaluationRunSchema.parse({
      ...generatedRun(`semantic-${semanticPlanEvaluatorChange.route}`),
      semanticPlanEvaluator: semanticPlanEvaluatorChange,
      trials: generatedRun(`semantic-trial-${semanticPlanEvaluatorChange.route}`).trials.map(
        (trial) => ({
          ...trial,
          semanticPlanMeasurement:
            trial.semanticPlanMeasurement?.status === 'completed'
              ? {
                  ...trial.semanticPlanMeasurement,
                  identity: {
                    ...trial.semanticPlanMeasurement.identity,
                    ...semanticPlanEvaluatorChange,
                  },
                }
              : trial.semanticPlanMeasurement,
        }),
      ),
    });
    expect(compareEvaluationRuns(baseline, candidate).incompatibilities).toContain(
      'Different semantic evaluator identity.',
    );
  }
});

test('renders semantic deltas as not applicable for audit-reviewed-plan comparisons', () => {
  const generated = generatedRun('audit-shape');
  const audit = RealWorldEvaluationRunSchema.parse({
    ...generated,
    runId: 'audit-baseline',
    planProfile: 'audit-reviewed-plan',
    semanticPlanEvaluator: null,
    trials: generated.trials.map((trial) => ({
      ...trial,
      reviewedPlanFingerprint: '9'.repeat(64),
      pathReachability: null,
      semanticPlanMeasurement: { status: 'not-applicable' },
      planKeys: [],
    })),
    measurementState: { workflow: 'complete', semanticPlan: 'not-applicable', finding: 'complete' },
  });
  const comparison = compareEvaluationRuns(audit, { ...audit, runId: 'audit-candidate' });
  expect(comparison.comparable).toBe(true);
  expect(comparison.metrics?.semanticScenarioRecall.delta).toBeNull();
  expect(renderEvaluationRunComparison(comparison)).toContain('not applicable');
});
