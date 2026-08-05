import { describe, expect, test } from 'bun:test';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import { createPlan as createDraftPlan, resealPlan } from '../attack-planning/plan.js';
import { claimEvidenceItems } from '../attack-planning/plan.schema.js';
import { observeModelStage } from '../model-operations/model-operations.js';
import {
  emptyCandidateIntegrityRejectionLedger,
  emptyHypothesisGroundingFunnel,
} from './admission/funnel.js';
import {
  type AuditCandidateGrounder,
  type AuditEvidenceMapper,
  type AuditInput,
  type AuditInvestigator,
  type AuditSourcePostureAssessor,
  auditExitCode,
  type CandidateAwareCheckpointUpdate,
  runAudit as runApprovedAudit,
  runStaticAudit,
} from './audit.js';
import type { AuditEvidenceMapDraft } from './audit.schema.js';
import { candidateAwareFingerprint } from './candidate-aware-identity.js';
import { createAuditResumeState } from './checkpoints.js';
import { evidenceMapFingerprint } from './evidence-map/repair.js';
import { verifyEvidenceMap } from './evidence-map/verify.js';
import { modelStagesForAudit } from './model-stage-observations.js';
import { sourcePostureFingerprint } from './source-posture/identity.js';
import { verifySourcePosture } from './source-posture/verify.js';
import type {
  AuditCountercheckRequest,
  AuditVerificationRequest,
  AuditVerificationResult,
} from './verification/contract.js';

const targetFingerprint = 'a'.repeat(64);
const contextDigest = 'b'.repeat(64);
const approvePlan = <T>(plan: T, ..._reviewMetadata: readonly [string, string, string]): T => plan;

function completedStageObservation(
  stage:
    | 'evidence-mapping'
    | 'source-posture'
    | 'investigation'
    | 'candidate-grounding'
    | 'verification',
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

function failedInvestigationStageObservation(stageId: string) {
  return observeModelStage({
    stage: 'investigation',
    route: 'primary',
    stageId,
    status: 'failed',
    durationMs: 1,
    errorCode: 'provider-response-invalid',
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

function failedVerificationStageObservation(
  stageId: string,
  errorCode: 'provider-http-error' | 'validation-repair-no-progress' = 'provider-http-error',
) {
  return observeModelStage({
    stage: 'verification',
    route: 'primary',
    stageId,
    status: 'failed',
    durationMs: 1,
    errorCode,
    requests: [],
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
      evidence: (fact?.evidence ?? []).map((evidence) => ({
        ...evidence,
        role: 'source' as const,
      })),
    };
  });
}

const acceptVerifier = async (request: AuditVerificationRequest) => ({
  decision: 'accepted' as const,
  reasonCode: 'claim-supported' as const,
  claimEvidenceBundles: request.hypothesis.claimEvidenceBundles,
  contradictionEvidence: null,
  inspectedEvidence: [],
  verifiedPlanObligations: request.hypothesis.planObligations,
  affectedPlanObligations: [],
  controlAssessment: {
    conclusion: 'no-effective-control-found' as const,
    evidence: [...claimEvidenceItems(request.hypothesis)],
  },
  obligationReconciliations: obligationReconciliationsFor(request),
  postureReconciliations: postureReconciliationsFor(request),
});

const acceptCountercheck = async (request: AuditCountercheckRequest) => ({
  decision: 'accepted' as const,
  reasonCode: 'claim-supported' as const,
  claimEvidenceBundles: request.hypothesis.claimEvidenceBundles,
  contradictionEvidence: null,
  inspectedEvidence: [],
  verifiedPlanObligations: request.hypothesis.planObligations,
  affectedPlanObligations: [],
  controlAssessment: {
    conclusion: 'no-effective-control-found' as const,
    evidence: [...claimEvidenceItems(request.hypothesis)],
  },
  obligationReconciliations: obligationReconciliationsFor(request),
  postureReconciliations: postureReconciliationsFor(request),
});

function rejectedResult(
  request: AuditVerificationRequest | AuditCountercheckRequest,
): AuditVerificationResult {
  const counterevidence = claimEvidenceItems(request.hypothesis).at(0);
  if (counterevidence === undefined) throw new Error('Expected candidate evidence.');
  return {
    decision: 'rejected',
    reasonCode: 'claim-contradicted',
    claimEvidenceBundles: null,
    contradictionEvidence: [{ ...counterevidence, role: 'counterevidence' }],
    inspectedEvidence: [],
    verifiedPlanObligations: [],
    affectedPlanObligations: request.hypothesis.planObligations,
    controlAssessment: null,
    obligationReconciliations: obligationReconciliationsFor(request).map((reconciliation) => ({
      ...reconciliation,
      disposition: 'contradicts-claim',
    })),
    postureReconciliations: postureReconciliationsFor(request).map((reconciliation) => ({
      ...reconciliation,
      disposition: 'contradicts-claim',
    })),
  };
}

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
            contentDigest: 'a'.repeat(64),
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
            contentDigest: 'a'.repeat(64),
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
              contentDigest: 'a'.repeat(64),
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

async function defaultCheckpointDependencies(
  vector: ReturnType<typeof approvedPlan>['vectors'][number],
) {
  const source = {
    path: 'src/query.ts',
    content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
    languageHint: 'typescript' as const,
  };
  const request = { vector, availableSourcePaths: [source.path], limitations: [] };
  const mapped = await mapEvidence(request);
  const evidenceMap = verifyEvidenceMap(vector, mapped.evidenceMap, [source]).evidenceMap;
  const posture = await assessSourcePosture({ ...request, evidenceMap });
  const sourcePosture = verifySourcePosture(
    vector,
    posture.sourcePosture,
    evidenceMap,
  ).sourcePosture;
  return {
    evidenceMapFingerprint: evidenceMapFingerprint(evidenceMap),
    sourcePostureFingerprint: sourcePostureFingerprint(sourcePosture),
  };
}

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
    claimEvidenceBundles: [
      {
        role: 'operation' as const,
        explanation: 'The source performs the reviewed query operation.',
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source' as const,
            role: 'operation' as const,
          },
        ],
      },
      {
        role: 'unsafe-condition' as const,
        explanation: 'The source keeps request data in the reviewed query relation.',
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source' as const,
            role: 'unsafe-condition' as const,
          },
        ],
      },
    ],
    planObligations: [{ obligationId: 'audit-obligation-01' }],
    evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
    claimEvidenceSelections: [
      {
        role: 'operation' as const,
        selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
      },
      {
        role: 'unsafe-condition' as const,
        selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
      },
    ],
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
  const candidate = sourceBackedHypothesis(vectorId);
  return {
    vectorId: candidate.vectorId,
    narrative: {
      statement: candidate.statement,
      roleExplanations: candidate.claimEvidenceBundles.map((bundle) => ({
        role: bundle.role,
        explanation: bundle.explanation,
      })),
      limitations: candidate.limitations,
    },
    claimEvidenceBundles: candidate.claimEvidenceBundles.map(({ role, evidence }) => ({
      role,
      evidence,
    })),
    planObligations: candidate.planObligations,
    evidenceMapFactIds: candidate.evidenceMapFactIds,
    claimEvidenceSelections: candidate.claimEvidenceSelections,
    sourcePostureAssessmentIds: candidate.sourcePostureAssessmentIds,
  };
}

function sourceBackedGroundingCandidate(vectorId: string) {
  const {
    vectorId: _vectorId,
    claimEvidenceBundles: _claimEvidenceBundles,
    claimEvidenceSelections: _claimEvidenceSelections,
    planObligations: _planObligations,
    evidenceMapFactIds: _evidenceMapFactIds,
    sourcePostureAssessmentIds: _sourcePostureAssessmentIds,
    limitations: _limitations,
    ...candidate
  } = sourceBackedHypothesis(vectorId);
  return {
    ...candidate,
    claimEvidenceBundles: [
      {
        role: 'operation' as const,
        selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
        explanation: 'The operation fact identifies the query operation.',
      },
      {
        role: 'unsafe-condition' as const,
        selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        explanation: 'The input fact identifies the request-controlled condition.',
      },
    ],
  };
}

const groundSeeds: AuditCandidateGrounder = async (request) => ({
  groundings: {
    groundings: request.seeds.map((seed) => ({
      seedId: seed.seedId,
      candidate: {
        ...sourceBackedGroundingCandidate(seed.vectorId),
      },
      nullReason: null,
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
      throw new AuditRuntimeError('artifact-invalid', 'Injected checkpoint persistence failure.');
    },
  });
  expect(report.errors).toMatchObject([
    { code: 'checkpoint-persistence-failed', stage: 'evidence-mapping', retryable: false },
  ]);
  expect(report.coverage[0]).toMatchObject({
    outcome: 'failed',
    errorCode: 'checkpoint-persistence-failed',
  });
});

test('turns terminal-vector checkpoint persistence into visible failed coverage', async () => {
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
    runId: 'run-terminal-vector-persistence-failure-01',
    generatedAt: '2026-08-04T12:00:00.000Z',
    mapEvidence,
    investigate: async (request) => ({
      seeds: [],
      closures: closuresFor(request, 'no-source-backed-candidate'),
    }),
    verify: acceptVerifier,
    onVectorResult: async () => {
      throw new Error('Injected terminal-vector persistence failure.');
    },
  });

  expect(report.findings).toHaveLength(0);
  expect(report.errors).toContainEqual(
    expect.objectContaining({
      code: 'checkpoint-persistence-failed',
      stage: 'audit',
      retryable: false,
    }),
  );
  expect(report.coverage).toMatchObject([
    {
      completed: false,
      outcome: 'failed',
      errorCode: 'checkpoint-persistence-failed',
      findingCount: 0,
    },
  ]);
  expect(auditExitCode(report)).toBe(3);
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
            statement: 'Request-controlled value reaches query.',
          },
          nullReason: null,
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
  expect(report.coverage.reduce((total, coverage) => total + coverage.findingCount, 0)).toBe(2);
  expect(
    report.coverage.reduce(
      (total, coverage) => total + (coverage.admissionFunnel?.duplicateCollapsedCount ?? 0),
      0,
    ),
  ).toBe(4);
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
  expect(report.errors[0]?.code).toBe('audit-continuation-failed');
  expect(auditExitCode(report)).toBe(3);
});

test('retains completed phase observations and validated predecessor state after continuation fails', async () => {
  const checkpointed: unknown[] = [];
  const mapObservation = completedStageObservation('evidence-mapping', 'continuation-map-01');
  const postureObservation = completedStageObservation('source-posture', 'continuation-posture-01');
  const investigationObservation = completedStageObservation(
    'investigation',
    'continuation-investigation-01',
  );
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
    runId: 'run-continuation-failure-01',
    generatedAt: '2026-08-04T12:00:00.000Z',
    mapEvidence: async (request, stageContext) => {
      stageContext?.onCompletedModelObservation?.(mapObservation);
      return mapEvidence(request);
    },
    assessSourcePosture: async (request, stageContext) => {
      stageContext?.onCompletedModelObservation?.(postureObservation);
      return assessSourcePosture(request);
    },
    investigate: async (_request, stageContext) => {
      stageContext?.onCompletedModelObservation?.(investigationObservation);
      throw new Error('downstream continuation failed');
    },
    verify: acceptVerifier,
    onVectorResult: async (result) => {
      checkpointed.push(result);
    },
  });

  expect(report.errors).toMatchObject([
    { code: 'audit-continuation-failed', stage: 'investigation', retryable: false },
  ]);
  expect(report.coverage).toMatchObject([
    {
      outcome: 'failed',
      errorCode: 'audit-continuation-failed',
      evidenceMapFactCount: 2,
      sourcePostureAssessmentCount: 1,
      evidenceMapObservation: { stage: 'evidence-mapping', status: 'completed' },
      sourcePostureObservation: { stage: 'source-posture', status: 'completed' },
      modelObservation: { stage: 'investigation', status: 'completed' },
    },
  ]);
  expect(modelStagesForAudit(report)).toEqual([
    mapObservation,
    postureObservation,
    investigationObservation,
  ]);
  expect(checkpointed).toMatchObject([
    {
      coverage: {
        errorCode: 'audit-continuation-failed',
        evidenceMapFactCount: 2,
        sourcePostureAssessmentCount: 1,
      },
    },
  ]);
});

test('retains a failed investigation observation in terminal coverage and the vector checkpoint', async () => {
  const observation = failedInvestigationStageObservation('investigation-projection-failure-01');
  const checkpointed: unknown[] = [];
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
    runId: 'run-investigation-projection-failure-01',
    generatedAt: '2026-08-04T12:00:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async () => ({ seeds: [], closures: [], modelObservation: observation }),
    verify: acceptVerifier,
    onVectorResult: async (result) => {
      checkpointed.push(result);
    },
  });

  expect(report.findings).toHaveLength(0);
  expect(report.errors).toMatchObject([
    { code: 'provider-response-invalid', stage: 'investigation', retryable: false },
  ]);
  expect(report.coverage).toMatchObject([
    {
      outcome: 'failed',
      errorCode: 'provider-response-invalid',
      modelObservation: {
        stage: 'investigation',
        status: 'failed',
        errorCode: 'provider-response-invalid',
        usage: { modelCallCount: 1 },
      },
    },
  ]);
  expect(modelStagesForAudit(report)).toEqual([observation]);
  expect(checkpointed).toMatchObject([
    {
      coverage: {
        outcome: 'failed',
        errorCode: 'provider-response-invalid',
        modelObservation: {
          stage: 'investigation',
          status: 'failed',
          errorCode: 'provider-response-invalid',
        },
      },
    },
  ]);
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
      throw new AuditRuntimeError('provider-cancelled', 'Provider-neutral cancellation.');
    },
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
  });
  expect(report.findings).toHaveLength(0);
  expect(report.coverage[0]?.outcome).toBe('cancelled');
  expect(report.errors[0]?.code).toBe('provider-cancelled');
  expect(auditExitCode(report)).toBe(3);
});

test('retains completed verifier telemetry when a sibling provider call is cancelled', async () => {
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
    runId: 'run-cancelled-sibling-telemetry-01',
    generatedAt: '2026-08-04T11:00:00.000Z',
    maxParallelVectors: 2,
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: ['one', 'two', 'three'].map((suffix) => ({
        ...sourceBackedSeed(request.vector.vectorId),
        seedId: `seed-cancel-${suffix}`,
      })),
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => {
      if (request.verificationId.endsWith('-1')) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2));
        return {
          ...(await acceptVerifier(request)),
          modelObservation: completedStageObservation('verification', 'completed-before-cancel'),
        };
      }
      throw new AuditRuntimeError('provider-cancelled', 'Provider-neutral cancellation.');
    },
  });

  expect(report.coverage[0]).toMatchObject({
    outcome: 'cancelled',
    errorCode: 'provider-cancelled',
    verificationObservations: [
      expect.objectContaining({ stageId: 'completed-before-cancel', status: 'completed' }),
    ],
  });
  expect(report.errors).toContainEqual(
    expect.objectContaining({ code: 'provider-cancelled', stage: 'verification' }),
  );
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
    | Pick<AuditEvidenceMapDraft, 'vectorId' | 'evidenceMap' | 'repairAttempts' | 'execution'>
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
                schemaVersion: 5,
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
                evidenceMapFingerprint: evidenceMapFingerprint(savedMap.evidenceMap),
                repairAttempts: savedMap.repairAttempts,
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
        claimEvidenceBundles: [
          { role: 'operation', evidence: [{ path: 'src/query.ts', startLine: 1 }] },
          { role: 'unsafe-condition', evidence: [{ path: 'src/query.ts', startLine: 1 }] },
        ],
      });
      return {
        decision: 'accepted',
        reasonCode: 'claim-supported',
        claimEvidenceBundles: request.hypothesis.claimEvidenceBundles,
        contradictionEvidence: null,
        inspectedEvidence: [],
        verifiedPlanObligations: request.hypothesis.planObligations,
        affectedPlanObligations: [],
        controlAssessment: {
          conclusion: 'no-effective-control-found',
          evidence: [...claimEvidenceItems(request.hypothesis)],
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
    duplicateCollapsedCount: 0,
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

test('retains a completed verifier observation when its candidate-aware wrapper fails afterward', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const observation = completedStageObservation('verification', 'verifier-continuation-01');
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
    runId: 'run-verifier-continuation-01',
    generatedAt: '2026-08-04T12:00:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (_request, stageContext) => {
      stageContext?.onCompletedModelObservation?.(observation);
      throw new Error('candidate-aware continuation failed');
    },
  });

  expect(report.coverage).toMatchObject([
    {
      outcome: 'incomplete',
      verificationObservations: [{ stage: 'verification', status: 'completed' }],
    },
  ]);
  expect(modelStagesForAudit(report)).toContainEqual(observation);
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

test('retains a completed verifier observation when its terminal checkpoint fails', async () => {
  const plan = approvedPlan();
  let verifierCalls = 0;
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
    runId: 'run-verifier-terminal-checkpoint-failure-01',
    generatedAt: '2026-08-04T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(request.vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async (request) => {
      verifierCalls += 1;
      return {
        ...(await acceptVerifier(request)),
        modelObservation: completedStageObservation('verification', 'verification-completed-01'),
      };
    },
    onCandidateAwareCheckpoint: async (update) => {
      if (update.state === 'completed') {
        throw new Error('Injected verifier checkpoint persistence failure.');
      }
    },
  });

  expect(verifierCalls).toBe(1);
  expect(report.findings).toHaveLength(0);
  expect(report.errors).toContainEqual(
    expect.objectContaining({
      code: 'checkpoint-persistence-failed',
      stage: 'verification',
      retryable: false,
    }),
  );
  expect(report.coverage).toMatchObject([
    {
      outcome: 'failed',
      errorCode: 'checkpoint-persistence-failed',
      verificationObservations: [
        {
          stage: 'verification',
          status: 'completed',
          errorCode: null,
        },
      ],
    },
  ]);
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
        phaseInputFingerprint: 'a'.repeat(64),
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
        reasonCode: 'output-invalid',
        claimEvidenceBundles: null,
        contradictionEvidence: null,
        inspectedEvidence: [],
        verifiedPlanObligations: [],
        affectedPlanObligations: [],
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

test('grounds every discovery seed with seed-owned vector and obligation binding', async () => {
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
  const discoveryUpdates: Parameters<
    NonNullable<Parameters<typeof runApprovedAudit>[0]['onVerifiedDiscoverySeed']>
  >[0][] = [];
  const grounded = await runApprovedAudit({
    ...input,
    runId: 'run-candidate-grounding-accepted-01',
    groundCandidates: async (request) => {
      const seed = request.seeds[0];
      if (seed === undefined) throw new Error('Missing seed.');
      return {
        groundings: {
          groundings: [
            {
              seedId: seed.seedId,
              candidate: sourceBackedGroundingCandidate(vector.vectorId),
              nullReason: null,
            },
          ],
        },
      };
    },
    onVerifiedDiscoverySeed: async (update) => {
      discoveryUpdates.push(update);
    },
  });
  expect(discoveryUpdates).toEqual([
    {
      vectorId: vector.vectorId,
      evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
    },
  ]);
  expect(grounded.findings).toHaveLength(1);
  expect(grounded.coverage[0]?.admissionFunnel).toMatchObject({
    integrityRejectedCount: 0,
    verifierAcceptedCount: 1,
    admittedFindingCount: 1,
  });
  expect(grounded.coverage[0]?.candidateIntegrityRejections).toEqual(
    emptyCandidateIntegrityRejectionLedger(),
  );

  const derived = await runApprovedAudit({
    ...input,
    runId: 'run-candidate-grounding-seed-derived-01',
    groundCandidates: async (request) => {
      const seed = request.seeds[0];
      if (seed === undefined) throw new Error('Missing seed.');
      return {
        groundings: {
          groundings: [
            {
              seedId: seed.seedId,
              candidate: sourceBackedGroundingCandidate('another-vector'),
              nullReason: null,
            },
          ],
        },
      };
    },
  });
  expect(derived.findings).toHaveLength(1);
  expect(derived.coverage[0]?.hypothesisGroundingFunnel).toMatchObject({
    discoveredSeedCount: 1,
    discoveryBindingRejectedCount: 0,
    groundingBindingRejectedCount: 0,
    submittedCandidateCount: 1,
  });
  expect(derived.coverage[0]?.admissionFunnel).toMatchObject({
    integrityRejectedCount: 0,
    admittedFindingCount: 1,
  });
});

test('repairs a generic grounding evidence gap candidate-blind and restarts only map-dependent work', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  let postureCalls = 0;
  let investigationCalls = 0;
  let groundingCalls = 0;
  const repairInputs: unknown[] = [];
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
    runId: 'run-evidence-map-repair-grounding-01',
    generatedAt: '2026-08-03T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture: async (request) => {
      postureCalls += 1;
      return assessSourcePosture(request);
    },
    investigate: async (request) => {
      investigationCalls += 1;
      return {
        seeds: [sourceBackedSeed(request.vector.vectorId)],
        closures: closuresFor(request, 'candidate-raised'),
      };
    },
    groundCandidates: async (request) => {
      groundingCalls += 1;
      return {
        groundings: {
          groundings: request.seeds.map((seed) =>
            groundingCalls === 1
              ? {
                  seedId: seed.seedId,
                  candidate: null,
                  nullReason: 'map-insufficient' as const,
                }
              : {
                  seedId: seed.seedId,
                  candidate: {
                    ...sourceBackedGroundingCandidate(seed.vectorId),
                  },
                  nullReason: null,
                },
          ),
        },
        ...(groundingCalls === 1
          ? {
              mapInsufficiencies: [
                {
                  obligationIds: ['audit-obligation-01'],
                  needs: ['operation-evidence-missing' as const],
                },
              ],
            }
          : {}),
      };
    },
    repairEvidenceMap: async (request) => {
      repairInputs.push(request);
      return {
        evidenceMap: {
          ...request.evidenceMap,
          facts: [
            ...request.evidenceMap.facts,
            {
              factId: 'fact-repair-boundary-01',
              role: 'boundary',
              evidence: [
                {
                  path: 'src/query.ts',
                  startLine: 2,
                  contentDigest: 'a'.repeat(64),
                  kind: 'source' as const,
                },
              ],
              planObligations: [{ obligationId: 'audit-obligation-01' }],
            },
          ],
        },
      };
    },
    verify: acceptVerifier,
  });

  expect(report.findings).toHaveLength(1);
  expect({ postureCalls, investigationCalls, groundingCalls }).toEqual({
    postureCalls: 2,
    investigationCalls: 2,
    groundingCalls: 2,
  });
  expect(repairInputs).toHaveLength(1);
  expect(repairInputs[0]).toMatchObject({
    insufficiencies: [
      {
        obligationIds: ['audit-obligation-01'],
        needs: ['operation-evidence-missing'],
      },
    ],
  });
  expect(JSON.stringify(repairInputs[0])).not.toContain('candidate');
  expect(JSON.stringify(repairInputs[0])).not.toContain('priority');
});

test('closes explicit incomplete coverage when the same generic repair adds no neutral fact', async () => {
  const plan = approvedPlan();
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
    runId: 'run-evidence-map-repair-no-progress-01',
    generatedAt: '2026-08-03T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(request.vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: async (request) => ({
      groundings: {
        groundings: request.seeds.map((seed) => ({
          seedId: seed.seedId,
          candidate: null,
          nullReason: 'map-insufficient' as const,
        })),
      },
      mapInsufficiencies: [
        {
          obligationIds: ['audit-obligation-01'],
          needs: ['unsafe-condition-relation-missing'],
        },
      ],
    }),
    repairEvidenceMap: async (request) => ({ evidenceMap: request.evidenceMap }),
    verify: acceptVerifier,
  });

  expect(report.coverage[0]).toMatchObject({
    completed: false,
    outcome: 'incomplete',
    errorCode: 'evidence-map-repair-no-progress',
  });
  expect(report.findings).toHaveLength(0);
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
      const unsafeConditionBundle = candidate.claimEvidenceBundles.find(
        (bundle) => bundle.role === 'unsafe-condition',
      );
      if (unsafeConditionBundle === undefined) throw new Error('Missing unsafe-condition bundle.');
      return {
        groundings: {
          groundings: [
            {
              seedId: seed.seedId,
              candidate: {
                ...candidate,
                claimEvidenceBundles: [
                  {
                    role: 'operation',
                    explanation: 'The selected location is out of range.',
                    selections: [{ factId: 'fact-query-01', evidenceIndex: 8 }],
                  },
                  unsafeConditionBundle,
                ],
              },
              nullReason: null,
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
        evidence: [...claimEvidenceItems(request.hypothesis)],
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
  expect(report.errors).toMatchObject([{ code: 'verifier-wrapper-contract-invalid' }]);
  expect(report.coverage[0]?.admissionFunnel?.verificationTerminalLanes).toMatchObject({
    wrapperContractInvalid: 1,
  });
});

test('retains a failed verifier stage as an operational failure rather than wrapper corruption', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const observation = failedVerificationStageObservation('verification-http-failure-01');
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
    runId: 'run-verification-http-failure-01',
    generatedAt: '2026-08-04T13:00:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async () => ({
      decision: 'incomplete',
      reasonCode: 'output-invalid',
      claimEvidenceBundles: null,
      contradictionEvidence: null,
      inspectedEvidence: [],
      verifiedPlanObligations: [],
      affectedPlanObligations: [],
      controlAssessment: null,
      obligationReconciliations: [],
      postureReconciliations: [],
      terminalLane: 'stage-failed',
      modelObservation: observation,
    }),
  });

  expect(report.findings).toHaveLength(0);
  expect(report.errors).toContainEqual(
    expect.objectContaining({
      code: 'provider-http-error',
      stage: 'verification',
      retryable: false,
    }),
  );
  expect(report.coverage[0]?.admissionFunnel?.verificationTerminalLanes).toMatchObject({
    stageFailed: 1,
    wrapperContractInvalid: 0,
  });
});

test('does not advertise repeated verifier output validation as resumable work', async () => {
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
    runId: 'run-verification-validation-no-progress-01',
    generatedAt: '2026-08-04T13:01:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
    }),
    groundCandidates: groundSeeds,
    verify: async () => ({
      decision: 'incomplete',
      reasonCode: 'output-invalid',
      claimEvidenceBundles: null,
      contradictionEvidence: null,
      inspectedEvidence: [],
      verifiedPlanObligations: [],
      affectedPlanObligations: [],
      controlAssessment: null,
      obligationReconciliations: [],
      postureReconciliations: [],
      terminalLane: 'stage-failed',
      modelObservation: failedVerificationStageObservation(
        'verification-validation-no-progress-01',
        'validation-repair-no-progress',
      ),
    }),
  });

  expect(report.errors).toContainEqual(
    expect.objectContaining({
      code: 'validation-repair-no-progress',
      stage: 'verification',
      retryable: false,
    }),
  );
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
  expect(report.errors).toEqual([]);
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
          evidence: [...claimEvidenceItems(request.hypothesis)],
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
                  contentDigest: 'a'.repeat(64),
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
        evidence: [...claimEvidenceItems(request.hypothesis)],
        consideredEvidenceMapFactIds: ['fact-control-02'],
      },
    }),
  });
  expect(report.findings).toHaveLength(0);
  expect(report.errors).toMatchObject([{ code: 'verifier-evidence-rejected' }]);
});

test('retains every map-projected verifier evidence bundle in the admitted finding', async () => {
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
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
  });
  const finding = report.findings[0];
  if (finding === undefined) throw new Error('Expected an admitted finding.');
  expect(claimEvidenceItems(finding).map((item) => item.role)).toEqual([
    'operation',
    'unsafe-condition',
  ]);
});

test('does not permit a verifier to author source locations outside the map-selection contract', async () => {
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
    verify: acceptVerifier,
    countercheck: acceptCountercheck,
  });
  expect(report.findings).toHaveLength(1);
  expect(report.errors).toEqual([]);
  expect(report.coverage[0]?.admissionFunnel).toMatchObject({
    modelCandidateCount: 1,
    verifierAcceptedCount: 1,
    verifierEvidenceRejectedCount: 0,
    verifierReconciledCount: 1,
    admittedFindingCount: 1,
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
    verify: async (request) => rejectedResult(request),
    countercheck: acceptCountercheck,
  });
  expect(report.findings).toHaveLength(0);
  expect(report.coverage[0]?.findingCount).toBe(0);
  expect(report.errors).toEqual([]);
  expect(report.coverage[0]?.admissionFunnel).toMatchObject({
    modelCandidateCount: 1,
    verifierRejectedCount: 1,
    admittedFindingCount: 0,
  });
});

test('keeps verifier admission when an evaluation-only countercheck rejects the hypothesis', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  let countercheckCalls = 0;
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
    countercheck: async (request) => {
      countercheckCalls += 1;
      return rejectedResult(request);
    },
  });
  expect(report.findings).toHaveLength(1);
  expect(report.coverage[0]?.findingCount).toBe(1);
  expect(report.errors).toEqual([]);
  expect(report.coverage[0]?.admissionFunnel).toMatchObject({
    verifierReconciledCount: 1,
    postVerificationRejectedCount: 0,
    admittedFindingCount: 1,
  });
  expect(countercheckCalls).toBe(1);
});

test('resumes from a durable grounding draft after a crash before its first candidate-aware checkpoint', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const source = [
    {
      path: 'src/query.ts',
      content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
      languageHint: 'typescript' as const,
    },
  ];
  let savedMap:
    | Pick<AuditEvidenceMapDraft, 'vectorId' | 'evidenceMap' | 'repairAttempts' | 'execution'>
    | undefined;
  let savedSourcePosture:
    | Parameters<NonNullable<AuditInput['onSourcePostureDraft']>>[0]
    | undefined;
  let savedGrounding:
    | Parameters<NonNullable<AuditInput['onCandidateGroundingDraft']>>[0]
    | undefined;
  const firstDiscoveryObservation = completedStageObservation(
    'investigation',
    'crash-boundary-discovery-01',
  );
  const firstGroundingObservation = completedStageObservation(
    'candidate-grounding',
    'crash-boundary-grounding-01',
  );

  await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: source,
    runId: 'run-draft-crash-boundary-01',
    generatedAt: '2026-08-04T12:00:00.000Z',
    mapEvidence,
    assessSourcePosture,
    investigate: async (request) => ({
      seeds: [sourceBackedSeed(vector.vectorId)],
      closures: closuresFor(request, 'candidate-raised'),
      modelObservation: firstDiscoveryObservation,
    }),
    groundCandidates: async () => ({
      groundings: {
        groundings: [
          {
            seedId: 'seed-query-01',
            candidate: sourceBackedGroundingCandidate(vector.vectorId),
            nullReason: null,
          },
        ],
      },
      modelObservation: firstGroundingObservation,
    }),
    verify: acceptVerifier,
    onEvidenceMapDraft: async (draft) => {
      savedMap = draft;
    },
    onSourcePostureDraft: async (draft) => {
      savedSourcePosture = draft;
    },
    onCandidateGroundingDraft: async (draft) => {
      savedGrounding = draft;
      throw new Error('Simulated process stop after durable grounding draft save.');
    },
  });

  if (savedMap === undefined || savedSourcePosture === undefined || savedGrounding === undefined) {
    throw new Error('The initial run did not reach every durable upstream boundary.');
  }

  let mappingCalls = 0;
  let sourcePostureCalls = 0;
  let discoveryCalls = 0;
  let groundingCalls = 0;
  let verificationCalls = 0;
  const candidateAwareTransitions: string[] = [];
  const resumed = await runApprovedAudit({
    plan,
    targetFingerprint,
    contextDigest,
    sources: source,
    runId: 'run-draft-crash-boundary-01',
    generatedAt: '2026-08-04T12:01:00.000Z',
    retryUnfinished: true,
    resumeState: createAuditResumeState({
      evidenceMapDrafts: [
        {
          schemaVersion: 5,
          phase: 'evidence-mapping',
          runId: 'run-draft-crash-boundary-01',
          planId: plan.planId,
          planDigest: plan.planDigest,
          targetFingerprint,
          provider: 'fixture',
          model: 'fixture',
          verificationRouteFingerprint: 'c'.repeat(64),
          evidenceMapProtocolFingerprint: 'd'.repeat(64),
          reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
          vectorDigest: vector.vectorDigest,
          savedAt: '2026-08-04T12:00:01.000Z',
          ...savedMap,
          evidenceMapFingerprint: evidenceMapFingerprint(savedMap.evidenceMap),
        },
      ],
      sourcePostureDrafts: [
        {
          schemaVersion: 4,
          phase: 'source-posture',
          runId: 'run-draft-crash-boundary-01',
          planId: plan.planId,
          planDigest: plan.planDigest,
          targetFingerprint,
          provider: 'fixture',
          model: 'fixture',
          verificationRouteFingerprint: 'c'.repeat(64),
          evidenceMapProtocolFingerprint: 'd'.repeat(64),
          reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
          vectorDigest: vector.vectorDigest,
          savedAt: '2026-08-04T12:00:02.000Z',
          ...savedSourcePosture,
          evidenceMapFingerprint: evidenceMapFingerprint(savedMap.evidenceMap),
        },
      ],
      candidateGroundingDrafts: [
        {
          schemaVersion: 10,
          phase: 'candidate-grounding',
          runId: 'run-draft-crash-boundary-01',
          planId: plan.planId,
          planDigest: plan.planDigest,
          targetFingerprint,
          provider: 'fixture',
          model: 'fixture',
          verificationRouteFingerprint: 'c'.repeat(64),
          evidenceMapProtocolFingerprint: 'd'.repeat(64),
          reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
          vectorDigest: vector.vectorDigest,
          savedAt: '2026-08-04T12:00:03.000Z',
          candidateGroundingProtocolFingerprint: 'e'.repeat(64),
          ...savedGrounding,
        },
      ],
    }),
    mapEvidence: async () => {
      mappingCalls += 1;
      throw new Error('A valid evidence-map draft must not be replayed.');
    },
    assessSourcePosture: async () => {
      sourcePostureCalls += 1;
      throw new Error('A valid source-posture draft must not be replayed.');
    },
    investigate: async () => {
      discoveryCalls += 1;
      throw new Error('A valid grounding draft must not replay discovery.');
    },
    groundCandidates: async () => {
      groundingCalls += 1;
      throw new Error('A valid grounding draft must not replay grounding.');
    },
    verify: async (request) => {
      verificationCalls += 1;
      return {
        ...(await acceptVerifier(request)),
        modelObservation: completedStageObservation(
          'verification',
          'crash-boundary-verification-01',
        ),
      };
    },
    onCandidateAwareCheckpoint: async (update) => {
      candidateAwareTransitions.push(update.state);
    },
  });

  expect(mappingCalls).toBe(0);
  expect(sourcePostureCalls).toBe(0);
  expect(discoveryCalls).toBe(0);
  expect(groundingCalls).toBe(0);
  expect(verificationCalls).toBe(1);
  expect(candidateAwareTransitions).toEqual(['pending', 'running', 'completed']);
  expect(resumed.findings).toHaveLength(1);
  expect(modelStagesForAudit(resumed).map((stage) => stage.stageId)).toEqual([
    firstDiscoveryObservation.stageId,
    firstGroundingObservation.stageId,
    'crash-boundary-verification-01',
  ]);
  expect(
    modelStagesForAudit(resumed).reduce(
      (modelCallCount, stage) => modelCallCount + stage.usage.modelCallCount,
      0,
    ),
  ).toBe(3);
});

test('reschedules an interrupted running verifier from its canonical grounding draft', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const dependencies = await defaultCheckpointDependencies(vector);
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
    retryUnfinished: true,
    resumeState: createAuditResumeState({
      candidateGroundingDrafts: [
        {
          schemaVersion: 10,
          phase: 'candidate-grounding',
          ...dependencies,
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
          groundings: {
            groundings: [
              {
                seedId: 'audit-resume-seed-01',
                disposition: 'grounded',
                hypothesis: sourceBackedCanonicalHypothesis(vector.vectorId),
              },
            ],
          },
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
      candidateAwareCheckpoints: [
        {
          schemaVersion: 5,
          phase: 'verification',
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
          candidateOrdinal: 1,
          candidateFingerprint: candidateAwareFingerprint(
            sourceBackedCanonicalHypothesis(vector.vectorId),
          ),
          evidenceMapFingerprint: dependencies.evidenceMapFingerprint,
          sourcePostureFingerprint: dependencies.sourcePostureFingerprint,
          state: 'running',
          savedAt: '2026-07-29T12:02:00.000Z',
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
        ...(await acceptVerifier(request)),
        decision: 'accepted',
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

test('explicit unfinished recovery does not treat a null grounding draft as terminal', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const dependencies = await defaultCheckpointDependencies(vector);
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
    runId: 'run-null-grounding-recovery-01',
    generatedAt: '2026-08-03T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    retryUnfinished: true,
    resumeState: createAuditResumeState({
      candidateGroundingDrafts: [
        {
          schemaVersion: 10,
          phase: 'candidate-grounding',
          ...dependencies,
          candidateGroundingProtocolFingerprint: 'e'.repeat(64),
          runId: 'run-null-grounding-recovery-01',
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
          savedAt: '2026-08-03T12:01:00.000Z',
          groundings: {
            groundings: [{ seedId: 'stale-null-01', disposition: 'no-source-backed-candidate' }],
          },
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
          discoveryObservation: completedStageObservation('investigation', 'stale-discovery-01'),
          modelObservation: completedStageObservation('candidate-grounding', 'stale-grounding-01'),
        },
      ],
    }),
    investigate: async (request) => {
      investigationCalls += 1;
      return {
        seeds: [sourceBackedSeed(vector.vectorId)],
        closures: closuresFor(request, 'candidate-raised'),
        modelObservation: completedStageObservation('investigation', 'recovery-discovery-01'),
      };
    },
    groundCandidates: async (request) => {
      groundingCalls += 1;
      const seed = request.seeds[0];
      if (seed === undefined) throw new Error('Missing recovery seed.');
      return {
        groundings: {
          groundings: [
            {
              seedId: seed.seedId,
              candidate: sourceBackedGroundingCandidate(vector.vectorId),
              nullReason: null,
            },
          ],
        },
        modelObservation: completedStageObservation('candidate-grounding', 'recovery-grounding-01'),
      };
    },
    verify: acceptVerifier,
  });
  expect(investigationCalls).toBe(1);
  expect(groundingCalls).toBe(1);
  expect(report.findings).toHaveLength(1);
});

test('unfinished recovery reuses grounded seeds and dispatches only unresolved seed outcomes', async () => {
  const plan = approvedPlan();
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Missing vector.');
  const dependencies = await defaultCheckpointDependencies(vector);
  const firstSeed = sourceBackedSeed(vector.vectorId);
  const secondSeed = { ...firstSeed, seedId: 'audit-resume-seed-02' };
  const dispatchedSeedIds: string[][] = [];
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
    runId: 'run-mixed-grounding-recovery-01',
    generatedAt: '2026-08-03T12:02:00.000Z',
    mapEvidence,
    assessSourcePosture,
    retryUnfinished: true,
    resumeState: createAuditResumeState({
      candidateGroundingDrafts: [
        {
          schemaVersion: 10,
          phase: 'candidate-grounding',
          ...dependencies,
          candidateGroundingProtocolFingerprint: 'e'.repeat(64),
          runId: 'run-mixed-grounding-recovery-01',
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
          savedAt: '2026-08-03T12:01:00.000Z',
          groundings: {
            groundings: [
              {
                seedId: firstSeed.seedId,
                disposition: 'grounded',
                hypothesis: sourceBackedCanonicalHypothesis(vector.vectorId),
              },
              { seedId: secondSeed.seedId, disposition: 'no-source-backed-candidate' },
            ],
          },
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
          discoveryObservation: completedStageObservation('investigation', 'mixed-discovery-01'),
          modelObservation: completedStageObservation('candidate-grounding', 'mixed-grounding-01'),
        },
      ],
    }),
    investigate: async (request) => ({
      seeds: [firstSeed, secondSeed],
      closures: closuresFor(request, 'candidate-raised'),
      modelObservation: completedStageObservation('investigation', 'mixed-discovery-retry-01'),
    }),
    groundCandidates: async (request) => {
      dispatchedSeedIds.push(request.seeds.map((seed) => seed.seedId));
      return {
        groundings: {
          groundings: [
            {
              seedId: secondSeed.seedId,
              candidate: null,
              nullReason: 'no-source-backed-candidate',
            },
          ],
        },
        modelObservation: completedStageObservation(
          'candidate-grounding',
          'mixed-grounding-retry-01',
        ),
      };
    },
    verify: acceptVerifier,
  });
  expect(dispatchedSeedIds).toEqual([[secondSeed.seedId]]);
  expect(report.findings).toHaveLength(1);
  expect(report.coverage[0]?.candidateGroundingObservation?.usage.modelCallCount).toBe(2);
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
