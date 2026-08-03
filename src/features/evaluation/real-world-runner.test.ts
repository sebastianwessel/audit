import { expect, test } from 'bun:test';
import { type ModelProvider, OperationCancelledError } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';
import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import { createPlan as createDraftPlan } from '../attack-planning/plan.js';
import { summarizeModelStages } from '../model-operations/model-operations.js';
import { reviewWorkflowPromptProtocolFingerprint } from '../review-workflow/prompt-protocol.js';
import { createReviewService } from '../review-workflow/service.js';

import { deterministicCorpusFixturePack, loadCorpusPack, variantRoot } from './corpus.js';
import { enqueueDeterministicCorpusResponses } from './deterministic-provider.js';
import { renderRealWorldEvaluationReport } from './real-world-report.js';
import {
  type EvaluationAuditCheckpointStore,
  runCorpusEvaluation,
  selectCasesForEvaluation,
} from './real-world-runner.js';

test('runs the pinned mixed-language seed through the normal plan and audit workflow without inventing findings', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
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
  expect(run.gatePassed).toBe(false);
  expect(run.evidenceQualification).toBe('diagnostic');
  expect(run.trials).toHaveLength(6);
  expect(run.trials.every((trial) => trial.status === 'incomplete')).toBe(true);
  expect(run.trials.every((trial) => trial.planScore !== null)).toBe(true);
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
  expect(report).toContain('Finding recall minimum');
  expect(report).toContain('Evidence qualification: diagnostic');
  expect(report).toContain('single-run diagnostic; not stability or reliability evidence');
  expect(report).toContain('Finding-label coverage: targeted');
  expect(report).toContain('Private-holdout attestation: not recorded');
  expect(report).toContain('not eligible for a provider-quality or reliability claim');
  expect(report).toContain('Patched matches');
  expect(report).toContain('Adjudicated FP');
  expect(report).toContain('Finding recall min/median');
  expect(report).toContain('Unadjudicated');
  expect(report).toContain('By workflow stage');
  expect(report).toContain('Cost and latency hotspots');
  expect(report).toContain('File-tool usage');
  expect(report).toContain('Finding admission funnel');
  expect(report).toContain('Vector concurrency: 2');
  expect(report).toContain('| 0 | 0 | 0 | 0/0/0 | 0 | 0 | 0 | 0 | 0 |');
});

test('measures generated-plan coverage without dispatching audit work', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing planning-only fixture case.');
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
                obligationId: `planning-only-obligation-0${String(repetition + 1)}`,
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
    runId: 'planning-only-runner-test',
    startedAt: '2026-08-01T12:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    measurementScope: 'planning-only',
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });

  expect(run.measurementScope).toBe('planning-only');
  expect(run.gatePassed).toBeTrue();
  expect(run.reliability.findingJaccard).toBeNull();
  expect(run.trials).toHaveLength(2);
  expect(run.trials.every((trial) => trial.status === 'completed')).toBe(true);
  expect(
    run.trials.every(
      (trial) => trial.planScore?.scopedScenarioCount === trial.planScore?.expectedScenarioCount,
    ),
  ).toBe(true);
  expect(run.trials.every((trial) => trial.planScore?.relevantPathCoverage === 1)).toBe(true);
  expect(run.trials.every((trial) => trial.findingScore === null)).toBe(true);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).toEqual(['planning', 'planning']);
  expect(provider.requests).toHaveLength(4);
});

test('retains incomplete trials without another provider call until unfinished recovery is requested', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
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

test('reuses a truly completed reviewed-plan trial without another provider call', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
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
    planProfile: 'reviewed-plan',
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
  expect(first.evidenceQualification).toBe('diagnostic');
  expect(first.gatePassed).toBe(false);
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
    planProfile: 'reviewed-plan',
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
  const pack = await loadCorpusPack('evaluation/corpora');
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
    planProfile: 'reviewed-plan',
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
      planProfile: 'reviewed-plan',
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
  const pack = await loadCorpusPack('evaluation/corpora');
  const provider = new FakeModelProvider();
  await enqueueDeterministicCorpusResponses(
    deterministicCorpusFixturePack(pack),
    'development',
    1,
    {
      enqueue: (response) => provider.enqueueObject(response),
    },
    'reviewed-plan',
  );
  const run = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'deterministic-golden-fixture',
    model: 'fake-model',
    split: 'development',
    repetitions: 1,
    planProfile: 'reviewed-plan',
    runId: 'reviewed-plan-runner-test',
    startedAt: '2026-07-29T12:00:00.000Z',
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  expect(run.gatePassed).toBe(false);
  expect(run.planProfile).toBe('reviewed-plan');
  expect(run.reliability.planJaccard).toBeNull();
  expect(run.trials.every((trial) => trial.planScore === null)).toBe(true);
  expect(run.trials.every((trial) => trial.reviewedPlanFingerprint !== null)).toBe(true);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).not.toContain('planning');
  expect(provider.requests).toHaveLength(run.trials.length * 2);
});

test('reuses a generated-plan checkpoint before dispatching audit work', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (loaded === undefined) throw new Error('Missing generated-plan recovery fixture case.');
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
    planProfile: 'generated-plan',
    runId: 'generated-plan-recovery-runner-test',
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
  expect(run.trials.every((trial) => trial.planScore !== null)).toBe(true);
  expect(
    run.trials.flatMap((trial) => trial.modelObservation?.stages.map((stage) => stage.stage) ?? []),
  ).not.toContain('planning');
});

test('retains completed planning telemetry when a later evaluator persistence step fails', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
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
    planProfile: 'generated-plan',
    runId: 'generated-plan-terminal-telemetry-test',
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
  const pack = await loadCorpusPack('evaluation/corpora');
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
    planProfile: 'reviewed-plan',
    runId: 'failed-map-stage-diagnostic-test',
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: 1,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    auditCheckpoints: failingCheckpoints,
  });

  expect(run.trials.every((trial) => trial.status === 'failed')).toBe(true);
  expect(run.trials.every((trial) => trial.findingScore === null)).toBe(true);
  expect(run.trials.every((trial) => trial.reviewRequiredScore === null)).toBe(true);
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

test('rejects an empty selected split before constructing any workflow work', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
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
  const pack = await loadCorpusPack('evaluation/corpora');
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
    planProfile: 'generated-plan',
    runId: 'generated-plan-cancellation-test',
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
          role: 'input',
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
      controlCoverage: [{ obligationId: obligation.obligationId, controlFactIds: [] }],
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
            vectorId: vector.vectorId,
            statement: 'Completed runner fixture hypothesis',
            operationEvidence: {
              factId: 'fixture-operation',
              evidenceIndex: 0,
            },
            unsafeConditionEvidence: {
              factId: 'fixture-input',
              evidenceIndex: 0,
            },
            planObligations: [{ obligationId: obligation.obligationId }],
            evidenceMapFactIds: ['fixture-input', 'fixture-operation'],
            limitations: ['This deterministic fixture is not a provider-quality measurement.'],
          },
        },
      ],
    },
    usage,
    finishReason: 'stop',
  });
  provider.enqueueObject(scopedInspectionResponse());
  provider.enqueueObject({
    object: {
      decision: 'accepted',
      reason: 'The evaluator fixture selected valid bounded map evidence.',
      operationEvidence: { factId: 'fixture-operation', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fixture-input', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No fixture control negates the fixture hypothesis.',
        evidenceSelections: [{ factId: 'fixture-operation', evidenceIndex: 0 }],
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
    },
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
          pattern: '__security_reviewer_completed_runner_fixture_no_match__',
          mode: 'literal',
          caseSensitive: true,
        },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls' as const,
  };
}
