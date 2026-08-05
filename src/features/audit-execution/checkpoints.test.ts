import { expect, test } from 'bun:test';

import { createPlan as createDraftPlan, resealPlan } from '../attack-planning/plan.js';
import { observeModelStage } from '../model-operations/model-operations.js';
import {
  emptyCandidateIntegrityRejectionLedger,
  emptyHypothesisGroundingFunnel,
} from './admission/funnel.js';
import {
  auditCandidateAwareCheckpointPath,
  auditCandidateGroundingDraftPath,
  auditCandidateGroundingRecoveryLeafPath,
  auditCheckpointPath,
  auditContextOverflowLedgerPath,
  auditEvidenceMapRecoveryLeafPath,
  auditSourcePostureDraftPath,
  auditSourcePostureRecoveryLeafPath,
  createAuditCandidateAwareCheckpoint,
  createAuditCandidateGroundingDraft,
  createAuditCandidateGroundingRecoveryLeaf,
  createAuditCheckpointBinding,
  createAuditContextOverflowLedger,
  createAuditEvidenceMapRecoveryLeaf,
  createAuditResumeState,
  createAuditSourcePostureDraft,
  createAuditSourcePostureRecoveryLeaf,
  createAuditVectorCheckpoint,
  loadReusableAuditCandidateAwareCheckpoints,
  loadReusableAuditCandidateGroundingDrafts,
  loadReusableAuditCandidateGroundingRecoveryLeaves,
  loadReusableAuditContextOverflowLedgers,
  loadReusableAuditEvidenceMapRecoveryLeaves,
  loadReusableAuditSourcePostureDrafts,
  loadReusableAuditSourcePostureRecoveryLeaves,
  loadReusableAuditVectorResults,
  reusableContextOverflowModelStages,
} from './checkpoints.js';

function checkpointNarrative() {
  return {
    statement: 'The reviewed operation may be reached with an unsafe condition.',
    roleExplanations: [
      { role: 'operation' as const, explanation: 'The operation evidence identifies the action.' },
      {
        role: 'unsafe-condition' as const,
        explanation: 'The condition evidence identifies the unsafe state.',
      },
    ],
    limitations: [],
  };
}

const targetFingerprint = 'a'.repeat(64);
const contextDigest = 'b'.repeat(64);
const phaseInputFingerprint = 'f'.repeat(64);
const approvePlan = <T>(plan: T, ..._reviewMetadata: readonly [string, string, string]): T => plan;

const plan = approvePlan(
  createDraftPlan({
    targetFingerprint,
    contextDigest,
    targetDisplayName: 'fixture',
    inventorySummary: { fileCount: 1, totalBytes: 42, languageHints: ['typescript'] },
    createdAt: '2026-07-29T12:00:00.000Z',
    vectors: [
      {
        title: 'Review query injection',
        rationale: 'Queries can process untrusted data.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'checkpoint-obligation-01',
            riskStatement: 'Untrusted query data may reach construction without parameterization.',
            evidenceRequirement: 'The review identifies source-backed unsafe query evidence.',
          },
        ],
        limitations: [],
      },
    ],
  }),
  'reviewer',
  'Approved.',
  '2026-07-29T12:01:00.000Z',
);

const vector = plan.vectors[0];
if (vector === undefined) throw new Error('Missing fixture vector.');

const baseBinding = {
  runId: 'audit-run-01',
  planId: plan.planId,
  targetFingerprint,
  provider: 'openai',
  model: 'fixture-model',
  verificationRouteFingerprint: 'c'.repeat(64),
  evidenceMapProtocolFingerprint: 'd'.repeat(64),
  reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
};

const binding = createAuditCheckpointBinding({
  binding: baseBinding,
  plan,
  vectorId: vector.vectorId,
});

const result = {
  coverage: {
    vectorId: vector.vectorId,
    planned: true,
    completed: true,
    matchedSourcePaths: 1,
    evidenceMapFactCount: vector.reviewObligations.length,
    evidenceMapUnansweredObligationCount: 0,
    sourcePostureAssessmentCount: vector.reviewObligations.length,
    sourcePostureSupportedCount: vector.reviewObligations.length,
    sourcePostureContradictedCount: 0,
    sourcePostureInconclusiveCount: 0,
    findingCount: 0,
    outcome: 'completed' as const,
    errorCode: null,
    limitations: [],
    obligationClosure: vector.reviewObligations.map((obligation) => ({
      obligationId: obligation.obligationId,
      planObligation: { obligationId: obligation.obligationId },
      mapState: 'mapped' as const,
      evidenceMapFactCount: 1,
      sourcePostureConclusion: 'risk-supported' as const,
      investigationState: 'no-source-backed-candidate' as const,
      candidateCount: 0,
      admittedFindingCount: 0,
      terminalDisposition: 'no-source-backed-candidate' as const,
    })),
  },
  errors: [],
  proposed: [],
  reviewRequired: [],
};

test('creates and reloads a matching vector checkpoint by its exact binding', async () => {
  const checkpoint = createAuditVectorCheckpoint({
    binding,
    plan,
    result,
    savedAt: '2026-07-29T12:02:00.000Z',
  });
  const reusable = await loadReusableAuditVectorResults({
    binding: baseBinding,
    plan,
    retryUnfinished: false,
    reader: async (path) =>
      path === auditCheckpointPath(binding.runId, binding.vectorId) ? checkpoint : undefined,
  });
  expect(reusable).toEqual([result]);
});

test('loads a context-overflow topology only under its exact sealed vector binding', async () => {
  const ledger = createAuditContextOverflowLedger({
    binding,
    plan,
    phase: 'evidence-mapping',
    parentStageId: vector.vectorId,
    phaseInputFingerprint,
    recoveryProtocolFingerprint: '1'.repeat(64),
    rootScopeFingerprint: '2'.repeat(64),
    events: [
      {
        ordinal: 1,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: '2'.repeat(64),
        state: 'pending',
        errorCode: null,
        savedAt: '2026-08-03T12:00:00.000Z',
      },
      {
        ordinal: 2,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: '2'.repeat(64),
        state: 'running',
        errorCode: null,
        savedAt: '2026-08-03T12:00:01.000Z',
      },
      {
        ordinal: 3,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: '2'.repeat(64),
        state: 'overflowed',
        errorCode: 'provider-context-overflow',
        execution: {
          kind: 'provider',
          modelObservation: observeModelStage({
            stage: 'evidence-mapping',
            route: 'primary',
            stageId: 'overflow-topology-01',
            status: 'failed',
            durationMs: 1,
            errorCode: 'provider-context-overflow',
            requests: [],
            pricing: {},
            cacheRoutingEnabled: false,
          }),
        },
        savedAt: '2026-08-03T12:00:02.000Z',
      },
      {
        ordinal: 4,
        childKey: 'root/left',
        attempt: 1,
        scopeFingerprint: '3'.repeat(64),
        state: 'pending',
        errorCode: null,
        savedAt: '2026-08-03T12:00:03.000Z',
      },
      {
        ordinal: 5,
        childKey: 'root/left',
        attempt: 1,
        scopeFingerprint: '3'.repeat(64),
        state: 'running',
        errorCode: null,
        savedAt: '2026-08-03T12:00:04.000Z',
      },
      {
        ordinal: 6,
        childKey: 'root/left',
        attempt: 1,
        scopeFingerprint: '3'.repeat(64),
        state: 'completed',
        errorCode: null,
        execution: {
          kind: 'provider',
          modelObservation: observeModelStage({
            stage: 'evidence-mapping',
            route: 'primary',
            stageId: `${vector.vectorId}:recovered-child`,
            status: 'completed',
            durationMs: 1,
            errorCode: null,
            requests: [],
            pricing: {},
            cacheRoutingEnabled: false,
          }),
        },
        savedAt: '2026-08-03T12:00:05.000Z',
      },
    ],
  });
  expect(
    reusableContextOverflowModelStages({
      ledgers: [ledger],
      terminalVectorResults: [],
      evidenceMapDrafts: [],
      sourcePostureDrafts: [],
      candidateGroundingDrafts: [],
    }),
  ).toHaveLength(2);
  expect(
    reusableContextOverflowModelStages({
      ledgers: [ledger],
      terminalVectorResults: [result],
      evidenceMapDrafts: [],
      sourcePostureDrafts: [],
      candidateGroundingDrafts: [],
    }),
  ).toEqual([]);
  const reader = async (path: string) =>
    path ===
    auditContextOverflowLedgerPath({
      runId: binding.runId,
      vectorId: binding.vectorId,
      phase: 'evidence-mapping',
    })
      ? ledger
      : undefined;
  await expect(
    loadReusableAuditContextOverflowLedgers({ binding: baseBinding, plan, reader }),
  ).resolves.toEqual([ledger]);
  await expect(
    loadReusableAuditContextOverflowLedgers({
      binding: { ...baseBinding, model: 'another-model' },
      plan,
      reader,
    }),
  ).rejects.toMatchObject({ code: 'artifact-invalid' });
});

test('reuses only an exact validated evidence-map recovery leaf linked to a completed topology', async () => {
  const rootScopeFingerprint = '4'.repeat(64);
  const scopeFingerprint = '5'.repeat(64);
  const ledger = createAuditContextOverflowLedger({
    binding,
    plan,
    phase: 'evidence-mapping',
    parentStageId: vector.vectorId,
    phaseInputFingerprint,
    recoveryProtocolFingerprint: '6'.repeat(64),
    rootScopeFingerprint,
    events: [
      {
        ordinal: 1,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: rootScopeFingerprint,
        state: 'pending',
        errorCode: null,
        savedAt: '2026-08-03T12:00:00.000Z',
      },
      {
        ordinal: 2,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: rootScopeFingerprint,
        state: 'running',
        errorCode: null,
        savedAt: '2026-08-03T12:00:01.000Z',
      },
      {
        ordinal: 3,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: rootScopeFingerprint,
        state: 'overflowed',
        errorCode: 'provider-context-overflow',
        execution: {
          kind: 'provider',
          modelObservation: observeModelStage({
            stage: 'evidence-mapping',
            route: 'primary',
            stageId: 'overflow-evidence-map-leaf-01',
            status: 'failed',
            durationMs: 1,
            errorCode: 'provider-context-overflow',
            requests: [],
            pricing: {},
            cacheRoutingEnabled: false,
          }),
        },
        savedAt: '2026-08-03T12:00:02.000Z',
      },
      {
        ordinal: 4,
        childKey: 'root/left',
        attempt: 1,
        scopeFingerprint,
        state: 'pending',
        errorCode: null,
        savedAt: '2026-08-03T12:00:03.000Z',
      },
      {
        ordinal: 5,
        childKey: 'root/left',
        attempt: 1,
        scopeFingerprint,
        state: 'running',
        errorCode: null,
        savedAt: '2026-08-03T12:00:04.000Z',
      },
      {
        ordinal: 6,
        childKey: 'root/left',
        attempt: 1,
        scopeFingerprint,
        state: 'completed',
        errorCode: null,
        execution: { kind: 'deterministic' },
        savedAt: '2026-08-03T12:00:05.000Z',
      },
    ],
  });
  const leaf = createAuditEvidenceMapRecoveryLeaf({
    binding,
    plan,
    phase: 'evidence-mapping',
    parentStageId: vector.vectorId,
    phaseInputFingerprint,
    recoveryProtocolFingerprint: ledger.recoveryProtocolFingerprint,
    rootScopeFingerprint,
    childKey: 'root/left',
    scopeFingerprint,
    execution: { kind: 'deterministic' },
    evidenceMap: {
      facts: [],
      unansweredPlanObligations: [
        { obligationId: vector.reviewObligations[0]?.obligationId ?? '' },
      ],
      limitations: [],
    },
    savedAt: '2026-08-03T12:00:05.000Z',
  });
  const reader = async (path: string) =>
    path ===
    auditEvidenceMapRecoveryLeafPath({
      runId: binding.runId,
      vectorId: binding.vectorId,
      phase: 'evidence-mapping',
      phaseInputFingerprint,
      scopeFingerprint,
    })
      ? leaf
      : undefined;
  await expect(
    loadReusableAuditEvidenceMapRecoveryLeaves({
      binding: baseBinding,
      plan,
      ledgers: [ledger],
      reader,
    }),
  ).resolves.toEqual([leaf]);
});

test('reuses only an exact validated source-posture leaf linked to a completed topology', async () => {
  const rootScopeFingerprint = '7'.repeat(64);
  const scopeFingerprint = '8'.repeat(64);
  const ledger = createAuditContextOverflowLedger({
    binding,
    plan,
    phase: 'source-posture',
    parentStageId: vector.vectorId,
    phaseInputFingerprint,
    recoveryProtocolFingerprint: '9'.repeat(64),
    rootScopeFingerprint,
    events: [
      {
        ordinal: 1,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint,
        state: 'pending',
        errorCode: null,
        savedAt: '2026-08-03T12:00:00.000Z',
      },
      {
        ordinal: 2,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint,
        state: 'running',
        errorCode: null,
        savedAt: '2026-08-03T12:00:01.000Z',
      },
      {
        ordinal: 3,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint,
        state: 'completed',
        errorCode: null,
        execution: { kind: 'deterministic' },
        savedAt: '2026-08-03T12:00:02.000Z',
      },
    ],
  });
  const leaf = createAuditSourcePostureRecoveryLeaf({
    binding,
    plan,
    parentStageId: vector.vectorId,
    phaseInputFingerprint,
    recoveryProtocolFingerprint: ledger.recoveryProtocolFingerprint,
    rootScopeFingerprint,
    childKey: 'root',
    scopeFingerprint,
    execution: { kind: 'deterministic' },
    sourcePosture: {
      assessments: [
        {
          assessmentId: 'posture-test-01',
          obligationId: vector.reviewObligations[0]?.obligationId ?? '',
          conclusion: 'inconclusive',
          evidenceMapFactIds: ['map-fact-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    savedAt: '2026-08-03T12:00:02.000Z',
  });
  const reader = async (path: string) =>
    path ===
    auditSourcePostureRecoveryLeafPath({
      runId: binding.runId,
      vectorId: binding.vectorId,
      phaseInputFingerprint,
      scopeFingerprint,
    })
      ? leaf
      : undefined;
  await expect(
    loadReusableAuditSourcePostureRecoveryLeaves({
      binding: baseBinding,
      plan,
      ledgers: [ledger],
      reader,
    }),
  ).resolves.toEqual([leaf]);
});

test('reuses only an exact canonical grounding leaf linked to a completed topology', async () => {
  const rootScopeFingerprint = 'a'.repeat(64);
  const scopeFingerprint = 'b'.repeat(64);
  const ledger = createAuditContextOverflowLedger({
    binding,
    plan,
    phase: 'candidate-grounding',
    parentStageId: vector.vectorId,
    phaseInputFingerprint,
    recoveryProtocolFingerprint: 'c'.repeat(64),
    rootScopeFingerprint,
    events: [
      {
        ordinal: 1,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint,
        state: 'completed',
        errorCode: null,
        execution: { kind: 'deterministic' },
        savedAt: '2026-08-03T12:00:00.000Z',
      },
    ],
  });
  const leaf = createAuditCandidateGroundingRecoveryLeaf({
    binding,
    plan,
    parentStageId: vector.vectorId,
    phaseInputFingerprint,
    recoveryProtocolFingerprint: ledger.recoveryProtocolFingerprint,
    rootScopeFingerprint,
    childKey: 'root',
    scopeFingerprint,
    execution: { kind: 'deterministic' },
    groundings: { groundings: [] },
    savedAt: '2026-08-03T12:00:00.000Z',
  });
  const reader = async (path: string) =>
    path ===
    auditCandidateGroundingRecoveryLeafPath({
      runId: binding.runId,
      vectorId: binding.vectorId,
      phaseInputFingerprint,
      scopeFingerprint,
    })
      ? leaf
      : undefined;
  await expect(
    loadReusableAuditCandidateGroundingRecoveryLeaves({
      binding: baseBinding,
      plan,
      ledgers: [ledger],
      reader,
    }),
  ).resolves.toEqual([leaf]);
});

test('fails closed instead of reusing a checkpoint from another model', async () => {
  const checkpoint = createAuditVectorCheckpoint({
    binding,
    plan,
    result,
    savedAt: '2026-07-29T12:02:00.000Z',
  });
  await expect(
    loadReusableAuditVectorResults({
      binding: baseBinding,
      plan,
      retryUnfinished: false,
      reader: async () => ({ ...checkpoint, model: 'different-model' }),
    }),
  ).rejects.toThrow('does not match');
});

test('refuses to create a checkpoint with a stale sealed vector identity', () => {
  expect(() =>
    createAuditVectorCheckpoint({
      binding: { ...binding, vectorDigest: 'f'.repeat(64) },
      plan,
      result,
      savedAt: '2026-07-29T12:02:00.000Z',
    }),
  ).toThrow('does not match');
});

test('fails closed instead of reusing a checkpoint from another verifier route', async () => {
  const checkpoint = createAuditVectorCheckpoint({
    binding,
    plan,
    result,
    savedAt: '2026-07-29T12:02:00.000Z',
  });
  await expect(
    loadReusableAuditVectorResults({
      binding: { ...baseBinding, verificationRouteFingerprint: 'd'.repeat(64) },
      plan,
      retryUnfinished: false,
      reader: async () => checkpoint,
    }),
  ).rejects.toThrow('does not match');
});

test('fails closed instead of reusing a checkpoint after workflow protocol drift', async () => {
  const checkpoint = createAuditVectorCheckpoint({
    binding,
    plan,
    result,
    savedAt: '2026-07-29T12:02:00.000Z',
  });
  await expect(
    loadReusableAuditVectorResults({
      binding: { ...baseBinding, reviewWorkflowProtocolFingerprint: 'f'.repeat(64) },
      plan,
      retryUnfinished: false,
      reader: async () => checkpoint,
    }),
  ).rejects.toThrow('does not match');
});

test('rejects checkpoint reuse for every behavior-affecting identity mutation', async () => {
  const obligation = vector.reviewObligations[0];
  if (obligation === undefined)
    throw new Error('The fixture vector requires one review obligation.');
  const checkpoint = createAuditVectorCheckpoint({
    binding,
    plan,
    result,
    savedAt: '2026-08-04T12:02:00.000Z',
  });
  const reader = async () => checkpoint;
  const bindingMutations = [
    { label: 'target snapshot', binding: { ...baseBinding, targetFingerprint: '1'.repeat(64) } },
    { label: 'provider', binding: { ...baseBinding, provider: 'another-provider' } },
    { label: 'model', binding: { ...baseBinding, model: 'another-model' } },
    {
      label: 'verification route',
      binding: { ...baseBinding, verificationRouteFingerprint: '2'.repeat(64) },
    },
    {
      label: 'evidence-map protocol',
      binding: { ...baseBinding, evidenceMapProtocolFingerprint: '3'.repeat(64) },
    },
    {
      label: 'workflow protocol',
      binding: { ...baseBinding, reviewWorkflowProtocolFingerprint: '4'.repeat(64) },
    },
  ];
  for (const mutation of bindingMutations) {
    await expect(
      loadReusableAuditVectorResults({
        binding: mutation.binding,
        plan,
        retryUnfinished: false,
        reader,
      }),
      mutation.label,
    ).rejects.toThrow('does not match');
  }

  const changedPlans = [
    resealPlan({
      ...plan,
      contextDigest: '5'.repeat(64),
    }),
    resealPlan({
      ...plan,
      vectors: [
        {
          ...vector,
          scopeGlobs: ['app/**'],
        },
      ],
    }),
    resealPlan({
      ...plan,
      vectors: [
        {
          ...vector,
          reviewObligations: [
            {
              ...obligation,
              riskStatement: 'A changed approved risk statement must invalidate checkpoint reuse.',
            },
          ],
        },
      ],
    }),
  ];
  for (const changedPlan of changedPlans) {
    await expect(
      loadReusableAuditVectorResults({
        binding: {
          ...baseBinding,
          planId: changedPlan.planId,
          targetFingerprint: changedPlan.targetFingerprint,
        },
        plan: changedPlan,
        retryUnfinished: false,
        reader,
      }),
    ).rejects.toThrow('does not match');
  }
});

test('retries incomplete terminal work only when unfinished recovery is explicitly requested', async () => {
  const incompleteResult = {
    ...result,
    coverage: {
      ...result.coverage,
      completed: false,
      outcome: 'incomplete' as const,
      errorCode: 'provider-failure',
      obligationClosure: result.coverage.obligationClosure.map((closure) => ({
        ...closure,
        terminalDisposition: 'incomplete' as const,
      })),
    },
  };
  const checkpoint = createAuditVectorCheckpoint({
    binding,
    plan,
    result: incompleteResult,
    savedAt: '2026-07-29T12:02:00.000Z',
  });
  const reader = async (path: string) =>
    path === auditCheckpointPath(binding.runId, binding.vectorId) ? checkpoint : undefined;
  await expect(
    loadReusableAuditVectorResults({
      binding: baseBinding,
      plan,
      retryUnfinished: false,
      reader,
    }),
  ).resolves.toEqual([incompleteResult]);
  await expect(
    loadReusableAuditVectorResults({
      binding: baseBinding,
      plan,
      retryUnfinished: true,
      reader,
    }),
  ).resolves.toEqual([]);
});

test('retries cancelled terminal work only when unfinished recovery is explicitly requested', async () => {
  const cancelledResult = {
    ...result,
    coverage: {
      ...result.coverage,
      completed: false,
      outcome: 'cancelled' as const,
      errorCode: 'provider-cancelled',
      obligationClosure: result.coverage.obligationClosure.map((closure) => ({
        ...closure,
        terminalDisposition: 'not-reached' as const,
      })),
    },
  };
  const checkpoint = createAuditVectorCheckpoint({
    binding,
    plan,
    result: cancelledResult,
    savedAt: '2026-07-29T12:02:00.000Z',
  });
  const reader = async (path: string) =>
    path === auditCheckpointPath(binding.runId, binding.vectorId) ? checkpoint : undefined;
  await expect(
    loadReusableAuditVectorResults({
      binding: baseBinding,
      plan,
      retryUnfinished: false,
      reader,
    }),
  ).resolves.toEqual([cancelledResult]);
  await expect(
    loadReusableAuditVectorResults({
      binding: baseBinding,
      plan,
      retryUnfinished: true,
      reader,
    }),
  ).resolves.toEqual([]);
});

test('reuses only a matching canonical candidate-grounding draft', async () => {
  const candidateGroundingProtocolFingerprint = 'e'.repeat(64);
  const draft = createAuditCandidateGroundingDraft({
    binding,
    candidateGroundingProtocolFingerprint,
    plan,
    evidenceMapFingerprint: '1'.repeat(64),
    sourcePostureFingerprint: '2'.repeat(64),
    groundings: {
      groundings: [
        {
          seedId: 'checkpoint-seed-01',
          disposition: 'grounded',
          hypothesis: {
            vectorId: vector.vectorId,
            narrative: checkpointNarrative(),
            claimEvidenceBundles: [
              {
                role: 'operation',
                evidence: [
                  {
                    path: 'src/query.ts',
                    startLine: 1,
                    contentDigest: 'a'.repeat(64),
                    kind: 'source',
                    role: 'operation',
                  },
                ],
              },
              {
                role: 'unsafe-condition',
                evidence: [
                  {
                    path: 'src/query.ts',
                    startLine: 1,
                    contentDigest: 'a'.repeat(64),
                    kind: 'source',
                    role: 'unsafe-condition',
                  },
                ],
              },
            ],
            planObligations: [{ obligationId: 'checkpoint-obligation-01' }],
            evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
            claimEvidenceSelections: [
              { role: 'operation', selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }] },
              {
                role: 'unsafe-condition',
                selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
              },
            ],
            sourcePostureAssessmentIds: ['posture-question-01'],
          },
        },
      ],
    },
    closures: [
      {
        planObligation: { obligationId: 'checkpoint-obligation-01' },
        disposition: 'candidate-raised',
        evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
        sourcePostureAssessmentIds: ['posture-question-01'],
        limitations: [],
      },
    ],
    hypothesisGroundingFunnel: emptyHypothesisGroundingFunnel(),
    candidateIntegrityRejections: emptyCandidateIntegrityRejectionLedger(),
    discoveryObservation: observeModelStage({
      stage: 'investigation',
      stageId: 'checkpoint-discovery-01',
      route: 'primary',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [],
      pricing: {},
      cacheRoutingEnabled: false,
    }),
    modelObservation: observeModelStage({
      stage: 'candidate-grounding',
      stageId: 'checkpoint-grounding-01',
      route: 'primary',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [],
      pricing: {},
      cacheRoutingEnabled: false,
    }),
    savedAt: '2026-07-30T12:02:00.000Z',
  });
  const reader = async (path: string) =>
    path === auditCandidateGroundingDraftPath(binding.runId, binding.vectorId) ? draft : undefined;
  await expect(
    loadReusableAuditCandidateGroundingDrafts({
      binding: baseBinding,
      candidateGroundingProtocolFingerprint,
      plan,
      reader,
    }),
  ).resolves.toEqual([draft]);
  await expect(
    loadReusableAuditCandidateGroundingDrafts({
      binding: baseBinding,
      candidateGroundingProtocolFingerprint: 'f'.repeat(64),
      plan,
      reader,
    }),
  ).rejects.toThrow('does not match');
});

test('reuses only an exact completed candidate-aware result and reschedules interrupted work', async () => {
  const candidateGroundingProtocolFingerprint = 'e'.repeat(64);
  const draft = createAuditCandidateGroundingDraft({
    binding,
    candidateGroundingProtocolFingerprint,
    plan,
    evidenceMapFingerprint: '1'.repeat(64),
    sourcePostureFingerprint: '2'.repeat(64),
    groundings: {
      groundings: [
        {
          seedId: 'checkpoint-seed-01',
          disposition: 'grounded',
          hypothesis: {
            vectorId: vector.vectorId,
            narrative: checkpointNarrative(),
            claimEvidenceBundles: [
              {
                role: 'operation',
                evidence: [
                  {
                    path: 'src/query.ts',
                    startLine: 1,
                    contentDigest: 'a'.repeat(64),
                    kind: 'source',
                    role: 'operation',
                  },
                ],
              },
              {
                role: 'unsafe-condition',
                evidence: [
                  {
                    path: 'src/query.ts',
                    startLine: 1,
                    contentDigest: 'a'.repeat(64),
                    kind: 'source',
                    role: 'unsafe-condition',
                  },
                ],
              },
            ],
            planObligations: [{ obligationId: 'checkpoint-obligation-01' }],
            evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
            claimEvidenceSelections: [
              { role: 'operation', selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }] },
              {
                role: 'unsafe-condition',
                selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
              },
            ],
            sourcePostureAssessmentIds: ['posture-question-01'],
          },
        },
      ],
    },
    closures: [
      {
        planObligation: { obligationId: 'checkpoint-obligation-01' },
        disposition: 'candidate-raised',
        evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
        sourcePostureAssessmentIds: ['posture-question-01'],
        limitations: [],
      },
    ],
    hypothesisGroundingFunnel: emptyHypothesisGroundingFunnel(),
    candidateIntegrityRejections: emptyCandidateIntegrityRejectionLedger(),
    discoveryObservation: observeModelStage({
      stage: 'investigation',
      stageId: 'checkpoint-discovery-02',
      route: 'primary',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [],
      pricing: {},
      cacheRoutingEnabled: false,
    }),
    modelObservation: observeModelStage({
      stage: 'candidate-grounding',
      stageId: 'checkpoint-grounding-02',
      route: 'primary',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [],
      pricing: {},
      cacheRoutingEnabled: false,
    }),
    savedAt: '2026-07-30T12:02:00.000Z',
  });
  const candidate =
    draft.groundings.groundings[0]?.disposition === 'grounded'
      ? draft.groundings.groundings[0].hypothesis
      : undefined;
  if (candidate === undefined) throw new Error('Missing canonical candidate.');
  const completed = createAuditCandidateAwareCheckpoint({
    binding,
    candidateGroundingProtocolFingerprint,
    plan,
    phase: 'verification',
    candidateOrdinal: 1,
    candidate,
    evidenceMapFingerprint: draft.evidenceMapFingerprint,
    sourcePostureFingerprint: draft.sourcePostureFingerprint,
    state: 'completed',
    result: {
      decision: 'rejected',
      reasonCode: 'claim-contradicted',
      claimEvidenceBundles: null,
      contradictionEvidence: [
        {
          path: 'src/query.ts',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
          role: 'counterevidence',
        },
      ],
      inspectedEvidence: [],
      verifiedPlanObligations: [],
      affectedPlanObligations: [{ obligationId: 'checkpoint-obligation-01' }],
      controlAssessment: null,
      obligationReconciliations: [
        {
          planObligation: { obligationId: 'checkpoint-obligation-01' },
          disposition: 'contradicts-claim',
          evidence: [
            {
              path: 'src/query.ts',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'source',
            },
          ],
        },
      ],
      postureReconciliations: [
        {
          assessmentId: 'posture-question-01',
          disposition: 'contradicts-claim',
          evidence: [
            {
              path: 'src/query.ts',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'source',
            },
          ],
        },
      ],
      terminalLane: 'rejected',
      execution: { kind: 'deterministic' },
    },
    savedAt: '2026-07-30T12:03:00.000Z',
  });
  const pending = createAuditCandidateAwareCheckpoint({
    binding,
    candidateGroundingProtocolFingerprint,
    plan,
    phase: 'countercheck',
    candidateOrdinal: 1,
    candidate,
    evidenceMapFingerprint: draft.evidenceMapFingerprint,
    sourcePostureFingerprint: draft.sourcePostureFingerprint,
    state: 'pending',
    savedAt: '2026-07-30T12:03:01.000Z',
  });
  expect(() =>
    createAuditResumeState({ candidateAwareCheckpoints: [completed, completed] }),
  ).toThrow('does not match');
  const reader = async (path: string) => {
    if (
      path ===
      auditCandidateAwareCheckpointPath({
        runId: binding.runId,
        vectorId: binding.vectorId,
        phase: 'verification',
        candidateOrdinal: 1,
      })
    )
      return completed;
    if (
      path ===
      auditCandidateAwareCheckpointPath({
        runId: binding.runId,
        vectorId: binding.vectorId,
        phase: 'countercheck',
        candidateOrdinal: 1,
      })
    )
      return pending;
    return undefined;
  };
  await expect(
    loadReusableAuditCandidateAwareCheckpoints({
      binding: baseBinding,
      candidateGroundingProtocolFingerprint,
      plan,
      drafts: [draft],
      reader,
    }),
  ).resolves.toEqual([completed, pending]);
  await expect(
    loadReusableAuditCandidateAwareCheckpoints({
      binding: baseBinding,
      candidateGroundingProtocolFingerprint,
      plan,
      drafts: [draft],
      reader: async () => ({ ...completed, candidateFingerprint: 'f'.repeat(64) }),
    }),
  ).rejects.toThrow('does not match');
  await expect(
    loadReusableAuditCandidateAwareCheckpoints({
      binding: baseBinding,
      candidateGroundingProtocolFingerprint,
      plan,
      drafts: [draft],
      reader: async () => ({ ...completed, evidenceMapFingerprint: 'f'.repeat(64) }),
    }),
  ).rejects.toThrow('does not match');
  await expect(
    loadReusableAuditCandidateAwareCheckpoints({
      binding: baseBinding,
      candidateGroundingProtocolFingerprint,
      plan,
      drafts: [draft],
      reader: async () => ({ ...completed, sourcePostureFingerprint: 'f'.repeat(64) }),
    }),
  ).rejects.toThrow('does not match');
  const countercheck = {
    ...completed,
    phase: 'countercheck' as const,
    candidateFingerprint: 'f'.repeat(64),
  };
  await expect(
    loadReusableAuditCandidateAwareCheckpoints({
      binding: baseBinding,
      candidateGroundingProtocolFingerprint,
      plan,
      drafts: [draft],
      reader: async (path) =>
        path ===
        auditCandidateAwareCheckpointPath({
          runId: binding.runId,
          vectorId: binding.vectorId,
          phase: 'countercheck',
          candidateOrdinal: 1,
        })
          ? countercheck
          : undefined,
    }),
  ).rejects.toThrow('does not match');
});

test('reuses a matching candidate-blind source posture without rerunning that phase', async () => {
  const draft = createAuditSourcePostureDraft({
    binding,
    plan,
    evidenceMapFingerprint: '1'.repeat(64),
    sourcePosture: {
      assessments: [
        {
          assessmentId: 'posture-question-01',
          obligationId: 'checkpoint-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-input-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    execution: { kind: 'deterministic' },
    savedAt: '2026-07-30T12:02:00.000Z',
  });
  const reusable = await loadReusableAuditSourcePostureDrafts({
    binding: baseBinding,
    plan,
    reader: async (path) =>
      path === auditSourcePostureDraftPath(binding.runId, binding.vectorId) ? draft : undefined,
  });
  expect(reusable).toEqual([draft]);
});
