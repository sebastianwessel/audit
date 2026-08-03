import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readJsonArtifact,
  writeJsonArtifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import { createPlan } from '../attack-planning/plan.js';
import { summarizeModelStages } from '../model-operations/model-operations.js';
import { reviewWorkflowPromptProtocolFingerprint } from '../review-workflow/prompt-protocol.js';
import { deterministicCorpusFixturePack, loadCorpusPack } from './corpus.js';
import { EvaluationGeneratedPlanCheckpointSchema } from './corpus.schema.js';
import { createDeterministicCorpusProvider } from './deterministic-provider.js';
import {
  PlanSemanticAdjudicationSchema,
  PlanSemanticAdjudicationTemplateSchema,
  PlanSemanticEvaluationSchema,
  PlanSemanticRunEvaluationSchema,
} from './plan-semantic-adjudication.schema.js';
import { writeRealWorldEvaluationArtifacts } from './real-world-artifacts.js';
import { evaluationTrialId, runCorpusEvaluation } from './real-world-runner.js';
import {
  parsePlanSemanticAdjudicationArguments,
  renderPlanSemanticEvaluation,
  runPlanSemanticAdjudication,
} from './run-plan-semantic-adjudication.js';
import { runPlanSemanticSummary } from './run-plan-semantic-summary.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

test('requires a complete local human plan adjudication command', () => {
  expect(() => parsePlanSemanticAdjudicationArguments([])).toThrow(
    'Invalid plan semantic adjudication options',
  );
  expect(
    parsePlanSemanticAdjudicationArguments([
      '--corpus',
      'evaluation/corpora',
      '--output',
      'evaluation/runs',
      '--run-id',
      'provider-eval-01',
      '--case-id',
      'private-case-01',
      '--variant',
      'vulnerable',
      '--repetition',
      '1',
      '--adjudication',
      'provider-eval-01/adjudication.json',
    ]),
  ).toMatchObject({ repetition: 1, variant: 'vulnerable' });
  expect(
    parsePlanSemanticAdjudicationArguments([
      '--corpus',
      'evaluation/corpora',
      '--output',
      'evaluation/runs',
      '--run-id',
      'provider-eval-01',
      '--case-id',
      'private-case-01',
      '--variant',
      'benign',
      '--repetition',
      '1',
      '--template',
      'provider-eval-01/template.json',
    ]),
  ).toMatchObject({ template: 'provider-eval-01/template.json', variant: 'benign' });
  expect(() =>
    parsePlanSemanticAdjudicationArguments([
      '--corpus',
      'evaluation/corpora',
      '--output',
      'evaluation/runs',
      '--run-id',
      'provider-eval-01',
      '--case-id',
      'private-case-01',
      '--variant',
      'vulnerable',
      '--repetition',
      '1',
      '--adjudication',
      'provider-eval-01/adjudication.json',
      '--template',
      'provider-eval-01/template.json',
    ]),
  ).toThrow('Invalid plan semantic adjudication options');
});

test('renders a source-free semantic plan score', () => {
  const report = renderPlanSemanticEvaluation({
    schemaVersion: 1,
    adjudication: {
      schemaVersion: 1,
      runId: 'provider-eval-01',
      trialId: 'evaluation-trial-01',
      packId: 'private-pack-01',
      packVersion: '0.1.0',
      caseId: 'private-case-01',
      variant: 'vulnerable',
      repetition: 1,
      planId: 'plan-1234567890abcdef',
      planDigest: 'a'.repeat(64),
      targetFingerprint: 'b'.repeat(64),
      contextDigest: 'c'.repeat(64),
      answerKeyScenarioDigest: 'd'.repeat(64),
      reviewer: 'reviewer-three',
      reviewedAt: '2026-08-03T11:00:00.000Z',
      scenarios: [],
      vectors: [],
    },
    score: {
      expectedScenarioCount: 2,
      coveredScenarioCount: 1,
      scenarioRecall: 0.5,
      enabledVectorCount: 3,
      relevantVectorCount: 2,
      unrelatedVectorCount: 1,
      relevantVectorPrecision: 2 / 3,
      duplicateRelevantVectorCount: 1,
    },
  });
  expect(report).toContain('| 0.500 | 0.667 | 1/2 | 2/3 | 1 | 1 |');
  expect(report).toContain('do not change product admission');
});

test('creates and validates a semantic adjudication through the jailed artifact workflow', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'security-reviewer-plan-semantic-'));
  temporaryRoots.push(outputRoot);
  const pack = await loadCorpusPack('evaluation/corpora');
  const runId = 'plan-semantic-e2e-01';
  const provider = await createDeterministicCorpusProvider(
    deterministicCorpusFixturePack(pack),
    'development',
    1,
  );
  const run = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'deterministic-fixture',
    model: 'fake-model',
    split: 'development',
    repetitions: 1,
    runId,
    startedAt: '2026-08-03T12:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  await writeRealWorldEvaluationArtifacts(outputRoot, run, '# fixture\n');
  const trial = run.trials[0];
  if (trial === undefined) throw new Error('Expected a deterministic corpus trial.');
  const corpusCase = pack.cases.find((entry) => entry.case.caseId === trial.caseId);
  if (corpusCase === undefined) throw new Error('Expected selected corpus case.');
  const plan = createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: trial.caseId,
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    createdAt: '2026-08-03T12:00:00.000Z',
    vectors: [
      {
        title: 'Review the evaluator scenario',
        rationale: 'The evaluator creates a plan checkpoint for human semantic review.',
        enabled: true,
        scopeGlobs: ['**'],
        reviewObligations: [
          {
            obligationId: 'semantic-review-01',
            riskStatement: 'A source-visible security condition might require review.',
            evidenceRequirement: 'Inspect the scoped operation and its condition.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Expected generated plan vector.');
  const trialId = evaluationTrialId({
    runId,
    caseId: trial.caseId,
    variant: trial.variant,
    repetition: trial.repetition,
  });
  await writeJsonArtifact(
    outputRoot,
    `${runId}/.work/plans/${trialId}.json`,
    EvaluationGeneratedPlanCheckpointSchema,
    {
      schemaVersion: 1,
      trialId,
      configFingerprint: 'c'.repeat(64),
      targetFingerprint: plan.targetFingerprint,
      contextDigest: plan.contextDigest,
      plan,
      modelObservation: summarizeModelStages([], {}),
      savedAt: '2026-08-03T12:00:01.000Z',
    },
  );
  const shared = [
    '--corpus',
    'evaluation/corpora',
    '--output',
    outputRoot,
    '--run-id',
    runId,
    '--case-id',
    trial.caseId,
    '--variant',
    trial.variant,
    '--repetition',
    String(trial.repetition),
  ];
  await expect(
    runPlanSemanticAdjudication([...shared, '--template', `${runId}/adjudication-template.json`]),
  ).resolves.toBe(0);
  const template = await readJsonArtifact(
    outputRoot,
    `${runId}/adjudication-template.json`,
    PlanSemanticAdjudicationTemplateSchema,
  );
  const adjudication = PlanSemanticAdjudicationSchema.parse({
    ...template,
    reviewer: 'reviewer-three',
    reviewedAt: '2026-08-03T12:05:00.000Z',
    rationale: 'Human evaluator reviewed the exact generated plan.',
    scenarios: template.scenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      outcome: 'covered' as const,
      vectorIds: [vector.vectorId],
    })),
    vectors: [
      {
        vectorId: vector.vectorId,
        outcome: 'relevant' as const,
        scenarioIds: corpusCase.answerKey.expectedPlanScenarios.map(
          (scenario) => scenario.scenarioId,
        ),
      },
    ],
  });
  await writeJsonArtifact(
    outputRoot,
    `${runId}/adjudication.json`,
    PlanSemanticAdjudicationSchema,
    adjudication,
  );
  await expect(
    runPlanSemanticAdjudication([...shared, '--adjudication', `${runId}/adjudication.json`]),
  ).resolves.toBe(0);
  await expect(
    readJsonArtifact(
      outputRoot,
      `${runId}/plan-semantic-evaluations/${trialId}.json`,
      PlanSemanticEvaluationSchema,
    ),
  ).resolves.toMatchObject({ score: { scenarioRecall: 1, relevantVectorPrecision: 1 } });
  await expect(runPlanSemanticSummary(['--output', outputRoot, '--run-id', runId])).resolves.toBe(
    0,
  );
  await expect(
    readJsonArtifact(
      outputRoot,
      `${runId}/plan-semantic-evaluation.json`,
      PlanSemanticRunEvaluationSchema,
    ),
  ).resolves.toMatchObject({
    eligibleTrialCount: run.trials.length,
    adjudicatedTrialCount: 1,
    missingAdjudicationTrialCount: run.trials.length - 1,
    scenarioRecall: 1,
  });
});
