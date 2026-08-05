import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationCancelledError } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';
import { createPlan } from '../../src/features/attack-planning/plan.js';
import type { ModelStageObservation } from '../../src/features/model-operations/model-operations.js';
import { catalogueModelPricing } from '../../src/features/model-operations/model-pricing-catalogue.js';
import {
  readJsonArtifact,
  writeJsonArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { HarnessExecutionConfigurationSchema } from '../../src/platform/harness/audit-harness.js';
import { CorpusAnswerKeySchema } from './corpus.schema.js';
import { answerKeyScenarioDigest } from './plan-semantic-adjudication.js';
import {
  type PlanSemanticAdjudicationBinding,
  PlanSemanticAdjudicationCheckpointSchema,
} from './plan-semantic-adjudication.schema.js';
import { evaluateGeneratedPlanSemantics } from './plan-semantic-agent.js';
import { runPlanSemanticEvaluationOperation } from './plan-semantic-operation.js';
import { evaluationPlanSemanticCheckpointPath } from './real-world-artifacts.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

const plan = createPlan({
  targetFingerprint: 'a'.repeat(64),
  contextDigest: 'b'.repeat(64),
  targetDisplayName: 'semantic-operation-case',
  inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
  createdAt: '2026-08-03T16:00:00.000Z',
  vectors: [
    {
      title: 'Review the source boundary',
      rationale: 'The plan must cover the declared source-only scenario.',
      enabled: true,
      scopeGlobs: ['src/**'],
      reviewObligations: [
        {
          obligationId: 'obligation-01',
          riskStatement: 'A security boundary might be violated.',
          evidenceRequirement: 'Inspect the operation and its controlling condition.',
        },
      ],
      limitations: [],
    },
  ],
});

const answerKey = CorpusAnswerKeySchema.parse({
  schemaVersion: 6,
  caseId: 'semantic-operation-case',
  findingCoverage: 'targeted',
  expectedPlanScenarios: [
    {
      scenarioId: 'scenario-01',
      objective: 'Review the source boundary.',
      sourceOnlyApplicable: true,
      requiredRiskCondition: 'The source boundary might be violated.',
      evidenceRequirements: ['Inspect the operation and its controlling condition.'],
      relevantPaths: ['src/app.txt'],
      expectedFindingIds: ['expected-01'],
    },
  ],
  expectedFindings: [
    {
      findingId: 'expected-01',
      staticReviewApplicable: true,
      evidenceRoles: [
        {
          role: 'operation',
          notApplicable: false,
          ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
        },
        {
          role: 'unsafe-condition',
          notApplicable: false,
          ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
        },
      ],
    },
  ],
  patchedExpectation: 'no-matching-finding',
  staticReviewApplicable: true,
  adjudicationStatus: 'provisional',
  reviewers: ['semantic-operation-reviewer'],
  independentReviews: [
    {
      reviewer: 'semantic-operation-reviewer',
      reviewerKind: 'ai-assisted',
      reviewedAt: '2026-08-03T16:00:00.000Z',
      decision: 'include',
      findingCoverage: 'targeted',
      expectedPlanScenarios: [
        {
          scenarioId: 'scenario-01',
          objective: 'Review the source boundary.',
          sourceOnlyApplicable: true,
          requiredRiskCondition: 'The source boundary might be violated.',
          evidenceRequirements: ['Inspect the operation and its controlling condition.'],
          relevantPaths: ['src/app.txt'],
          expectedFindingIds: ['expected-01'],
        },
      ],
      expectedFindings: [
        {
          findingId: 'expected-01',
          staticReviewApplicable: true,
          evidenceRoles: [
            {
              role: 'operation',
              notApplicable: false,
              ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
            },
            {
              role: 'unsafe-condition',
              notApplicable: false,
              ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
            },
          ],
        },
      ],
      patchedExpectation: 'no-matching-finding',
      staticReviewApplicable: true,
      notes: 'Evaluator-only operation fixture.',
    },
  ],
  notes: 'Evaluator-only operation fixture.',
});

const binding: PlanSemanticAdjudicationBinding = {
  runId: 'semantic-operation-run',
  trialId: 'semantic-operation-trial',
  packId: 'semantic-operation-pack',
  packVersion: '0.1.0',
  caseId: answerKey.caseId,
  variant: 'vulnerable',
  repetition: 1,
  planId: plan.planId,
  planDigest: plan.planDigest,
  targetFingerprint: plan.targetFingerprint,
  contextDigest: plan.contextDigest,
  answerKeyScenarioDigest: answerKeyScenarioDigest(answerKey),
  reviewerProtocolFingerprint: 'c'.repeat(64),
  reviewerRoute: 'primary',
};

test('requires explicit retry for a running checkpoint, then reuses completion before fake provider construction', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'audit-semantic-operation-'));
  temporaryRoots.push(outputRoot);
  const checkpointPath = evaluationPlanSemanticCheckpointPath(binding.runId, binding.trialId);
  await writeJsonArtifact(outputRoot, checkpointPath, PlanSemanticAdjudicationCheckpointSchema, {
    schemaVersion: 4,
    ...binding,
    status: 'running',
    startedAt: '2026-08-03T16:00:00.000Z',
  });

  let providerConstructionCount = 0;
  let costGuardBeforeRequestCount = 0;
  let costGuardRecordedResponseCount = 0;
  let costGuardRecoveredStageCount = 0;
  const modelCostCeiling = {
    beforeRequest: () => {
      costGuardBeforeRequestCount += 1;
    },
    recordResponse: () => {
      costGuardRecordedResponseCount += 1;
    },
    recordPriorStages: (stages: readonly ModelStageObservation[]) => {
      costGuardRecoveredStageCount += stages.length;
    },
    state: () => ({
      configuredUsd: 1,
      accumulatedEstimatedCostUsd: 0,
      reached: false,
    }),
  };
  const invoke = async () => {
    providerConstructionCount += 1;
    const provider = completedFakeProvider();
    return evaluateGeneratedPlanSemantics({
      provider: 'openai',
      modelProvider: provider,
      modelName: 'gpt-5.6-terra',
      execution: HarnessExecutionConfigurationSchema.parse({}),
      sessionId: 'semantic-operation-session',
      binding,
      plan,
      answerKey,
      reviewer: 'semantic-operation-evaluator',
      reviewedAt: '2026-08-03T16:01:00.000Z',
      modelPricing: catalogueModelPricing({ provider: 'openai', model: 'gpt-5.6-terra' }),
      modelCostCeiling,
    });
  };
  const baseInput = {
    outputRoot,
    checkpointPath,
    binding,
    plan,
    answerKey,
    now: () => '2026-08-03T16:01:00.000Z',
    modelCostCeiling,
    invokeEvaluator: invoke,
  };

  await expect(runPlanSemanticEvaluationOperation({ ...baseInput, retry: false })).rejects.toThrow(
    'retry must be explicitly enabled',
  );
  expect(providerConstructionCount).toBe(0);

  await expect(
    runPlanSemanticEvaluationOperation({ ...baseInput, retry: true }),
  ).resolves.toMatchObject({
    status: 'completed',
    evaluation: { score: { scenarioRecall: 1, relevantVectorPrecision: 1 } },
  });
  expect(providerConstructionCount).toBe(1);
  expect(costGuardBeforeRequestCount).toBe(1);
  expect(costGuardRecordedResponseCount).toBe(1);

  await expect(
    runPlanSemanticEvaluationOperation({
      ...baseInput,
      retry: false,
      invokeEvaluator: async () => {
        providerConstructionCount += 1;
        throw new Error('A completed checkpoint must prevent evaluator construction.');
      },
    }),
  ).resolves.toMatchObject({ status: 'completed' });
  expect(providerConstructionCount).toBe(1);
  expect(costGuardRecoveredStageCount).toBe(1);
  expect(await Bun.file(join(outputRoot, checkpointPath)).exists()).toBe(true);
  expect(
    await Bun.file(
      join(
        outputRoot,
        binding.runId,
        'plan-semantic-evaluations',
        `${binding.trialId}.checkpoint.json`,
      ),
    ).exists(),
  ).toBe(false);
});

test('persists normalized cancellation as a source-free terminal checkpoint', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'audit-semantic-cancelled-'));
  temporaryRoots.push(outputRoot);
  const checkpointPath =
    'semantic-operation-run/plan-semantic-evaluations/semantic-cancelled-trial.checkpoint.json';
  const cancelledBinding = { ...binding, trialId: 'semantic-cancelled-trial' };
  let providerConstructionCount = 0;

  const result = await runPlanSemanticEvaluationOperation({
    outputRoot,
    checkpointPath,
    binding: cancelledBinding,
    plan,
    answerKey,
    retry: false,
    now: () => '2026-08-03T16:02:00.000Z',
    invokeEvaluator: async () => {
      providerConstructionCount += 1;
      const provider = new FakeModelProvider();
      provider.object = async () => {
        throw new OperationCancelledError('Cancelled semantic evaluator fixture.', {
          scope: 'model',
        });
      };
      return evaluateGeneratedPlanSemantics({
        provider: 'openai',
        modelProvider: provider,
        modelName: 'gpt-5.6-terra',
        execution: HarnessExecutionConfigurationSchema.parse({}),
        sessionId: 'semantic-cancelled-session',
        binding: cancelledBinding,
        plan,
        answerKey,
        reviewer: 'semantic-operation-evaluator',
        reviewedAt: '2026-08-03T16:02:00.000Z',
        modelPricing: catalogueModelPricing({ provider: 'openai', model: 'gpt-5.6-terra' }),
      });
    },
  });

  expect(result).toMatchObject({ status: 'cancelled', errorCode: 'provider-cancelled' });
  expect(providerConstructionCount).toBe(1);
  await expect(
    readJsonArtifact(outputRoot, checkpointPath, PlanSemanticAdjudicationCheckpointSchema),
  ).resolves.toMatchObject({
    schemaVersion: 4,
    status: 'cancelled',
    errorCode: 'provider-cancelled',
    modelObservation: {
      stage: 'plan-semantic-adjudication',
      status: 'failed',
      errorCode: 'provider-cancelled',
    },
  });
});

function completedFakeProvider(): FakeModelProvider {
  const provider = new FakeModelProvider();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Expected semantic-operation vector.');
  provider.enqueueObject({
    object: {
      scenarios: [{ scenarioId: 'scenario-01', outcome: 'covered', vectorIds: [vector.vectorId] }],
      vectors: [{ vectorId: vector.vectorId, outcome: 'relevant', scenarioIds: ['scenario-01'] }],
      observations: [],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  return provider;
}
