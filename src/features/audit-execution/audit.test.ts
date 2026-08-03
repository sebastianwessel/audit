import { describe, expect, test } from 'bun:test';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { createPlan as createDraftPlan, resealPlan } from '../attack-planning/plan.js';
import { observeModelStage } from '../model-operations/model-operations.js';
import { modelStagesForAudit } from '../review-workflow/service.js';
import {
  emptyCandidateIntegrityRejectionLedger,
  emptyHypothesisGroundingFunnel,
} from './admission/funnel.js';
import {
  type AuditCandidateGrounder,
  type AuditEvidenceMapper,
  type AuditInvestigator,
  type AuditSourcePostureAssessor,
  auditExitCode,
  type CandidateAwareCheckpointUpdate,
  runAudit as runApprovedAudit,
  runStaticAudit,
} from './audit.js';
import type { AuditEvidenceMapDraft } from './audit.schema.js';
import { createAuditResumeState } from './checkpoints.js';
import type {
  AuditCountercheckRequest,
  AuditVerificationRequest,
} from './verification/contract.js';

const targetFingerprint = 'a'.repeat(64);
const contextDigest = 'b'.repeat(64);
const approvePlan = <T>(plan: T, ..._reviewMetadata: readonly [string, string, string]): T => plan;

function completedStageObservation(
  stage: 'investigation' | 'candidate-grounding',
  stageId: string,
) {
  return observeModelStage({
    stage,
    route: 'primary',
    stageId,
    status: 'completed',
    durationMs: 1,
    errorCode: null,
    requests: [
      {
        durationMs: 1,
        usage: {
          modelCallCount: 1,
          inputTokens: 2,
          outputTokens: 1,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      },
    ],
    pricing: {},
    cacheRoutingEnabled: false,
  });
}

function postureReconciliationsFor(request: AuditVerificationRequest | AuditCountercheckRequest) {
  const facts = new Map(request.evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  return request.sourcePosture.assessments
    .filter((assessment) =>
      request.hypothesis.planObligations.some(
        (obligation) => obligation.obligationId === assessment.obligationId,
      ),
    )
    .map((assessment) => ({
      assessmentId: assessment.assessmentId,
      disposition: 'supports-claim' as const,
      explanation: 'The prior posture aligns with the independently reviewed source.',
      evidence: assessment.evidenceMapFactIds.flatMap((factId) =>
        (facts.get(factId)?.evidence ?? []).map((evidence) => ({
          ...evidence,
          role: 'source' as const,
        })),
      ),
    }));
}

function obligationReconciliationsFor(
  request: AuditVerificationRequest | AuditCountercheckRequest,
) {
  return request.hypothesis.planObligations.map((planObligation) => {
    const fact = request.evidenceMap.facts.find((candidate) =>
      candidate.planObligations.some(
        (reference) => reference.obligationId === planObligation.obligationId,
      ),
    );
    return {
      planObligation,
      disposition: 'supports-claim' as const,
      explanation: 'The independently reviewed source supports this approved obligation.',
      evidence: (fact?.evidence ?? []).map((evidence) => ({
        ...evidence,
        role: 'source' as const,
      })),
    };
  });
}

const acceptVerifier = async (request: AuditVerificationRequest) => ({
  decision: 'accepted' as const,
  reason: 'The hypothesis has been independently verified.',
  verifiedEvidence: request.hypothesis.evidence,
  verifiedPlanObligations: request.hypothesis.planObligations,
  controlAssessment: {
    conclusion: 'no-effective-control-found' as const,
    explanation: 'The scoped source does not show a control that negates this hypothesis.',
    evidence: request.hypothesis.evidence,
  },
  obligationReconciliations: obligationReconciliationsFor(request),
  postureReconciliations: postureReconciliationsFor(request),
});

const acceptCountercheck = async (request: AuditCountercheckRequest) => ({
  decision: 'accepted' as const,
  reason: 'The verifier-reconciled hypothesis remains supported after challenge.',
  verifiedEvidence: request.hypothesis.evidence,
  verifiedPlanObligations: request.hypothesis.planObligations,
  controlAssessment: {
    conclusion: 'no-effective-control-found' as const,
    explanation: 'The scoped source does not show a control that negates this hypothesis.',
    evidence: request.hypothesis.evidence,
  },
  obligationReconciliations: obligationReconciliationsFor(request),
  postureReconciliations: postureReconciliationsFor(request),
});

const mapEvidence: AuditEvidenceMapper = async (request) => ({
  evidenceMap: {
    facts: [
      {
        factId: 'fact-input-01',
        role: 'input' as const,
        statement: 'The scoped source receives the reviewed input.',
        evidence: [
          {
            path: request.availableSourcePaths[0] ?? 'src/query.ts',
            startLine: 1,
            snippet: 'placeholder',
            kind: 'source' as const,
          },
        ],
        planObligations: [{ obligationId: 'audit-obligation-01' }],
      },
      {
        factId: 'fact-query-01',
        role: 'operation' as const,
        statement: 'The scoped source contains the reviewed operation.',
        evidence: [
          {
            path: request.availableSourcePaths[0] ?? 'src/query.ts',
            startLine: 1,
            snippet: 'placeholder',
            kind: 'source' as const,
            role: 'operation' as const,
          },
        ],
        planObligations: [{ obligationId: 'audit-obligation-01' }],
      },
    ],
    controlCoverage: [{ obligationId: 'audit-obligation-01', controlFactIds: [] }],
    unansweredPlanObligations: [],
    limitations: [],
  },
});

const mapEvidenceWithControl: AuditEvidenceMapper = async (request) => {
  const mapped = await mapEvidence(request);
  return {
    ...mapped,
    evidenceMap: {
      ...mapped.evidenceMap,
      facts: [
        ...mapped.evidenceMap.facts,
        {
          factId: 'fact-control-01',
          role: 'control' as const,
          statement: 'The scoped source contains a potentially relevant control.',
          evidence: [
            {
              path: request.availableSourcePaths[0] ?? 'src/query.ts',
              startLine: 1,
              snippet: 'placeholder',
              kind: 'source' as const,
              role: 'guard' as const,
            },
          ],
          planObligations: [{ obligationId: 'audit-obligation-01' }],
        },
      ],
      controlCoverage: [
        { obligationId: 'audit-obligation-01', controlFactIds: ['fact-control-01'] },
      ],
    },
  };
};

const assessSourcePosture: AuditSourcePostureAssessor = async (request) => ({
  sourcePosture: {
    assessments: request.vector.reviewObligations.map((obligation) => ({
      assessmentId: `posture-${obligation.obligationId}`,
      obligationId: obligation.obligationId,
      conclusion: 'risk-supported' as const,
      evidenceMapFactIds: request.evidenceMap.facts
        .filter((fact) =>
          fact.planObligations.some(
            (reference) => reference.obligationId === obligation.obligationId,
          ),
        )
        .map((fact) => fact.factId),
      limitations: [],
    })),
    limitations: [],
  },
});

function closuresFor(
  request: Parameters<AuditInvestigator>[0],
  disposition: 'candidate-raised' | 'no-source-backed-candidate' | 'incomplete',
) {
  return request.vector.reviewObligations.map((obligation) => {
    const evidenceMapFactIds = request.evidenceMap.facts
      .filter((fact) =>
        fact.planObligations.some(
          (reference) => reference.obligationId === obligation.obligationId,
        ),
      )
      .map((fact) => fact.factId);
    const sourcePostureAssessmentIds = request.sourcePosture.assessments
      .filter((assessment) => assessment.obligationId === obligation.obligationId)
      .map((assessment) => assessment.assessmentId);
    return {
      planObligation: { obligationId: obligation.obligationId },
      disposition,
      evidenceMapFactIds,
      sourcePostureAssessmentIds,
      limitations: [],
    };
  });
}

function approvedPlan() {
  return approvePlan(
    createDraftPlan({
      targetFingerprint,
      contextDigest,
      targetDisplayName: 'fixture',
      inventorySummary: { fileCount: 1, totalBytes: 42, languageHints: ['typescript'] },
      createdAt: '2026-07-27T12:00:00.000Z',
      vectors: [
        {
          title: 'Review query injection',
          rationale: 'Queries can process untrusted data.',
          enabled: true,
          scopeGlobs: ['src/**'],
          reviewObligations: [
            {
              obligationId: 'audit-obligation-01',
              riskStatement: 'Untrusted query data could change query semantics.',
              evidenceRequirement:
                'Inspect scoped source evidence for query construction and data handling.',
            },
          ],
          limitations: [],
        },
      ],
    }),
    'reviewer',
    'Approved.',
    '2026-07-27T12:01:00.000Z',
  );
}

function sourceBackedHypothesis(vectorId: string) {
  return {
    vectorId,
    statement: 'Untrusted value reaches a query string',
    evidence: [
      {
        path: 'src/query.ts',
        startLine: 1,
        snippet: 'invented',
        kind: 'source' as const,
        role: 'operation' as const,
      },
      {
        path: 'src/query.ts',
        startLine: 1,
        snippet: 'invented',
        kind: 'source' as const,
        role: 'unsafe-condition' as const,
      },
    ],
    planObligations: [{ obligationId: 'audit-obligation-01' }],
    evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
    sourcePostureAssessmentIds: ['posture-audit-obligation-01'],
    limitations: [],
  };
}

function sourceBackedSeed(
  vectorId: string,
  evidenceMapFactIds: string[] = ['fact-input-01', 'fact-query-01'],
) {
  return {
    seedId: 'seed-query-01',
    vectorId,
    hypothesis: 'A request-controlled value may reach the reviewed query operation.',
    planObligations: [{ obligationId: 'audit-obligation-01' }],
    evidenceMapFactIds,
    sourcePostureAssessmentIds: ['posture-audit-obligation-01'],
    limitations: [],
  };
}

function sourceBackedCanonicalHypothesis(vectorId: string) {
  return sourceBackedHypothesis(vectorId);
}

function sourceBackedGroundingCandidate(vectorId: string) {
  const { evidence: _evidence, ...candidate } = sourceBackedHypothesis(vectorId);
  return {
    ...candidate,
    operationEvidence: { factId: 'fact-query-01', evidenceIndex: 0 },
    unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
  };
}

const groundSeeds: AuditCandidateGrounder = async (request) => ({
  groundings: {
    groundings: request.seeds.map((seed) => ({
      seedId: seed.seedId,
      candidate: {
        ...sourceBackedGroundingCandidate(seed.vectorId),
        evidenceMapFactIds: seed.evidenceMapFactIds,
        sourcePostureAssessmentIds: seed.sourcePostureAssessmentIds,
      },
    })),
  },
});

describe('static audit', () => {
  test('runs only approved vectors and keeps deterministic clues out of findings', async () => {
    const report = await runStaticAudit({
      plan: approvedPlan(),
      targetFingerprint,
      contextDigest,
      sources: [
        {
          path: 'src/query.ts',
          content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
          languageHint: 'typescript',
        },
      ],
      runId: 'run-static-01',
      generatedAt: '2026-07-27T12:02:00.000Z',
    });
    expect(report.findings).toHaveLength(0);
    expect(report.coverage[0]?.outcome).toBe('incomplete');
    expect(auditExitCode(report)).toBe(3);
  });

  test('leaves a vector with no admitted source scope visibly incomplete', async () => {
    const report = await runStaticAudit({
      plan: approvedPlan(),
      targetFingerprint,
      contextDigest,
      sources: [],
      runId: 'run-empty-scope-01',
      generatedAt: '2026-07-27T12:02:00.000Z',
    });
    expect(report.coverage[0]).toMatchObject({
      outcome: 'incomplete',
      completed: false,
      errorCode: 'no-admitted-source-in-scope',
      obligationClosure: [
        {
          terminalDisposition: 'not-reached',
          notApplicableReason: null,
        },
      ],
    });
    expect(auditExitCode(report)).toBe(3);
  });

  test('fails closed when a plan fingerprint does not match', async () => {
    await expect(
      runStaticAudit({
        plan: approvedPlan(),
        targetFingerprint: 'c'.repeat(64),
        contextDigest,
        sources: [],
        runId: 'run-static-02',
        generatedAt: '2026-07-27T12:02:00.000Z',
      }),
    ).rejects.toThrow('does not match');
  });
});

test('keeps plan-order coverage while running independent vectors up to the configured cap', async () => {
  const plan = approvedPlan();
  const first = plan.vectors[0];
  if (first === undefined) throw new Error('Missing first vector.');
  const twoVectorPlan = resealPlan({
    ...plan,
    vectors: [...plan.vectors, { ...first, title: 'Review hard-coded secrets' }],
  });
  let active = 0;
  let maximumActive = 0;
  const report = await runApprovedAudit({
    plan: twoVectorPlan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;
const apiKey = '12345678';`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-concurrent-01',
    generatedAt: '2026-07-27T12:02:00.000Z',
    maxParallelVectors: 2,
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { seeds: [], closures: closuresFor(request, 'no-source-backed-candidate') };
    },
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
  });
  expect(maximumActive).toBe(2);
  expect(report.coverage.map((coverage) => coverage.vectorId)).toEqual(
    twoVectorPlan.vectors.map((vector) => vector.vectorId),
  );
});

test('preserves the true phase when evidence-map checkpoint persistence fails', async () => {
  const plan = approvedPlan();
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: 'const query = request.input;\n',
        languageHint: 'typescript',
      },
    ],
    runId: 'run-evidence-map-persistence-failure-01',
    generatedAt: '2026-08-03T12:00:00.000Z',
    mapEvidence,
    investigate: async () => ({ seeds: [], closures: [] }),
    verify: acceptVerifier,
    onEvidenceMapDraft: async () => {
      throw new SecurityReviewerError(
        'artifact-invalid',
        'Injected checkpoint persistence failure.',
      );
    },
  });
  expect(report.errors).toMatchObject([
    { code: 'artifact-invalid', stage: 'evidence-mapping', retryable: false },
  ]);
  expect(report.coverage[0]).toMatchObject({
    outcome: 'failed',
    errorCode: 'artifact-invalid',
  });
});

test('schedules every verifier and countercheck through one run-wide candidate-aware pool', async () => {
  const plan = approvedPlan();
  const firstVector = plan.vectors[0];
  if (firstVector === undefined) throw new Error('Missing first vector.');
  const twoVectorPlan = resealPlan({
    ...plan,
    vectors: [...plan.vectors, { ...firstVector, title: 'Review another bounded concern' }],
  });
  let activeVerifierCount = 0;
  let maximumActiveVerifierCount = 0;
  let verifierCallCount = 0;
  let activeCountercheckCount = 0;
  let maximumActiveCountercheckCount = 0;
  let countercheckCallCount = 0;
  const report = await runApprovedAudit({
    plan: twoVectorPlan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-candidate-aware-pool-01',
    generatedAt: '2026-08-03T12:00:00.000Z',
    maxParallelVectors: 2,
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: ['one', 'two', 'three'].map((suffix) => ({
        ...sourceBackedSeed(request.vector.vectorId),
        seedId: `seed-query-${suffix}`,
      })),
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: async (request) => ({
      groundings: {
        groundings: request.seeds.map((seed) => ({
          seedId: seed.seedId,
          candidate: {
            ...sourceBackedGroundingCandidate(seed.vectorId),
            statement: `Request-controlled value reaches query (${seed.seedId}).`,
            evidenceMapFactIds: seed.evidenceMapFactIds,
            sourcePostureAssessmentIds: seed.sourcePostureAssessmentIds,
          },
        })),
      },
    }),
    verify: async (request) => {
      verifierCallCount += 1;
      activeVerifierCount += 1;
      maximumActiveVerifierCount = Math.max(maximumActiveVerifierCount, activeVerifierCount);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      activeVerifierCount -= 1;
      return acceptVerifier(request);
    },
    countercheck: async (request) => {
      countercheckCallCount += 1;
      activeCountercheckCount += 1;
      maximumActiveCountercheckCount = Math.max(
        maximumActiveCountercheckCount,
        activeCountercheckCount,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      activeCountercheckCount -= 1;
      return acceptCountercheck(request);
    },
  });

  expect(verifierCallCount).toBe(6);
  expect(countercheckCallCount).toBe(6);
  expect(maximumActiveVerifierCount).toBe(2);
  expect(maximumActiveCountercheckCount).toBe(2);
  expect(report.coverage.reduce((total, coverage) => total + coverage.findingCount, 0)).toBe(6);
});

test('returns partial coverage without promoting deterministic clues when model investigation fails', async () => {
  const report = await runApprovedAudit({
    plan: approvedPlan(),
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-partial-01',
    generatedAt: '2026-07-27T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async () => {
      throw new Error('provider unavailable');
    },
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
  });
  expect(report.findings).toHaveLength(0);
  expect(report.coverage[0]?.outcome).toBe('failed');
  expect(report.errors[0]?.code).toBe('provider-failure');
  expect(auditExitCode(report)).toBe(3);
});

test('preserves a provider-neutral cancellation as a cancelled vector', async () => {
  const report = await runApprovedAudit({
    plan: approvedPlan(),
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-cancelled-01',
    generatedAt: '2026-07-31T14:45:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async () => {
      throw new SecurityReviewerError('provider-cancelled', 'Provider-neutral cancellation.');
    },
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
  });
  expect(report.findings).toHaveLength(0);
  expect(report.coverage[0]?.outcome).toBe('cancelled');
  expect(report.errors[0]?.code).toBe('provider-cancelled');
  expect(auditExitCode(report)).toBe(3);
});

test('passes only scoped source paths to an investigator that returns no claim', async () => {
  let receivedPathCount = -1;
  const report = await runApprovedAudit({
    plan: approvedPlan(),
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-tool-assisted-no-access-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => {
      receivedPathCount = request.availableSourcePaths.length;
      return { seeds: [], closures: closuresFor(request, 'no-source-backed-candidate') };
    },
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
  });
  expect(receivedPathCount).toBe(1);
  expect(report.findings).toHaveLength(0);
  expect(report.errors).toHaveLength(0);
});

test('reuses a validated evidence map and continues at the earliest unfinished phase', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  let mappedCalls = 0;
  let savedMap:
    | Pick<AuditEvidenceMapDraft, 'vectorId' | 'evidenceMap' | 'modelObservation'>
    | undefined;
  const source = [
    {
      path: 'src/query.ts',
      content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
      languageHint: 'typescript',
    },
  ];
  const first = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: source,
    runId: 'run-resume-map-01',
    generatedAt: '2026-07-31T12:00:00.000Z',
    mapEvidence: async (request) => {
      mappedCalls += 1;
      return mapEvidence(request);
    },
    assessSourcePosture: async () => ({
      sourcePosture: {
        assessments: [],
        limitations: ['The first attempt stopped after a valid evidence map.'],
      },
    }),
    investigate: async () => ({ seeds: [], closures: [] }),
    verify: acceptVerifier,
    onEvidenceMapDraft: async (draft) => {
      savedMap = draft;
    },
  });
  expect(first.coverage[0]?.outcome).toBe('incomplete');
  expect(savedMap).toBeDefined();

  const resumed = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: source,
    runId: 'run-resume-map-01',
    generatedAt: '2026-07-31T12:01:00.000Z',
    resumeState: createAuditResumeState({
      evidenceMapDrafts:
        savedMap === undefined
          ? []
          : [
              {
                schemaVersion: 1,
                phase: 'evidence-mapping' as const,
                runId: 'run-resume-map-01',
                planId: plan.planId,
                planDigest: plan.planDigest,
                targetFingerprint,
                provider: 'fixture-provider',
                model: 'fixture-model',
                verificationRouteFingerprint: 'c'.repeat(64),
                evidenceMapProtocolFingerprint: 'd'.repeat(64),
                reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
                vectorDigest: vector.vectorDigest,
                savedAt: '2026-07-31T12:00:01.000Z',
                ...savedMap,
              },
            ],
    }),
    mapEvidence: async () => {
      throw new Error('A matching evidence map must not be generated again.');
    },
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [],
      closures: closuresFor(request, 'no-source-backed-candidate'),
    }),
    verify: acceptVerifier,
  });
  expect(mappedCalls).toBe(1);
  expect(resumed.coverage[0]?.outcome).toBe('completed');
});

test('persists a source-grounded hypothesis only after independent verifier acceptance', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const verifierRequests: string[] = [];
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-verifier-accepted-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request: Parameters<AuditInvestigator>[0]) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => {
      verifierRequests.push(request.verificationId);
      expect(request.hypothesis).toMatchObject({
        vectorId: vector.vectorId,
        evidence: [
          { path: 'src/query.ts', startLine: 1, role: 'operation' },
          { path: 'src/query.ts', startLine: 1, role: 'unsafe-condition' },
        ],
      });
      return {
        decision: 'accepted',
        reason: 'Independent source review supports the hypothesis.',
        verifiedEvidence: request.hypothesis.evidence,
        verifiedPlanObligations: request.hypothesis.planObligations,
        controlAssessment: {
          conclusion: 'no-effective-control-found',
          explanation: 'No scoped control negates the claim.',
          evidence: request.hypothesis.evidence,
        },
        obligationReconciliations: obligationReconciliationsFor(request),
        postureReconciliations: postureReconciliationsFor(request),
      };
    },
  });
  expect(verifierRequests).toEqual([`verification-${vector.vectorId}-1`]);
  expect(report.findings).toHaveLength(1);
  expect(report.coverage[0]?.findingCount).toBe(1);
  expect(report.coverage[0]?.admissionFunnel).toEqual({
    modelCandidateCount: 1,
    integrityRejectedCount: 0,
    toolEvidenceRejectedCount: 0,
    verifierAcceptedCount: 1,
    verifierRejectedCount: 0,
    verifierIncompleteCount: 0,
    verifierToolEvidenceRejectedCount: 0,
    verifierEvidenceRejectedCount: 0,
    verifierReconciledCount: 1,
    postVerificationRejectedCount: 0,
    admittedFindingCount: 1,
    verificationTerminalLanes: {
      accepted: 1,
      rejected: 0,
      modelIncomplete: 0,
      evidenceProjectionInvalid: 0,
      stageFailed: 0,
      inspectionMissing: 0,
      wrapperContractInvalid: 0,
    },
  });
});

test('checkpoints every candidate-aware verifier transition without retaining model rationale', async () => {
  const plan = approvedPlan();
  const updates: Array<Pick<CandidateAwareCheckpointUpdate, 'state' | 'result'>> = [];
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-candidate-aware-checkpoint-01',
    generatedAt: '2026-08-03T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(request.vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: acceptVerifier,
    onCandidateAwareCheckpoint: async (update) => {
      updates.push({
        state: update.state,
        ...(update.result === undefined ? {} : { result: update.result }),
      });
    },
  });
  expect(report.findings).toHaveLength(1);
  expect(updates.map((update) => update.state)).toEqual(['pending', 'running', 'completed']);
  const completed = updates[2];
  expect(completed?.result?.decision).toBe('accepted');
  expect(completed?.result).not.toHaveProperty('reason');
});

test('binds verifier overflow topology to the exact candidate-aware checkpoint', async () => {
  const plan = approvedPlan();
  const updates: CandidateAwareCheckpointUpdate[] = [];
  await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-candidate-aware-overflow-01',
    generatedAt: '2026-08-03T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(request.vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (_request, stageContext) => {
      await stageContext?.onContextOverflowTransition?.({
        recoveryProtocolFingerprint: 'a'.repeat(64),
        rootScopeFingerprint: 'b'.repeat(64),
        event: {
          childKey: 'root',
          attempt: 1,
          scopeFingerprint: 'c'.repeat(64),
          state: 'overflowed',
          errorCode: 'provider-context-overflow',
        },
      });
      return {
        decision: 'incomplete',
        reason: 'The provider context window was exceeded.',
        verifiedEvidence: null,
        verifiedPlanObligations: [],
        controlAssessment: null,
        obligationReconciliations: [],
        postureReconciliations: [],
        terminalLane: 'stage-failed',
      };
    },
    onCandidateAwareCheckpoint: async (update) => {
      updates.push(update);
    },
  });
  const overflowUpdate = updates.find((update) => update.contextOverflowTopology !== undefined);
  expect(overflowUpdate).toMatchObject({
    state: 'running',
    contextOverflowTopology: {
      recoveryProtocolFingerprint: 'a'.repeat(64),
      rootScopeFingerprint: 'b'.repeat(64),
      events: [{ ordinal: 1, childKey: 'root', state: 'overflowed' }],
    },
  });
  expect(updates.at(-1)?.contextOverflowTopology).toEqual(overflowUpdate?.contextOverflowTopology);
});

test('grounds every discovery seed and rejects a changed vector or obligation binding', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const input = {
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: 'const requestValue = request.query.userId;\nexecute(requestValue);',
        languageHint: 'typescript' as const,
      },
    ],
    generatedAt: '2026-07-30T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request: Parameters<AuditInvestigator>[0]) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    verify: acceptVerifier,
  };
  const grounded = await runApprovedAudit({
    ...input,
    runId: 'run-candidate-grounding-accepted-01',
    groundCandidates: async (request) => {
      const seed = request.seeds[0];
      if (seed === undefined) throw new Error('Missing seed.');
      return {
        groundings: {
          groundings: [
            { seedId: seed.seedId, candidate: sourceBackedGroundingCandidate(vector.vectorId) },
          ],
        },
      };
    },
  });
  expect(grounded.findings).toHaveLength(1);
  expect(grounded.coverage[0]?.admissionFunnel).toMatchObject({
    integrityRejectedCount: 0,
    verifierAcceptedCount: 1,
    admittedFindingCount: 1,
  });
  expect(grounded.coverage[0]?.candidateIntegrityRejections).toEqual(
    emptyCandidateIntegrityRejectionLedger(),
  );

  const rejected = await runApprovedAudit({
    ...input,
    runId: 'run-candidate-grounding-binding-rejected-01',
    groundCandidates: async (request) => {
      const seed = request.seeds[0];
      if (seed === undefined) throw new Error('Missing seed.');
      return {
        groundings: {
          groundings: [
            {
              seedId: seed.seedId,
              candidate: {
                ...sourceBackedGroundingCandidate('another-vector'),
                planObligations: seed.planObligations,
              },
            },
          ],
        },
      };
    },
  });
  expect(rejected.findings).toHaveLength(0);
  expect(rejected.coverage[0]?.hypothesisGroundingFunnel).toMatchObject({
    discoveredSeedCount: 1,
    discoveryBindingRejectedCount: 0,
    groundingBindingRejectedCount: 1,
    submittedCandidateCount: 0,
  });
  expect(rejected.coverage[0]?.admissionFunnel).toMatchObject({
    integrityRejectedCount: 0,
    admittedFindingCount: 0,
  });
});

test('rejects an invalid selected map location before candidate admission', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: 'const requestValue = request.query.userId;\nexecute(requestValue);',
        languageHint: 'typescript',
      },
    ],
    runId: 'run-candidate-integrity-ledger-01',
    generatedAt: '2026-07-30T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: async (request) => {
      const seed = request.seeds[0];
      if (seed === undefined) throw new Error('Missing seed.');
      const candidate = sourceBackedGroundingCandidate(vector.vectorId);
      return {
        groundings: {
          groundings: [
            {
              seedId: seed.seedId,
              candidate: {
                ...candidate,
                operationEvidence: { factId: 'fact-query-01', evidenceIndex: 8 },
              },
            },
          ],
        },
      };
    },
    verify: acceptVerifier,
  });
  expect(report.coverage[0]?.hypothesisGroundingFunnel).toMatchObject({
    groundingBindingRejectedCount: 1,
    submittedCandidateCount: 0,
  });
});

test('requires verifier reconciliation of every relevant mapped control before persisting', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const source = [
    {
      path: 'src/query.ts',
      content: 'const requestValue = request.query.userId;\nexecute(requestValue);',
      languageHint: 'typescript' as const,
    },
  ];
  const incomplete = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: source,
    runId: 'run-control-coverage-missing-01',
    generatedAt: '2026-07-30T12:02:00.000Z',
    mapEvidence: mapEvidenceWithControl,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [
        sourceBackedSeed(vector.vectorId, ['fact-input-01', 'fact-query-01', 'fact-control-01']),
      ],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: acceptVerifier,
  });
  expect(incomplete.findings).toHaveLength(0);
  expect(incomplete.errors).toMatchObject([{ code: 'verifier-evidence-rejected' }]);
  expect(incomplete.coverage[0]?.admissionFunnel).toMatchObject({
    verifierAcceptedCount: 1,
    verifierReconciledCount: 0,
    admittedFindingCount: 0,
  });

  const reconciled = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: source,
    runId: 'run-control-coverage-complete-01',
    generatedAt: '2026-07-30T12:02:00.000Z',
    mapEvidence: mapEvidenceWithControl,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [
        sourceBackedSeed(vector.vectorId, ['fact-input-01', 'fact-query-01', 'fact-control-01']),
      ],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => ({
      ...(await acceptVerifier(request)),
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'The mapped control does not negate the independently reconciled claim.',
        evidence: request.hypothesis.evidence,
        consideredEvidenceMapFactIds: ['fact-control-01'],
      },
    }),
  });
  expect(reconciled.findings).toHaveLength(1);
  expect(reconciled.coverage[0]?.admissionFunnel).toMatchObject({
    verifierAcceptedCount: 1,
    verifierReconciledCount: 1,
    admittedFindingCount: 1,
  });
});

test('requires every candidate-relevant posture reconciliation before persisting', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: 'const requestValue = request.query.userId;\nexecute(requestValue);',
        languageHint: 'typescript',
      },
    ],
    runId: 'run-posture-reconciliation-missing-01',
    generatedAt: '2026-07-30T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => ({
      ...(await acceptVerifier(request)),
      postureReconciliations: [],
    }),
  });
  expect(report.findings).toHaveLength(0);
  expect(report.errors).toMatchObject([{ code: 'verifier-incomplete' }]);
  expect(report.coverage[0]?.admissionFunnel?.verificationTerminalLanes).toMatchObject({
    wrapperContractInvalid: 1,
  });
});

test('preserves a candidate-blind contradiction for human review without promoting it', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: 'const requestValue = request.query.userId;\nexecute(requestValue);',
        languageHint: 'typescript',
      },
    ],
    runId: 'run-candidate-blind-contradiction-01',
    generatedAt: '2026-07-30T12:04:00.000Z',
    mapEvidence,
    assessSourcePosture: async (request) => ({
      sourcePosture: {
        assessments: request.vector.reviewObligations.map((obligation) => ({
          assessmentId: `posture-${obligation.obligationId}`,
          obligationId: obligation.obligationId,
          conclusion: 'risk-contradicted' as const,
          evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
          limitations: [],
        })),
        limitations: [],
      },
    }),
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: acceptVerifier,
  });
  expect(report.findings).toHaveLength(0);
  expect(report.reviewRequired).toMatchObject([
    {
      status: 'needs-review',
      verification: { status: 'insufficient-evidence' },
    },
  ]);
  expect(report.errors).toMatchObject([{ code: 'candidate-blind-contradiction-review-required' }]);
  expect(report.coverage[0]?.admissionFunnel).toMatchObject({
    verifierAcceptedCount: 1,
    verifierEvidenceRejectedCount: 0,
    verifierReconciledCount: 1,
    admittedFindingCount: 0,
  });
  expect(report.coverage[0]?.reviewRequiredCount).toBe(1);
});

test('requires every approved hypothesis obligation to be source-reconciled before persisting', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-verifier-obligation-reconciliation-01',
    generatedAt: '2026-07-30T18:14:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => ({
      ...(await acceptVerifier(request)),
      obligationReconciliations: [
        {
          planObligation: { obligationId: 'missing-obligation-01' },
          disposition: 'supports-claim',
          explanation: 'This reconciliation intentionally references another obligation.',
          evidence: request.hypothesis.evidence,
        },
      ],
    }),
  });
  expect(report.findings).toHaveLength(0);
  expect(report.errors).toMatchObject([{ code: 'verifier-evidence-rejected' }]);
});

test('requires verifier control evidence to overlap each mapped control it claims to consider', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content:
          'const requestValue = request.query.userId;\nif (!requestValue) return;\nexecute(requestValue);',
        languageHint: 'typescript',
      },
    ],
    runId: 'run-control-evidence-overlap-01',
    generatedAt: '2026-07-30T12:02:00.000Z',
    mapEvidence: async (request) => {
      const mapped = await mapEvidence(request);
      return {
        ...mapped,
        evidenceMap: {
          ...mapped.evidenceMap,
          facts: [
            ...mapped.evidenceMap.facts,
            {
              factId: 'fact-control-02',
              role: 'control',
              statement: 'The scoped source contains a relevant control.',
              evidence: [
                {
                  path: 'src/query.ts',
                  startLine: 2,
                  snippet: 'if',
                  kind: 'source',
                  role: 'guard',
                },
              ],
              planObligations: [{ obligationId: 'audit-obligation-01' }],
            },
          ],
          controlCoverage: [
            { obligationId: 'audit-obligation-01', controlFactIds: ['fact-control-02'] },
          ],
        },
      };
    },
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => ({
      ...(await acceptVerifier(request)),
      controlAssessment: {
        conclusion: 'control-insufficient',
        explanation: 'The control was considered.',
        evidence: request.hypothesis.evidence,
        consideredEvidenceMapFactIds: ['fact-control-02'],
      },
    }),
  });
  expect(report.findings).toHaveLength(0);
  expect(report.errors).toMatchObject([{ code: 'verifier-evidence-rejected' }]);
});

test('uses verifier-reconciled evidence locations after validating them against source', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: 'const requestValue = request.query.userId;\nexecute(requestValue);',
        languageHint: 'typescript',
      },
    ],
    runId: 'run-verifier-reconciled-evidence-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => ({
      decision: 'accepted',
      reason: 'The inspected operation and input condition support the hypothesis.',
      verifiedEvidence: [
        {
          path: 'src/query.ts',
          startLine: 2,
          snippet: 'unused',
          kind: 'source',
          role: 'operation',
        },
        {
          path: 'src/query.ts',
          startLine: 1,
          snippet: 'unused',
          kind: 'source',
          role: 'unsafe-condition',
        },
      ],
      verifiedPlanObligations: [{ obligationId: 'audit-obligation-01' }],
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No scoped control negates the claim.',
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 2,
            snippet: 'unused',
            kind: 'source',
            role: 'operation',
          },
        ],
      },
      obligationReconciliations: obligationReconciliationsFor(request),
      postureReconciliations: postureReconciliationsFor(request),
    }),
    countercheck: acceptCountercheck,
  });
  expect(report.findings[0]?.evidence.find((item) => item.role === 'operation')).toMatchObject({
    path: 'src/query.ts',
    startLine: 2,
  });
});

test('fails closed when verifier-selected evidence is out of the approved source range', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: 'execute(request.query.userId);',
        languageHint: 'typescript',
      },
    ],
    runId: 'run-verifier-invalid-evidence-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => ({
      decision: 'accepted',
      reason: 'The hypothesis is supported.',
      verifiedEvidence: [
        {
          path: 'src/query.ts',
          startLine: 999,
          snippet: 'unused',
          kind: 'source',
          role: 'operation',
        },
        {
          path: 'src/query.ts',
          startLine: 999,
          snippet: 'unused',
          kind: 'source',
          role: 'unsafe-condition',
        },
      ],
      verifiedPlanObligations: [{ obligationId: 'audit-obligation-01' }],
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No scoped control negates the claim.',
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 999,
            snippet: 'unused',
            kind: 'source',
            role: 'operation',
          },
        ],
      },
      obligationReconciliations: obligationReconciliationsFor(request),
      postureReconciliations: postureReconciliationsFor(request),
    }),
    countercheck: acceptCountercheck,
  });
  expect(report.findings).toHaveLength(0);
  expect(report.errors).toMatchObject([{ code: 'verifier-evidence-rejected' }]);
  expect(report.coverage[0]?.admissionFunnel).toMatchObject({
    modelCandidateCount: 1,
    verifierAcceptedCount: 1,
    verifierEvidenceRejectedCount: 1,
    verifierReconciledCount: 0,
    admittedFindingCount: 0,
  });
});

test('does not persist a source-grounded hypothesis rejected by the independent verifier', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-verifier-rejected-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async () => ({
      decision: 'rejected',
      reason: 'The cited lines do not establish the claimed risk.',
      verifiedEvidence: null,
      verifiedPlanObligations: [],
    }),
    countercheck: acceptCountercheck,
  });
  expect(report.findings).toHaveLength(0);
  expect(report.coverage[0]?.findingCount).toBe(0);
  expect(report.errors).toMatchObject([{ code: 'verifier-rejected', stage: 'verification' }]);
  expect(report.coverage[0]?.admissionFunnel).toMatchObject({
    modelCandidateCount: 1,
    verifierRejectedCount: 1,
    admittedFindingCount: 0,
  });
});

test('does not persist a verifier-accepted hypothesis rejected by the countercheck', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-countercheck-rejected-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: acceptVerifier,
    countercheck: async () => ({
      decision: 'rejected',
      reason: 'The final challenge found a source-local control.',
      verifiedEvidence: null,
      verifiedPlanObligations: [],
    }),
  });
  expect(report.findings).toHaveLength(0);
  expect(report.coverage[0]?.findingCount).toBe(0);
  expect(report.errors).toMatchObject([{ code: 'countercheck-rejected', stage: 'countercheck' }]);
  expect(report.coverage[0]?.admissionFunnel).toMatchObject({
    verifierReconciledCount: 1,
    postVerificationRejectedCount: 1,
    admittedFindingCount: 0,
  });
});

test('reuses a canonical candidate-grounding draft to retry verification without another discovery', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  let investigationCalls = 0;
  let verificationCalls = 0;
  const discoveryObservation = completedStageObservation(
    'investigation',
    'investigation-resumed-draft-01',
  );
  const groundingObservation = completedStageObservation(
    'candidate-grounding',
    'candidate-grounding-resumed-draft-01',
  );
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-draft-resume-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    resumeState: createAuditResumeState({
      candidateGroundingDrafts: [
        {
          schemaVersion: 4,
          phase: 'candidate-grounding',
          candidateGroundingProtocolFingerprint: 'e'.repeat(64),
          runId: 'run-draft-resume-01',
          planId: plan.planId,
          planDigest: plan.planDigest,
          targetFingerprint,
          provider: 'fixture',
          model: 'fixture',
          verificationRouteFingerprint: 'c'.repeat(64),
          evidenceMapProtocolFingerprint: 'd'.repeat(64),
          reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
          vectorId: vector.vectorId,
          vectorDigest: vector.vectorDigest,
          savedAt: '2026-07-29T12:01:00.000Z',
          findings: [sourceBackedCanonicalHypothesis(vector.vectorId)],
          closures: [
            {
              planObligation: { obligationId: 'audit-obligation-01' },
              disposition: 'candidate-raised',
              evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
              sourcePostureAssessmentIds: ['posture-question-01'],
              limitations: [],
            },
          ],
          hypothesisGroundingFunnel: emptyHypothesisGroundingFunnel(),
          candidateIntegrityRejections: emptyCandidateIntegrityRejectionLedger(),
          discoveryObservation,
          modelObservation: groundingObservation,
        },
      ],
    }),
    investigate: async (request) => {
      investigationCalls += 1;
      return { seeds: [], closures: closuresFor(request, 'no-source-backed-candidate') };
    },
    verify: async (request) => {
      verificationCalls += 1;
      return {
        decision: 'accepted',
        reason: 'The stored draft remains supported.',
        verifiedEvidence: request.hypothesis.evidence,
        verifiedPlanObligations: request.hypothesis.planObligations,
        controlAssessment: {
          conclusion: 'no-effective-control-found',
          explanation: 'No scoped control negates the claim.',
          evidence: request.hypothesis.evidence,
        },
        obligationReconciliations: obligationReconciliationsFor(request),
        postureReconciliations: postureReconciliationsFor(request),
      };
    },
    countercheck: acceptCountercheck,
  });
  expect(investigationCalls).toBe(0);
  expect(verificationCalls).toBe(1);
  expect(report.findings).toHaveLength(1);
  expect(report.coverage[0]?.hypothesisGroundingFunnel).toEqual(emptyHypothesisGroundingFunnel());
  expect(report.coverage[0]?.candidateIntegrityRejections).toEqual(
    emptyCandidateIntegrityRejectionLedger(),
  );
  expect(report.coverage[0]?.modelObservation).toEqual(discoveryObservation);
  expect(report.coverage[0]?.candidateGroundingObservation).toEqual(groundingObservation);
  expect(modelStagesForAudit(report).map((stage) => stage.stage)).toEqual([
    'investigation',
    'candidate-grounding',
  ]);
});

test('does not invoke grounding when discovery emits no valid seed', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  let investigationCalls = 0;
  let groundingCalls = 0;
  const report = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
    runId: 'run-repair-draft-resume-01',
    generatedAt: '2026-07-30T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => {
      investigationCalls += 1;
      return { seeds: [], closures: closuresFor(request, 'no-source-backed-candidate') };
    },
    groundCandidates: async () => {
      groundingCalls += 1;
      return { groundings: { groundings: [] } };
    },
    verify: acceptVerifier,
  });
  expect(investigationCalls).toBe(1);
  expect(groundingCalls).toBe(0);
  expect(report.findings).toHaveLength(0);
});

test('reuses a completed vector result and checkpoints only newly executed vectors', async () => {
  const plan = approvedPlan();
  const first = plan.vectors[0];
  if (first === undefined) throw new Error('Missing first vector.');
  const twoVectorPlan = resealPlan({
    ...plan,
    vectors: [...plan.vectors, { ...first, title: 'Review hard-coded secrets' }],
  });
  const second = twoVectorPlan.vectors[1];
  if (second === undefined) throw new Error('Missing second vector.');
  let investigations = 0;
  const checkpointed: string[] = [];
  const report = await runApprovedAudit({
    plan: twoVectorPlan,
    targetFingerprint,
    contextDigest,
    sources: [
      { path: 'src/app.ts', content: 'const input = request.body;', languageHint: 'typescript' },
    ],
    runId: 'run-resume-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    resumeState: createAuditResumeState({
      vectorResults: [
        {
          coverage: {
            vectorId: first.vectorId,
            planned: true,
            completed: true,
            matchedSourcePaths: 1,
            deterministicCandidateCount: 0,
            evidenceMapFactCount: first.reviewObligations.length,
            evidenceMapUnansweredObligationCount: 0,
            sourcePostureAssessmentCount: first.reviewObligations.length,
            sourcePostureSupportedCount: first.reviewObligations.length,
            sourcePostureContradictedCount: 0,
            sourcePostureInconclusiveCount: 0,
            findingCount: 0,
            outcome: 'completed',
            errorCode: null,
            limitations: [],
            obligationClosure: first.reviewObligations.map((obligation) => ({
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
        },
      ],
    }),
    investigate: async (request) => {
      investigations += 1;
      return { seeds: [], closures: closuresFor(request, 'no-source-backed-candidate') };
    },
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
    onVectorResult: async (result) => {
      checkpointed.push(result.coverage.vectorId);
    },
  });
  expect(investigations).toBe(1);
  expect(checkpointed).toEqual([second.vectorId]);
  expect(report.coverage.map((coverage) => coverage.vectorId)).toEqual([
    first.vectorId,
    second.vectorId,
  ]);
});
