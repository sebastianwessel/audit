import { expect, test } from 'bun:test';
import { type JsonValue, type ModelProvider, OperationCancelledError } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';
import { createPlan as createDraftPlan } from '../../src/features/attack-planning/index.js';
import {
  observeModelStage,
  summarizeModelStages,
} from '../../src/features/model-operations/model-operations.js';
import { reviewWorkflowPromptProtocolFingerprint } from '../../src/features/review-workflow/prompt-protocol.js';
import { createReviewService } from '../../src/features/review-workflow/service.js';
import { HarnessExecutionConfigurationSchema } from '../../src/platform/harness/audit-harness.js';

import { deterministicCorpusFixturePack, loadCorpusPack, variantRoot } from './corpus.js';
import { RealWorldEvaluationRunSchema } from './corpus.schema.js';
import { enqueueDeterministicCorpusResponses } from './deterministic-provider.js';
import {
  bindPlanSemanticModelOutput,
  createPlanSemanticEvaluation,
} from './plan-semantic-adjudication.js';
import type {
  PlanSemanticAdjudicationBinding,
  PlanSemanticEvaluatorOperation,
} from './plan-semantic-adjudication.schema.js';
import { renderRealWorldEvaluationReport } from './real-world-report.js';
import {
  type EvaluationAuditCheckpointStore,
  type EvaluationPlanSemanticEvaluatorPort,
  runCorpusEvaluation,
  selectCasesForEvaluation,
} from './real-world-runner.js';

test('runs the pinned mixed-language seed through the normal plan and audit workflow without inventing findings', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const provider = new FakeModelProvider();
  await enqueueDeterministicCorpusResponses(
    deterministicCorpusFixturePack(pack),
    'development',
    1,
    {
      enqueue: (response) => provider.enqueueObject(response),
    },
  );
  const run = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'deterministic-golden-fixture',
    model: 'fake-model',
    split: 'development',
    repetitions: 1,
    runId: 'real-world-runner-test',
    startedAt: '2026-07-27T12:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 2,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  expect(run.maxParallelVectors).toBe(2);
  expect(run.diagnosticGatePassed).toBe(false);
  expect(run.evidenceQualification).toBe('development-calibration');
  expect(run.trials).toHaveLength(6);
  expect(run.trials.every((trial) => trial.status === 'incomplete')).toBe(true);
  expect(run.trials.every((trial) => trial.pathReachability !== null)).toBe(true);
  expect(run.trials.every((trial) => trial.findingScore === null)).toBe(true);
  expect(run.trials.every((trial) => trial.errorCode === 'evidence-map-incomplete')).toBe(true);
  expect(
    run.trials.every((trial) => trial.vectorCoverage?.every((entry) => !entry.completed)),
  ).toBe(true);
  expect(run.trials.filter((trial) => trial.variant === 'patched')).toHaveLength(2);
  expect(run.trials.map((trial) => trial.admissionFunnel?.modelCandidateCount)).toEqual([
    0, 0, 0, 0, 0, 0,
  ]);
  expect(run.reliability.planJaccard).toBeNull();
  expect(run.reliability.findingJaccard).toBeNull();
  expect(run.reliability.modelObservation?.stages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ stage: 'planning', status: 'completed' }),
      expect.objectContaining({
        stage: 'evidence-mapping',
        status: 'completed',
      }),
    ]),
  );
  expect(run.reliability.modelObservation?.toolUsage.grepFilesCallCount).toBe(
    run.trials.length * 2,
  );
  const report = renderRealWorldEvaluationReport(pack, run);
  expect(report).toContain('javascript');
  expect(report).toContain('owasp-benchmarkjava-00008');
  expect(report).toContain('All-role terminal-evidence recall minimum');
  expect(report).toContain('Evidence qualification: development-calibration');
  expect(report).toContain('## Evidence strength');
  expect(report).toContain('## Audit-dispatch boundary');
  expect(report).toContain('Only enabled vectors are dispatched');
  expect(report).toContain(
    'An unpromoted observation cannot produce a finding, pass, or incomplete coverage result.',
  );
  expect(report).toContain('| Operational completion | incomplete (0/6 completed) |');
  expect(report).toContain('| Semantic-plan measurement | incomplete (unavailable) |');
  expect(report).toContain('| Finding measurement | incomplete |');
  expect(report).toContain('| Precision availability | unavailable |');
  expect(report).toContain('| Corpus qualification | development-calibration |');
  expect(report).toContain('| Route independence | same route |');
  expect(report).toContain('single-run diagnostic; not stability or reliability evidence');
  expect(report).toContain('Finding-label coverage: targeted');
  expect(report).toContain('Private-holdout attestation: not recorded');
  expect(report).toContain(
    'internal development calibration only; not a model-quality, provider-selection, or reliability claim',
  );
  expect(report).toContain('Patched matches');
  expect(report).toContain('Adjudicated FP');
  expect(report).toContain('All-role terminal-evidence recall min/median');
  expect(report).not.toContain('Fully evidenced');
  expect(report).toContain('Unadjudicated');
  expect(report).toContain('By workflow stage');
  expect(report).toContain('Cost and latency hotspots');
  expect(report).toContain('File-tool usage');
  expect(report).toContain('Completed-trial finding admission funnel');
  expect(report).toContain('Vector concurrency: 2');
  expect(report).toContain('| 0 | 0 | 0 | 0/0/0 | 0 | 0 | 0 | 0 | 0 |');
  const hotspotSection =
    report.split('### Cost and latency hotspots')[1]?.split('### Provider requests')[0] ?? '';
  const expectedHotspotCount = new Set(
    run.trials.flatMap((trial) =>
      (trial.modelObservation?.stages ?? []).map(
        (stage) => `${trial.caseId}\u0000${trial.variant}\u0000${stage.stage}\u0000${stage.route}`,
      ),
    ),
  ).size;
  expect(hotspotSection.match(/^\| `[^`]+` \|/gmu)).toHaveLength(expectedHotspotCount);

  const retainedRun = {
    ...run,
    trials: run.trials.map((trial, index) =>
      index === 0
        ? {
            ...trial,
            retainedUnscored: {
              acceptedFindingKeys: ['accepted-observation-01'],
              reviewRequiredFindingKeys: ['review-required-observation-01'],
            },
          }
        : trial,
    ),
  };
  const retainedReport = renderRealWorldEvaluationReport(pack, retainedRun);
  expect(retainedReport).toContain('Retained unscored outcomes');
  expect(retainedReport).toContain('Accepted observations');
  expect(retainedReport).toContain('Incomplete-trial finding admission funnel');
});

test('measures generated planning without dispatching audit work', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing planning profile fixture case.');
  const provider = new FakeModelProvider();
  const semanticEvaluatorCalls: PlanSemanticAdjudicationBinding[] = [];
  for (let repetition = 0; repetition < 2; repetition += 1) {
    provider.enqueueObject(scopedInspectionResponse());
    provider.enqueueObject({
      object: {
        vectors: [
          {
            title: 'Review the evaluator-scoped risk',
            rationale: 'The generated plan needs one bounded security review vector.',
            enabled: true,
            scopeGlobs: ['**/*'],
            reviewObligations: [
              {
                obligationId: `planning-profile-obligation-0${String(repetition + 1)}`,
                riskStatement: 'The bounded source may violate a security boundary.',
                evidenceRequirement:
                  'Inspect source-backed operation and unsafe-condition evidence.',
              },
            ],
            limitations: [],
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    });
  }
  const run = await runCorpusEvaluation({
    pack: { ...pack, cases: [loaded] },
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    runId: 'planning-generated-runner-test',
    startedAt: '2026-08-01T12:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    planProfile: 'planning-generated',
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    semanticPlanEvaluator: {
      evaluate: async (input) => {
        semanticEvaluatorCalls.push(input.binding);
        return completedSemanticEvaluation(input.binding, input.plan, input.answerKey);
      },
    },
  });

  expect(run.planProfile).toBe('planning-generated');
  expect(run.diagnosticGatePassed).toBeTrue();
  expect(run.reliability.findingJaccard).toBeNull();
  expect(run.trials).toHaveLength(2);
  expect(run.trials.every((trial) => trial.status === 'completed')).toBe(true);
  expect(
    run.trials.every(
      (trial) =>
        trial.pathReachability?.pathReachableScenarioCount ===
        trial.pathReachability?.eligibleScenarioCount,
    ),
  ).toBe(true);
  expect(run.trials.every((trial) => trial.pathReachability?.relevantPathCoverage === 1)).toBe(
    true,
  );
  expect(run.trials.every((trial) => trial.findingScore === null)).toBe(true);
  expect(renderRealWorldEvaluationReport({ ...pack, cases: [loaded] }, run)).toContain(
    'This profile intentionally stops after planning; audit execution was not run.',
  );
  expect(
    run.trials.every(
      (trial) =>
        trial.vectorCoverage === undefined &&
        trial.admissionFunnel === undefined &&
        trial.hypothesisGroundingFunnel === undefined &&
        trial.candidateIntegrityRejections === undefined,
    ),
  ).toBe(true);
  expect(run.measurementState).toEqual({
    workflow: 'complete',
    semanticPlan: 'complete',
    finding: 'not-applicable',
  });
  expect(
    run.trials.every(
      (trial) =>
        trial.semanticPlanMeasurement?.status === 'completed' &&
        trial.semanticPlanMeasurement.score.scenarioRecall === 1 &&
        trial.semanticPlanMeasurement.score.relevantVectorPrecision === 1,
    ),
  ).toBe(true);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).toEqual(['planning', 'plan-semantic-adjudication', 'planning', 'plan-semantic-adjudication']);
  expect(semanticEvaluatorCalls).toHaveLength(2);
  expect(provider.requests).toHaveLength(4);
});

test('fails the planning diagnostic gate when a reachable vector is semantically unrelated', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing unrelated-vector planning fixture case.');
  const provider = new FakeModelProvider();
  for (let repetition = 0; repetition < 2; repetition += 1) {
    provider.enqueueObject(scopedInspectionResponse());
    provider.enqueueObject({
      object: {
        vectors: [
          {
            title: 'Review the evaluator-scoped risk',
            rationale: 'The generated plan needs one bounded security review vector.',
            enabled: true,
            scopeGlobs: ['**/*'],
            reviewObligations: [
              {
                obligationId: `focused-planning-obligation-0${String(repetition + 1)}`,
                riskStatement: 'The bounded source may violate a security boundary.',
                evidenceRequirement:
                  'Inspect source-backed operation and unsafe-condition evidence.',
              },
            ],
            limitations: [],
          },
          {
            title: 'Review adjacent configuration',
            rationale: 'An adjacent configuration concern might deserve human review.',
            enabled: true,
            scopeGlobs: ['**/*'],
            reviewObligations: [
              {
                obligationId: `speculative-planning-obligation-0${String(repetition + 1)}`,
                riskStatement: 'An adjacent configuration might weaken a security boundary.',
                evidenceRequirement: 'Inspect configuration and its affected operation.',
              },
            ],
            limitations: [],
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    });
  }

  const run = await runCorpusEvaluation({
    pack: { ...pack, cases: [loaded] },
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    runId: 'planning-generated-unrelated-vector-runner-test',
    startedAt: '2026-08-04T12:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    planProfile: 'planning-generated',
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    semanticPlanEvaluator: {
      evaluate: async (input) => semanticEvaluationWithUnrelatedVector(input),
    },
  });

  expect(run.trials.every((trial) => trial.status === 'completed')).toBe(true);
  expect(run.trials.every((trial) => trial.pathReachability?.relevantPathCoverage === 1)).toBe(
    true,
  );
  expect(
    run.trials.every(
      (trial) =>
        trial.semanticPlanMeasurement?.status === 'completed' &&
        trial.semanticPlanMeasurement.score.scenarioRecall === 1 &&
        trial.semanticPlanMeasurement.score.relevantVectorPrecision === 0.5 &&
        trial.semanticPlanMeasurement.score.unrelatedVectorCount === 1,
    ),
  ).toBe(true);
  expect(run.diagnosticGatePassed).toBe(false);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).toEqual(['planning', 'plan-semantic-adjudication', 'planning', 'plan-semantic-adjudication']);
  expect(provider.requests).toHaveLength(4);
});

test('retains a completed planning trial when semantic-plan measurement is cancelled', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing semantic cancellation fixture case.');
  const provider = new FakeModelProvider();
  for (let repetition = 0; repetition < 2; repetition += 1) {
    provider.enqueueObject(scopedInspectionResponse());
    provider.enqueueObject({
      object: {
        vectors: [
          {
            title: 'Review the evaluator-scoped risk',
            rationale: 'The generated plan needs one bounded security review vector.',
            enabled: true,
            scopeGlobs: ['**/*'],
            reviewObligations: [
              {
                obligationId: `planning-profile-obligation-0${String(repetition + 1)}`,
                riskStatement: 'The bounded source may violate a security boundary.',
                evidenceRequirement:
                  'Inspect source-backed operation and unsafe-condition evidence.',
              },
            ],
            limitations: [],
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    });
  }
  const semanticPlanEvaluator: EvaluationPlanSemanticEvaluatorPort = {
    evaluate: async ({ binding }) => ({
      status: 'cancelled',
      errorCode: 'provider-cancelled',
      modelObservation: cancelledSemanticObservation(binding),
    }),
  };

  const run = await runCorpusEvaluation({
    pack: { ...pack, cases: [loaded] },
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    runId: 'planning-semantic-cancellation-runner-test',
    startedAt: '2026-08-03T18:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    planProfile: 'planning-generated',
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    semanticPlanEvaluator,
  });

  expect(run.trials.every((trial) => trial.status === 'completed')).toBe(true);
  expect(
    run.trials.every(
      (trial) =>
        trial.semanticPlanMeasurement?.status === 'cancelled' &&
        trial.semanticPlanMeasurement.errorCode === 'provider-cancelled',
    ),
  ).toBe(true);
  expect(
    RealWorldEvaluationRunSchema.safeParse({
      ...run,
      trials: [
        { ...run.trials[0], findingKeys: ['contaminated-audit-finding'] },
        ...run.trials.slice(1),
      ],
    }).success,
  ).toBe(false);
  expect(run.measurementState).toEqual({
    workflow: 'complete',
    semanticPlan: 'incomplete',
    finding: 'not-applicable',
  });
  expect(run.diagnosticGatePassed).toBe(false);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).toEqual(['planning', 'plan-semantic-adjudication', 'planning', 'plan-semantic-adjudication']);
  expect(provider.requests).toHaveLength(4);
});

test('retains incomplete trials without another provider call until unfinished recovery is requested', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const provider = new FakeModelProvider();
  await enqueueDeterministicCorpusResponses(
    deterministicCorpusFixturePack(pack),
    'development',
    1,
    {
      enqueue: (response) => provider.enqueueObject(response),
    },
  );
  const first = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    runId: 'resume-runner-test',
    startedAt: '2026-07-29T08:30:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  const requestCount = provider.requests.length;
  const resumed = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    runId: 'resume-runner-test',
    startedAt: '2026-07-29T08:30:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    priorTrials: first.trials,
  });
  expect(resumed.trials).toEqual(first.trials);
  expect(provider.requests).toHaveLength(requestCount);
});

test('reuses a truly completed audit-reviewed-plan trial without another provider call', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing completed-runner fixture case.');
  const fixturePack = { ...pack, cases: [loaded] };
  const provider = new FakeModelProvider();
  const startedAt = '2026-07-31T12:30:00.000Z';
  for (const variant of ['vulnerable', 'patched'] as const) {
    await enqueueCompletedReviewedPlanResponses(
      provider,
      variantRoot(fixturePack, loaded.case, variant),
      loaded.case.caseId,
      loaded.reviewedPlan.vectors,
      startedAt,
    );
  }

  const first = await runCorpusEvaluation({
    pack: fixturePack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    planProfile: 'audit-reviewed-plan',
    runId: 'completed-resume-runner-test',
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  expect(first.trials).toHaveLength(2);
  expect(first.trials.every((trial) => trial.status === 'completed')).toBe(true);
  expect(first.trials.every((trial) => trial.findingScore !== null)).toBe(true);
  expect(first.evidenceQualification).toBe('development-calibration');
  expect(first.diagnosticGatePassed).toBe(false);
  expect(
    first.trials.every(
      (trial) =>
        trial.modelObservation?.stages.map((stage) => stage.stage).join(',') ===
          'evidence-mapping,source-posture,investigation,candidate-grounding,verification' &&
        trial.modelObservation.stages.every(
          (stage) =>
            stage.trace.map((event) => event.kind).join(',') ===
            'model-response,tool-call,model-response',
        ),
    ),
  ).toBe(true);
  const requestCount = provider.requests.length;

  const resumed = await runCorpusEvaluation({
    pack: fixturePack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    planProfile: 'audit-reviewed-plan',
    runId: 'completed-resume-runner-test',
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    priorTrials: first.trials,
  });
  expect(resumed.trials).toEqual(first.trials);
  expect(provider.requests).toHaveLength(requestCount);
});

test('selects every declared variant of one case and rejects an out-of-split selector before dispatch', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing bounded-case fixture.');
  const provider = new FakeModelProvider();
  const startedAt = '2026-08-01T20:30:00.000Z';
  for (const variant of ['vulnerable', 'patched'] as const) {
    await enqueueCompletedReviewedPlanResponses(
      provider,
      variantRoot(pack, loaded.case, variant),
      loaded.case.caseId,
      loaded.reviewedPlan.vectors,
      startedAt,
    );
  }
  const selected = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    caseIdFilter: loaded.case.caseId,
    repetitions: 1,
    planProfile: 'audit-reviewed-plan',
    runId: 'bounded-case-runner-test',
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  expect(selected.caseIdFilter).toBe(loaded.case.caseId);
  expect(selected.trials).toHaveLength(2);
  expect(new Set(selected.trials.map((trial) => trial.variant))).toEqual(
    new Set(['vulnerable', 'patched']),
  );

  const invalidProvider = new FakeModelProvider();
  await expect(
    runCorpusEvaluation({
      pack,
      modelProvider: invalidProvider,
      provider: 'fixture',
      model: 'fixture',
      split: 'development',
      caseIdFilter: 'case-not-in-development',
      repetitions: 1,
      planProfile: 'audit-reviewed-plan',
      runId: 'bounded-case-invalid-runner-test',
      startedAt,
      mode: 'deterministic',
      executionBudget: HarnessExecutionConfigurationSchema.parse({}),
      maxParallelVectors: 1,
      promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    }),
  ).rejects.toMatchObject({ code: 'invalid-input' });
  expect(invalidProvider.requests).toHaveLength(0);
});

test('uses an isolated reviewed plan without provider planning calls', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const provider = new FakeModelProvider();
  await enqueueDeterministicCorpusResponses(
    deterministicCorpusFixturePack(pack),
    'development',
    1,
    {
      enqueue: (response) => provider.enqueueObject(response),
    },
    'audit-reviewed-plan',
  );
  const run = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'deterministic-golden-fixture',
    model: 'fake-model',
    split: 'development',
    repetitions: 1,
    planProfile: 'audit-reviewed-plan',
    runId: 'audit-reviewed-plan-runner-test',
    startedAt: '2026-07-29T12:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  expect(run.diagnosticGatePassed).toBe(false);
  expect(run.planProfile).toBe('audit-reviewed-plan');
  expect(run.reliability.planJaccard).toBeNull();
  expect(run.trials.every((trial) => trial.pathReachability === null)).toBe(true);
  expect(run.trials.every((trial) => trial.reviewedPlanFingerprint !== null)).toBe(true);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).not.toContain('planning');
  expect(provider.requests).toHaveLength(run.trials.length * 2);
});

test('reuses a end-to-end-generated checkpoint before dispatching audit work', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing end-to-end-generated recovery fixture case.');
  const fixturePack = { ...pack, cases: [loaded] };
  const provider = new FakeModelProvider();
  const startedAt = '2026-07-31T13:00:00.000Z';
  const inspector = createReviewService(new FakeModelProvider());
  const plans = new Map<string, ReturnType<typeof createDraftPlan>>();
  for (const variant of ['vulnerable', 'patched'] as const) {
    const targetRoot = variantRoot(fixturePack, loaded.case, variant);
    const inventory = await inspector.inspectTarget({
      targetRoot,
      targetDisplayName: loaded.case.caseId,
    });
    plans.set(
      inventory.targetFingerprint,
      createDraftPlan({
        targetFingerprint: inventory.targetFingerprint,
        contextDigest: inventory.contextDigest,
        targetDisplayName: loaded.case.caseId,
        inventorySummary: inventory.summary,
        vectors: loaded.reviewedPlan.vectors,
        createdAt: startedAt,
      }),
    );
    await enqueueCompletedReviewedPlanResponses(
      provider,
      targetRoot,
      loaded.case.caseId,
      loaded.reviewedPlan.vectors,
      startedAt,
    );
  }
  let savedPlanCount = 0;
  const run = await runCorpusEvaluation({
    pack: fixturePack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    planProfile: 'end-to-end-generated',
    runId: 'end-to-end-generated-recovery-runner-test',
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    planningCheckpoints: {
      load: async ({ trialId, targetFingerprint, contextDigest }) => {
        const plan = plans.get(targetFingerprint);
        if (plan === undefined) return undefined;
        return {
          schemaVersion: 1,
          trialId,
          configFingerprint: 'a'.repeat(64),
          targetFingerprint,
          contextDigest,
          plan,
          modelObservation: summarizeModelStages([], {}),
          savedAt: startedAt,
        };
      },
      save: async () => {
        savedPlanCount += 1;
      },
    },
  });
  expect(savedPlanCount).toBe(0);
  expect(run.trials.every((trial) => trial.status === 'completed')).toBe(true);
  expect(run.trials.every((trial) => trial.pathReachability !== null)).toBe(true);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).not.toContain('planning');
});

test('retains completed planning telemetry when a later evaluator persistence step fails', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing terminal-telemetry fixture case.');
  const vector = loaded.reviewedPlan.vectors[0];
  if (vector === undefined) throw new Error('Missing terminal-telemetry fixture vector.');
  const fixturePack = { ...pack, cases: [loaded] };
  const provider = new FakeModelProvider();
  for (const _variant of ['vulnerable', 'patched'] as const) {
    provider.enqueueObject(scopedInspectionResponse());
    provider.enqueueObject({
      object: {
        vectors: [
          {
            title: vector.title,
            rationale: vector.rationale,
            enabled: vector.enabled,
            scopeGlobs: vector.scopeGlobs,
            reviewObligations: vector.reviewObligations,
            limitations: vector.limitations,
          },
        ],
      },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    });
  }

  const run = await runCorpusEvaluation({
    pack: fixturePack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    planProfile: 'end-to-end-generated',
    runId: 'end-to-end-generated-terminal-telemetry-test',
    startedAt: '2026-07-31T14:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    planningCheckpoints: {
      load: async () => undefined,
      save: async () => {
        throw new Error('Simulated evaluator checkpoint persistence failure.');
      },
    },
  });

  expect(run.trials.every((trial) => trial.status === 'failed')).toBe(true);
  expect(run.trials.every((trial) => trial.vectorCoverage === undefined)).toBe(true);
  expect(run.trials.every((trial) => trial.modelObservation !== null)).toBe(true);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).toEqual(['planning', 'planning']);
  expect(provider.requests).toHaveLength(4);
});

test('retains source-free evidence-stage diagnostics when map checkpoint persistence fails', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing failed-map fixture case.');
  const fixturePack = { ...pack, cases: [loaded] };
  const provider = new FakeModelProvider();
  const startedAt = '2026-08-03T14:00:00.000Z';
  for (const variant of ['vulnerable', 'patched'] as const) {
    await enqueueCompletedReviewedPlanResponses(
      provider,
      variantRoot(fixturePack, loaded.case, variant),
      loaded.case.caseId,
      loaded.reviewedPlan.vectors,
      startedAt,
    );
  }
  let evidenceMapCheckpointAttempts = 0;
  const failingCheckpoints: EvaluationAuditCheckpointStore = {
    load: async () => ({
      observedVectorResults: [],
      vectorResults: [],
      candidateGroundingDrafts: [],
      candidateAwareCheckpoints: [],
      evidenceMapDrafts: [],
      sourcePostureDrafts: [],
      contextOverflowLedgers: [],
      evidenceMapRecoveryLeaves: [],
      sourcePostureRecoveryLeaves: [],
      candidateGroundingRecoveryLeaves: [],
    }),
    saveEvidenceMap: async () => {
      evidenceMapCheckpointAttempts += 1;
      throw new Error('Simulated evidence-map checkpoint persistence failure.');
    },
    saveSourcePosture: async () => undefined,
    saveCandidateGrounding: async () => undefined,
    saveCandidateAware: async () => undefined,
    saveVectorResult: async () => undefined,
    saveContextOverflowTransition: async () => undefined,
    saveEvidenceMapRecoveryLeaf: async () => undefined,
    saveSourcePostureRecoveryLeaf: async () => undefined,
    saveCandidateGroundingRecoveryLeaf: async () => undefined,
  };
  const run = await runCorpusEvaluation({
    pack: fixturePack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    planProfile: 'audit-reviewed-plan',
    runId: 'failed-map-stage-diagnostic-test',
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    auditCheckpoints: failingCheckpoints,
  });

  expect(run.trials.every((trial) => trial.status === 'failed')).toBe(true);
  expect(run.trials.map((trial) => trial.errorCode)).toContain('checkpoint-persistence-failed');
  expect(run.trials.every((trial) => trial.errorCode !== null)).toBe(true);
  expect(run.trials.every((trial) => trial.findingScore === null)).toBe(true);
  expect(run.trials.every((trial) => trial.reviewRequiredScore === null)).toBe(true);
  expect(
    run.trials.map((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).toEqual([['evidence-mapping'], ['evidence-mapping']]);
  expect(run.reliability.modelObservation?.stages).toEqual(
    run.trials.flatMap((trial) => trial.modelObservation?.stages ?? []),
  );
  expect(
    run.trials.every(
      (trial) =>
        trial.stageEvidenceCoverage !== undefined &&
        trial.stageEvidenceCoverage.expectedRoleCount > 0 &&
        trial.stageEvidenceCoverage.groundedRoleCount === 0 &&
        trial.stageEvidenceCoverage.verifiedRoleCount === 0,
    ),
  ).toBe(true);
  expect(evidenceMapCheckpointAttempts).toBe(1);
  expect(provider.requests.length).toBeGreaterThanOrEqual(2);
});

test('retains failed investigation telemetry and exact observed cost without scoring the trial', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing failed-investigation fixture case.');
  const fixturePack = { ...pack, cases: [loaded] };
  const provider = new FakeModelProvider();
  const startedAt = '2026-08-04T12:00:00.000Z';
  for (const variant of ['vulnerable', 'patched'] as const) {
    await enqueueInvalidInvestigationResponses(
      provider,
      variantRoot(fixturePack, loaded.case, variant),
      loaded.case.caseId,
      loaded.reviewedPlan.vectors,
      startedAt,
    );
  }

  const run = await runCorpusEvaluation({
    pack: fixturePack,
    modelProvider: provider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    planProfile: 'audit-reviewed-plan',
    runId: 'failed-investigation-cost-retention-test',
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    maxParallelVectors: 1,
    modelPricing: {
      inputPerMillion: 1,
      outputPerMillion: 1,
      source: 'catalogue',
    },
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });

  expect(run.trials.every((trial) => trial.status === 'failed')).toBe(true);
  expect(run.trials.every((trial) => trial.findingScore === null)).toBe(true);
  expect(run.trials.every((trial) => trial.reviewRequiredScore === null)).toBe(true);
  expect(run.trials).toHaveLength(2);
  expect(
    run.trials.map((trial) =>
      trial.modelObservation?.stages.map((stage) => `${stage.stage}:${stage.status}`),
    ),
  ).toEqual([
    ['evidence-mapping:completed', 'source-posture:completed', 'investigation:failed'],
    ['evidence-mapping:completed', 'source-posture:completed', 'investigation:failed'],
  ]);
  expect(
    run.trials.every((trial) => {
      const lastStage = trial.modelObservation?.stages.at(-1);
      return (
        lastStage !== undefined &&
        lastStage.errorCode !== null &&
        lastStage.usage.modelCallCount === 2
      );
    }),
  ).toBe(true);
  const retainedCost = run.reliability.modelObservation?.cost.estimatedCostUsd;
  if (retainedCost === null || retainedCost === undefined) {
    throw new Error('Failed-investigation telemetry must retain a known aggregate cost.');
  }
  expect(
    run.trials.reduce(
      (total, trial) => total + (trial.modelObservation?.cost.estimatedCostUsd ?? 0),
      0,
    ),
  ).toBe(retainedCost);
  const aggregate = run.reliability.modelObservation;
  if (aggregate === null || aggregate === undefined) {
    throw new Error('Expected retained aggregate stage telemetry.');
  }
  expect(
    RealWorldEvaluationRunSchema.safeParse({
      ...run,
      reliability: {
        ...run.reliability,
        modelObservation: {
          ...aggregate,
          stages: aggregate.stages.slice(1),
        },
      },
    }).success,
  ).toBe(false);
});

test('rejects an empty selected split before constructing any workflow work', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const emptySplitPack = { ...pack, cases: [] };
  const provider = new FakeModelProvider();
  expect(() => selectCasesForEvaluation(emptySplitPack, 'development', undefined)).toThrow(
    'does not contain any cases',
  );
  await expect(
    runCorpusEvaluation({
      pack: emptySplitPack,
      modelProvider: provider,
      provider: 'fixture',
      model: 'fixture',
      split: 'development',
      repetitions: 1,
      runId: 'empty-split-runner-test',
      startedAt: '2026-08-03T15:00:00.000Z',
      mode: 'deterministic',
      executionBudget: HarnessExecutionConfigurationSchema.parse({}),
      maxParallelVectors: 1,
      promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    }),
  ).rejects.toThrow('does not contain any cases');
  expect(provider.requests).toHaveLength(0);
});

test('records a provider-neutral planning cancellation as a cancelled, retryable trial', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing cancellation fixture case.');
  const cancelledProvider: ModelProvider = {
    id: 'cancelled-fixture',
    genAiSystem: 'cancelled-fixture',
    object: async () => {
      throw new OperationCancelledError('Model call was cancelled.', {
        scope: 'model',
      });
    },
  };
  const run = await runCorpusEvaluation({
    pack: { ...pack, cases: [loaded] },
    modelProvider: cancelledProvider,
    provider: 'fixture',
    model: 'fixture',
    split: 'development',
    repetitions: 1,
    planProfile: 'end-to-end-generated',
    runId: 'end-to-end-generated-cancellation-test',
    startedAt: '2026-07-31T14:30:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });

  expect(run.trials.every((trial) => trial.status === 'cancelled')).toBe(true);
  expect(run.trials.every((trial) => trial.errorCode === 'provider-cancelled')).toBe(true);
  expect(run.trials.every((trial) => trial.modelObservation === null)).toBe(true);
});

/**
 * Protocol-only fixture: it uses the reviewed plan but never reads the answer
 * key, and deliberately maps a non-adjudicated source location. It proves
 * terminal/resume plumbing, not detection quality or a security conclusion.
 */
async function enqueueCompletedReviewedPlanResponses(
  provider: FakeModelProvider,
  targetRoot: string,
  targetDisplayName: string,
  vectors: Parameters<typeof createDraftPlan>[0]['vectors'],
  createdAt: string,
): Promise<void> {
  const service = createReviewService(new FakeModelProvider());
  const inventory = await service.inspectTarget({
    targetRoot,
    targetDisplayName,
  });
  const plan = createDraftPlan({
    targetFingerprint: inventory.targetFingerprint,
    contextDigest: inventory.contextDigest,
    targetDisplayName,
    inventorySummary: inventory.summary,
    vectors,
    createdAt,
  });
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Completed-runner fixture needs one vector.');
  const obligation = vector.reviewObligations[0];
  if (obligation === undefined) throw new Error('Completed-runner fixture needs one obligation.');
  const sourcePath = 'index.js';
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: {
      facts: [
        {
          factId: 'fixture-input',
          role: 'control',
          statement: 'The approved source contains the fixture input context.',
          evidence: [{ path: sourcePath, startLine: 1 }],
          planObligations: [{ obligationId: obligation.obligationId }],
        },
        {
          factId: 'fixture-operation',
          role: 'operation',
          statement: 'The approved source contains the fixture operation context.',
          evidence: [{ path: sourcePath, startLine: 1 }],
          planObligations: [{ obligationId: obligation.obligationId }],
        },
      ],
      controlCoverage: [
        { obligationId: obligation.obligationId, controlFactIds: ['fixture-input'] },
      ],
      unansweredPlanObligations: [],
      limitations: [],
    },
    usage,
    finishReason: 'stop',
  });
  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: {
      assessments: [
        {
          assessmentId: 'fixture-posture',
          obligationId: obligation.obligationId,
          conclusion: 'risk-supported',
          summary:
            'The neutral fixture map leaves the approved risk-positive obligation unresolved.',
          evidenceMapFactIds: ['fixture-input', 'fixture-operation'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    usage,
    finishReason: 'stop',
  });
  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: {
      seeds: [
        {
          seedId: 'fixture-seed',
          vectorId: vector.vectorId,
          hypothesis: 'The model fixture raised the approved bounded hypothesis.',
          planObligations: [{ obligationId: obligation.obligationId }],
          evidenceMapFactIds: ['fixture-input', 'fixture-operation'],
          limitations: [],
        },
      ],
      closures: [
        {
          planObligation: { obligationId: obligation.obligationId },
          disposition: 'candidate-raised',
          evidenceMapFactIds: ['fixture-input', 'fixture-operation'],
          limitations: [],
        },
      ],
    },
    usage,
    finishReason: 'stop',
  });
  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: {
      groundings: [
        {
          seedId: 'fixture-seed',
          candidate: {
            statement: 'Completed runner fixture hypothesis',
            claimEvidenceBundles: [
              {
                role: 'operation',
                explanation: 'The fixture operation is selected from the neutral map.',
                selections: [{ factId: 'fixture-operation', evidenceIndex: 0 }],
              },
              {
                role: 'unsafe-condition',
                explanation: 'The fixture input is selected from the neutral map.',
                selections: [{ factId: 'fixture-input', evidenceIndex: 0 }],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    usage,
    finishReason: 'stop',
  });
  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: wrappedVerificationResult({
      decision: 'accepted',
      reasonCode: 'claim-supported',
      reason: 'The evaluator fixture selected valid bounded map evidence.',
      claimEvidenceBundles: [
        {
          role: 'operation',
          explanation: 'The fixture operation is selected from the neutral map.',
          selections: [{ factId: 'fixture-operation', evidenceIndex: 0 }],
        },
        {
          role: 'unsafe-condition',
          explanation: 'The fixture input is selected from the neutral map.',
          selections: [{ factId: 'fixture-input', evidenceIndex: 0 }],
        },
      ],
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No fixture control negates the fixture hypothesis.',
        evidenceSelections: [{ factId: 'fixture-input', evidenceIndex: 0 }],
      },
      obligationReconciliations: [
        {
          planObligation: { obligationId: obligation.obligationId },
          disposition: 'supports-claim',
          explanation: 'The fixture selected source-backed evidence for the obligation.',
          evidenceSelections: [{ factId: 'fixture-operation', evidenceIndex: 0 }],
        },
      ],
      postureReconciliations: [
        {
          assessmentId: 'fixture-posture',
          disposition: 'supports-claim',
          explanation: 'The fixture reconciles its selected source posture evidence.',
          evidenceSelections: [{ factId: 'fixture-operation', evidenceIndex: 0 }],
        },
      ],
    }),
    usage,
    finishReason: 'stop',
  });
}

/** Exercises evaluation retention after the investigator's provider response fails its outer contract. */
async function enqueueInvalidInvestigationResponses(
  provider: FakeModelProvider,
  targetRoot: string,
  targetDisplayName: string,
  vectors: Parameters<typeof createDraftPlan>[0]['vectors'],
  createdAt: string,
): Promise<void> {
  const service = createReviewService(new FakeModelProvider());
  const inventory = await service.inspectTarget({ targetRoot, targetDisplayName });
  const plan = createDraftPlan({
    targetFingerprint: inventory.targetFingerprint,
    contextDigest: inventory.contextDigest,
    targetDisplayName,
    inventorySummary: inventory.summary,
    vectors,
    createdAt,
  });
  const vector = plan.vectors[0];
  const obligation = vector?.reviewObligations[0];
  if (vector === undefined || obligation === undefined) {
    throw new Error('Failed-investigation fixture needs one vector and obligation.');
  }
  const sourcePath = 'index.js';
  const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: {
      facts: [
        {
          factId: 'fixture-input',
          role: 'control',
          statement: 'The approved source contains the fixture input context.',
          evidence: [{ path: sourcePath, startLine: 1 }],
          planObligations: [{ obligationId: obligation.obligationId }],
        },
        {
          factId: 'fixture-operation',
          role: 'operation',
          statement: 'The approved source contains the fixture operation context.',
          evidence: [{ path: sourcePath, startLine: 1 }],
          planObligations: [{ obligationId: obligation.obligationId }],
        },
      ],
      controlCoverage: [
        { obligationId: obligation.obligationId, controlFactIds: ['fixture-input'] },
      ],
      unansweredPlanObligations: [],
      limitations: [],
    },
    usage,
    finishReason: 'stop',
  });
  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: {
      assessments: [
        {
          assessmentId: 'fixture-posture',
          obligationId: obligation.obligationId,
          conclusion: 'risk-supported',
          summary:
            'The neutral fixture map leaves the approved risk-positive obligation unresolved.',
          evidenceMapFactIds: ['fixture-input', 'fixture-operation'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    usage,
    finishReason: 'stop',
  });
  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: { seeds: [], closures: [] },
    usage,
    finishReason: 'stop',
  });
}

function scopedInspectionResponse() {
  return {
    object: {},
    toolCalls: [
      {
        id: 'completed-runner-scoped-inspection',
        name: 'repo_grep',
        arguments: {
          pattern: '__audit_completed_runner_fixture_no_match__',
          mode: 'literal',
          caseSensitive: true,
        },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls' as const,
  };
}

function wrappedVerificationResult(result: JsonValue): JsonValue {
  return { result };
}

/**
 * Test-only semantic-evaluator port: it proves evaluator lifecycle plumbing,
 * not model behavior. It deliberately receives the sealed evaluator inputs.
 */
function completedSemanticEvaluation(
  binding: PlanSemanticAdjudicationBinding,
  plan: Parameters<typeof createPlanSemanticEvaluation>[0]['plan'],
  answerKey: Parameters<typeof createPlanSemanticEvaluation>[0]['answerKey'],
): PlanSemanticEvaluatorOperation {
  const enabledVectorIds = plan.vectors
    .filter((vector) => vector.enabled)
    .map((vector) => vector.vectorId);
  const scenarioIds = answerKey.expectedPlanScenarios.map((scenario) => scenario.scenarioId);
  const modelObservation = completedSemanticObservation(binding);
  const adjudication = bindPlanSemanticModelOutput({
    binding,
    plan,
    answerKey,
    reviewer: 'runner-test-semantic-evaluator',
    reviewedAt: '2026-08-03T17:00:00.000Z',
    output: {
      scenarios: answerKey.expectedPlanScenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        outcome: 'covered' as const,
        vectorIds: enabledVectorIds,
      })),
      vectors: plan.vectors
        .filter((vector) => vector.enabled)
        .map((vector) => ({
          vectorId: vector.vectorId,
          outcome: 'relevant' as const,
          scenarioIds,
        })),
      observations: plan.additionalObservations.map((observation) => ({
        observationId: observation.observationId,
        outcome: 'appropriate' as const,
        scenarioIds: [],
      })),
    },
  });
  return {
    status: 'completed',
    evaluation: createPlanSemanticEvaluation({
      adjudication,
      binding,
      plan,
      answerKey,
      modelObservation,
    }),
  };
}

function semanticEvaluationWithUnrelatedVector(input: {
  binding: PlanSemanticAdjudicationBinding;
  plan: Parameters<typeof createPlanSemanticEvaluation>[0]['plan'];
  answerKey: Parameters<typeof createPlanSemanticEvaluation>[0]['answerKey'];
}): PlanSemanticEvaluatorOperation {
  const [relevantVector, unrelatedVector] = input.plan.vectors.filter((vector) => vector.enabled);
  if (relevantVector === undefined || unrelatedVector === undefined) {
    throw new Error('Expected focused and speculative enabled vectors.');
  }
  const scenarioIds = input.answerKey.expectedPlanScenarios.map((scenario) => scenario.scenarioId);
  const adjudication = bindPlanSemanticModelOutput({
    binding: input.binding,
    plan: input.plan,
    answerKey: input.answerKey,
    reviewer: 'runner-test-semantic-evaluator',
    reviewedAt: '2026-08-04T12:00:00.000Z',
    output: {
      scenarios: scenarioIds.map((scenarioId) => ({
        scenarioId,
        outcome: 'covered' as const,
        vectorIds: [relevantVector.vectorId],
      })),
      vectors: [
        {
          vectorId: relevantVector.vectorId,
          outcome: 'relevant' as const,
          scenarioIds,
        },
        {
          vectorId: unrelatedVector.vectorId,
          outcome: 'unrelated' as const,
          scenarioIds: [],
        },
      ],
      observations: input.plan.additionalObservations.map((observation) => ({
        observationId: observation.observationId,
        outcome: 'appropriate' as const,
        scenarioIds: [],
      })),
    },
  });
  return {
    status: 'completed',
    evaluation: createPlanSemanticEvaluation({
      adjudication,
      binding: input.binding,
      plan: input.plan,
      answerKey: input.answerKey,
      modelObservation: completedSemanticObservation(input.binding),
    }),
  };
}

function completedSemanticObservation(binding: PlanSemanticAdjudicationBinding) {
  return observeModelStage({
    stage: 'plan-semantic-adjudication',
    route: 'primary',
    stageId: `runner-test-semantic-${binding.trialId}`,
    status: 'completed',
    durationMs: 1,
    errorCode: null,
    requests: [],
    pricing: {},
    cacheRoutingEnabled: false,
  });
}

function cancelledSemanticObservation(binding: PlanSemanticAdjudicationBinding) {
  return observeModelStage({
    stage: 'plan-semantic-adjudication',
    route: 'primary',
    stageId: `runner-test-semantic-${binding.trialId}`,
    status: 'failed',
    durationMs: 1,
    errorCode: 'provider-cancelled',
    requests: [],
    pricing: {},
    cacheRoutingEnabled: false,
  });
}
