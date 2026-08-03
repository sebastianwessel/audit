import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPlan as createDraftPlan } from '../attack-planning/plan.js';
import type { AuditVectorResult } from '../audit-execution/audit.schema.js';
import { observeModelStage, summarizeModelStages } from '../model-operations/model-operations.js';

import {
  acquireProviderEvaluationLock,
  createEvaluationAuditCheckpointStore,
  createEvaluationExpectedEvidenceTraceCheckpointStore,
  createEvaluationPlanningCheckpointStore,
  evaluatorCheckpointModelStages,
} from './real-world-artifacts.js';

const approvePlan = <T>(plan: T, ..._reviewMetadata: readonly [string, string, string]): T => plan;

test('serializes a provider evaluation run and fails closed for an unresolved lock', async () => {
  const root = join(tmpdir(), `security-reviewer-provider-lock-${crypto.randomUUID()}`);
  const runId = 'provider-lock-test';
  const first = await acquireProviderEvaluationLock(root, runId);
  await expect(acquireProviderEvaluationLock(root, runId)).rejects.toMatchObject({
    code: 'artifact-lease-unavailable',
  });
  await first.release();

  const runDirectory = join(root, runId);
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, '.provider-evaluation.lock'), '999999999\n', 'utf8');
  await expect(acquireProviderEvaluationLock(root, runId)).rejects.toMatchObject({
    code: 'artifact-lease-unavailable',
  });
});

test('reuses an evaluator-private terminal checkpoint only for the exact audit binding', async () => {
  const root = join(tmpdir(), `security-reviewer-evaluator-work-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const draft = createDraftPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'checkpoint-fixture',
    createdAt: '2026-07-31T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review a bounded risk',
        rationale: 'The evaluator needs one approved vector.',
        enabled: true,
        scopeGlobs: ['source.unknown'],
        reviewObligations: [
          {
            obligationId: 'checkpoint-obligation-01',
            riskStatement: 'A bounded source risk may be present.',
            evidenceRequirement: 'The review unit reaches a terminal state.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const plan = approvePlan(
    draft,
    'fixture-reviewer',
    'Approved for evaluator checkpoint coverage.',
    '2026-07-31T12:00:00.000Z',
  );
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('The fixture needs one vector.');
  const binding = {
    runId: 'evaluation-trial-audit-01',
    planId: plan.planId,
    targetFingerprint: plan.targetFingerprint,
    provider: 'fixture-provider',
    model: 'fixture-model',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
  };
  const store = createEvaluationAuditCheckpointStore({
    outputRoot: root,
    evaluationRunId: 'evaluation-run-01',
    candidateGroundingProtocolFingerprint: 'e'.repeat(64),
    savedAt: () => '2026-07-31T12:00:01.000Z',
  });
  const planningStore = createEvaluationPlanningCheckpointStore({
    outputRoot: root,
    evaluationRunId: 'evaluation-run-01',
    configFingerprint: 'f'.repeat(64),
    savedAt: () => '2026-07-31T12:00:01.000Z',
  });
  const traceStore = createEvaluationExpectedEvidenceTraceCheckpointStore({
    outputRoot: root,
    evaluationRunId: 'evaluation-run-01',
    savedAt: () => '2026-07-31T12:00:01.000Z',
  });
  const traceBinding = {
    trialId: 'evaluation-trial-trace-01',
    planId: plan.planId,
    planDigest: plan.planDigest,
    targetFingerprint: plan.targetFingerprint,
    contextDigest: plan.contextDigest,
    provider: 'fixture-provider',
    model: 'fixture-model',
    verificationRouteFingerprint: 'c'.repeat(64),
    promptProtocolFingerprint: 'e'.repeat(64),
    answerKeyDigest: 'f'.repeat(64),
  };
  await traceStore.save(traceBinding, [
    {
      findingId: 'expected-finding-01',
      role: 'operation',
      planScoped: true,
      mapperSelected: true,
      postureReconciled: false,
      discoverySeeded: false,
      groundingSelected: false,
      verifierSelected: false,
      terminalCompleted: false,
      firstIncompleteStage: 'source-posture',
    },
  ]);
  await expect(traceStore.load(traceBinding)).resolves.toEqual([
    expect.objectContaining({ firstIncompleteStage: 'source-posture' }),
  ]);
  await expect(
    traceStore.load({ ...traceBinding, answerKeyDigest: '0'.repeat(64) }),
  ).rejects.toThrow('does not match');
  await planningStore.save({
    trialId: 'evaluation-trial-plan-01',
    targetFingerprint: draft.targetFingerprint,
    contextDigest: draft.contextDigest,
    plan: draft,
    modelObservation: summarizeModelStages([], {}),
  });
  await expect(
    planningStore.load({
      trialId: 'evaluation-trial-plan-01',
      targetFingerprint: draft.targetFingerprint,
      contextDigest: draft.contextDigest,
    }),
  ).resolves.toMatchObject({ plan: { planId: draft.planId } });
  await expect(
    planningStore.load({
      trialId: 'evaluation-trial-plan-01',
      targetFingerprint: 'c'.repeat(64),
      contextDigest: draft.contextDigest,
    }),
  ).rejects.toThrow('does not match');
  const completedResult: AuditVectorResult = {
    coverage: {
      vectorId: vector.vectorId,
      planned: true,
      completed: true,
      matchedSourcePaths: 1,
      deterministicCandidateCount: 0,
      evidenceMapFactCount: 1,
      evidenceMapUnansweredObligationCount: 0,
      sourcePostureAssessmentCount: 1,
      sourcePostureSupportedCount: 0,
      sourcePostureContradictedCount: 0,
      sourcePostureInconclusiveCount: 1,
      evidenceMapObservation: observeModelStage({
        stage: 'evidence-mapping',
        route: 'primary',
        stageId: 'evaluator-checkpoint-observation',
        status: 'completed',
        durationMs: 1,
        errorCode: null,
        requests: [],
        pricing: {},
        cacheRoutingEnabled: false,
      }),
      findingCount: 0,
      outcome: 'completed',
      errorCode: null,
      limitations: [],
      obligationClosure: [
        {
          obligationId: 'checkpoint-obligation-01',
          planObligation: { obligationId: 'checkpoint-obligation-01' },
          mapState: 'mapped',
          evidenceMapFactCount: 1,
          sourcePostureConclusion: 'inconclusive',
          investigationState: 'no-source-backed-candidate',
          candidateCount: 0,
          admittedFindingCount: 0,
          terminalDisposition: 'no-source-backed-candidate',
        },
      ],
    },
    errors: [],
    proposed: [],
    reviewRequired: [],
  };
  await store.saveVectorResult({ binding, plan, result: completedResult });
  const overflowBase = {
    vectorId: vector.vectorId,
    phase: 'evidence-mapping' as const,
    parentStageId: vector.vectorId,
    recoveryProtocolFingerprint: '1'.repeat(64),
    rootScopeFingerprint: '2'.repeat(64),
  };
  for (const event of [
    { state: 'pending' as const, errorCode: null },
    { state: 'running' as const, errorCode: null },
    { state: 'overflowed' as const, errorCode: 'provider-context-overflow' },
  ]) {
    await store.saveContextOverflowTransition({
      binding,
      plan,
      update: {
        ...overflowBase,
        event: {
          childKey: 'root',
          attempt: 1,
          scopeFingerprint: '3'.repeat(64),
          ...event,
        },
      },
    });
  }
  const loaded = await store.load({ binding, plan, retryUnfinished: true });
  expect(loaded.vectorResults).toHaveLength(1);
  expect(loaded.observedVectorResults).toHaveLength(1);
  expect(loaded.vectorResults[0]?.coverage.vectorId).toBe(vector.vectorId);
  expect(loaded.contextOverflowLedgers).toHaveLength(1);
  expect(loaded.contextOverflowLedgers[0]?.events.map((event) => event.state)).toEqual([
    'pending',
    'running',
    'overflowed',
  ]);
  expect(evaluatorCheckpointModelStages(loaded)).toHaveLength(1);
  const incompleteResult: AuditVectorResult = {
    ...completedResult,
    coverage: {
      ...completedResult.coverage,
      completed: false,
      outcome: 'incomplete',
      errorCode: 'provider-failure',
      obligationClosure: completedResult.coverage.obligationClosure.map((closure) => ({
        ...closure,
        terminalDisposition: 'incomplete',
      })),
    },
  };
  await store.saveVectorResult({ binding, plan, result: incompleteResult });
  const retrying = await store.load({ binding, plan, retryUnfinished: true });
  expect(retrying.vectorResults).toHaveLength(0);
  expect(retrying.observedVectorResults).toEqual([incompleteResult]);
  expect(evaluatorCheckpointModelStages(retrying)).toHaveLength(1);
  await expect(
    store.load({
      binding: { ...binding, model: 'incompatible-model' },
      plan,
      retryUnfinished: true,
    }),
  ).rejects.toThrow('does not match');
  expect(await Bun.file(join(root, 'evaluation-run-01', 'evaluation-run.json')).exists()).toBe(
    false,
  );
});

test('round-trips every evaluator recovery leaf only after its exact topology completes', async () => {
  const root = join(tmpdir(), `security-reviewer-evaluator-leaves-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const draft = createDraftPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'recovery-leaf-fixture',
    createdAt: '2026-08-03T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Recover a bounded review',
        rationale: 'The evaluator needs one recovery-bound vector.',
        enabled: true,
        scopeGlobs: ['source.unknown'],
        reviewObligations: [
          {
            obligationId: 'recovery-obligation-01',
            riskStatement: 'A bounded source risk may be present.',
            evidenceRequirement: 'Recovery must retain validated work exactly.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const plan = approvePlan(
    draft,
    'fixture-reviewer',
    'Approved for evaluator recovery leaf coverage.',
    '2026-08-03T12:00:00.000Z',
  );
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('The fixture needs one vector.');
  const binding = {
    runId: 'evaluation-recovery-leaf-test',
    planId: plan.planId,
    targetFingerprint: plan.targetFingerprint,
    provider: 'fixture-provider',
    model: 'fixture-model',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
  };
  const store = createEvaluationAuditCheckpointStore({
    outputRoot: root,
    evaluationRunId: 'evaluation-run-recovery-leaves',
    candidateGroundingProtocolFingerprint: 'e'.repeat(64),
    savedAt: () => '2026-08-03T12:00:01.000Z',
  });
  const evidenceMapScope = '1'.repeat(64);
  const sourcePostureScope = '2'.repeat(64);
  const groundingScope = '3'.repeat(64);
  const sharedTopology = {
    parentStageId: vector.vectorId,
    recoveryProtocolFingerprint: '4'.repeat(64),
    rootScopeFingerprint: '5'.repeat(64),
    childKey: 'root/left',
  };
  const begin = async (
    phase: 'evidence-mapping' | 'source-posture' | 'candidate-grounding',
    scopeFingerprint: string,
  ) => {
    for (const state of ['pending', 'running'] as const) {
      await store.saveContextOverflowTransition({
        binding,
        plan,
        update: {
          vectorId: vector.vectorId,
          phase,
          ...sharedTopology,
          event: {
            childKey: sharedTopology.childKey,
            attempt: 1,
            scopeFingerprint,
            state,
            errorCode: null,
          },
        },
      });
    }
  };
  const complete = async (
    phase: 'evidence-mapping' | 'source-posture' | 'candidate-grounding',
    scopeFingerprint: string,
  ) =>
    store.saveContextOverflowTransition({
      binding,
      plan,
      update: {
        vectorId: vector.vectorId,
        phase,
        ...sharedTopology,
        event: {
          childKey: sharedTopology.childKey,
          attempt: 1,
          scopeFingerprint,
          state: 'completed',
          errorCode: null,
        },
      },
    });

  await begin('evidence-mapping', evidenceMapScope);
  await store.saveEvidenceMapRecoveryLeaf({
    binding,
    plan,
    update: {
      vectorId: vector.vectorId,
      ...sharedTopology,
      scopeFingerprint: evidenceMapScope,
      evidenceMap: {
        facts: [],
        unansweredPlanObligations: [
          { obligationId: vector.reviewObligations[0]?.obligationId ?? '' },
        ],
        limitations: [],
      },
    },
  });
  await complete('evidence-mapping', evidenceMapScope);

  await begin('source-posture', sourcePostureScope);
  await store.saveSourcePostureRecoveryLeaf({
    binding,
    plan,
    update: {
      vectorId: vector.vectorId,
      ...sharedTopology,
      scopeFingerprint: sourcePostureScope,
      sourcePosture: {
        assessments: [],
        limitations: [],
      },
    },
  });
  await complete('source-posture', sourcePostureScope);

  await begin('candidate-grounding', groundingScope);
  await store.saveCandidateGroundingRecoveryLeaf({
    binding,
    plan,
    update: {
      vectorId: vector.vectorId,
      ...sharedTopology,
      scopeFingerprint: groundingScope,
      groundings: { groundings: [] },
    },
  });
  await complete('candidate-grounding', groundingScope);

  const loaded = await store.load({ binding, plan, retryUnfinished: true });
  expect(loaded.evidenceMapRecoveryLeaves).toHaveLength(1);
  expect(loaded.sourcePostureRecoveryLeaves).toHaveLength(1);
  expect(loaded.candidateGroundingRecoveryLeaves).toHaveLength(1);
  expect(loaded.evidenceMapRecoveryLeaves[0]?.scopeFingerprint).toBe(evidenceMapScope);
  expect(loaded.sourcePostureRecoveryLeaves[0]?.scopeFingerprint).toBe(sourcePostureScope);
  expect(loaded.candidateGroundingRecoveryLeaves[0]?.scopeFingerprint).toBe(groundingScope);
});
