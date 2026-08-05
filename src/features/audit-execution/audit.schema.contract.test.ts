import { expect, test } from 'bun:test';
import { observeModelStage } from '../model-operations/model-operations.js';
import {
  emptyCandidateIntegrityRejectionLedger,
  emptyHypothesisGroundingFunnel,
} from './admission/funnel.js';
import {
  AuditCandidateAwareCheckpointSchema,
  AuditCandidateGroundingDraftSchema,
  AuditContextOverflowLedgerSchema,
  AuditErrorSchema,
  AuditEvidenceMapDraftSchema,
  AuditReportSchema,
  AuditRunAttemptSchema,
  AuditRunManifestSchema,
  AuditSourcePostureDraftSchema,
  AuditVectorCheckpointSchema,
  FindingAdmissionFunnelSchema,
  isRetryableAuditErrorCode,
  materializeVectorCoverageLimitations,
  SourceDocumentSchema,
  VectorCoverageSchema,
} from './audit.schema.js';

test('source document contract rejects unknown fields', () => {
  expect(
    SourceDocumentSchema.parse({
      path: 'src/app.ts',
      content: 'export {};',
      languageHint: 'typescript',
    }).path,
  ).toBe('src/app.ts');
  expect(() =>
    SourceDocumentSchema.parse({ path: 'src/app.ts', content: 'x', languageHint: null, raw: true }),
  ).toThrow();
});

test('audit reports reject duplicate vector and finding identifiers before lineage can read them', () => {
  const coverage = {
    vectorId: 'vector-contract-01',
    planned: true,
    completed: true,
    matchedSourcePaths: 1,
    evidenceMapFactCount: 1,
    evidenceMapUnansweredObligationCount: 0,
    sourcePostureAssessmentCount: 1,
    sourcePostureSupportedCount: 0,
    sourcePostureContradictedCount: 0,
    sourcePostureInconclusiveCount: 1,
    findingCount: 1,
    outcome: 'completed',
    errorCode: null,
    limitations: [],
    obligationClosure: [
      {
        obligationId: 'contract-obligation-01',
        planObligation: { obligationId: 'contract-obligation-01' },
        mapState: 'mapped',
        evidenceMapFactCount: 1,
        sourcePostureConclusion: 'inconclusive',
        investigationState: 'candidate-raised',
        candidateCount: 1,
        admittedFindingCount: 1,
        terminalDisposition: 'finding-admitted',
      },
    ],
  };
  const finding = {
    findingId: 'finding-contract-01',
    vectorId: 'vector-contract-01',
    narrative: {
      statement: 'The reviewed operation may be reached with an unsafe condition.',
      roleExplanations: [
        { role: 'operation', explanation: 'The operation evidence identifies the action.' },
        {
          role: 'unsafe-condition',
          explanation: 'The condition evidence identifies the unsafe state.',
        },
      ],
      limitations: [],
    },
    claimEvidenceBundles: [
      {
        role: 'operation',
        evidence: [
          {
            path: 'source.unknown',
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
            path: 'source.unknown',
            startLine: 2,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
            role: 'unsafe-condition',
          },
        ],
      },
    ],
    planObligations: [{ obligationId: 'contract-obligation-01' }],
    status: 'accepted',
    verification: { status: 'verified', checks: ['scope'] },
  };
  const report = {
    schemaVersion: 21,
    reportId: 'report-contract-01',
    runId: 'run-contract-01',
    planId: 'plan-contract-01',
    targetFingerprint: 'a'.repeat(64),
    generatedAt: '2026-07-30T12:00:00.000Z',
    coverage: [coverage],
    findings: [finding],
    reviewRequired: [],
    errors: [],
  };
  expect(AuditReportSchema.parse(report).reportId).toBe('report-contract-01');
  expect(() => AuditReportSchema.parse({ ...report, coverage: [coverage, coverage] })).toThrow(
    'coverage vector identifiers',
  );
  expect(() => AuditReportSchema.parse({ ...report, findings: [finding, finding] })).toThrow(
    'finding identifiers',
  );
  expect(() => AuditReportSchema.parse({ ...report, reviewRequired: undefined })).toThrow();
  expect(() =>
    AuditReportSchema.parse({
      ...report,
      findings: [{ ...finding, status: 'candidate' }],
    }),
  ).toThrow();
  expect(() =>
    AuditReportSchema.parse({
      ...report,
      findings: [
        {
          ...finding,
          verification: {
            ...finding.verification,
            reason: 'UNIQUE_PERSISTED_VERIFIER_REASON_SENTINEL',
          },
        },
      ],
    }),
  ).toThrow();
  expect(() => AuditReportSchema.parse({ ...report, chains: [] })).toThrow();
});

test('run manifest rejects unknown fields and preserves only content-free operational metadata', () => {
  expect(
    AuditRunManifestSchema.parse({
      schemaVersion: 2,
      runId: 'audit-run-01',
      command: 'audit',
      startedAt: '2026-07-28T12:00:00.000Z',
      finishedAt: '2026-07-28T12:00:01.000Z',
      targetFingerprint: 'a'.repeat(64),
      planId: 'plan-test-01',
      provider: 'openai',
      model: 'model-name',
      outcome: 'completed',
      counters: { plannedVectors: 1, completedVectors: 1, failedVectors: 0, findingCount: 0 },
    }).outcome,
  ).toBe('completed');
  expect(() =>
    AuditRunManifestSchema.parse({ schemaVersion: 2, runId: 'audit-run-01', rawPrompt: 'secret' }),
  ).toThrow();
});

test('audit attempts have one explicit source-free starting or terminal state', () => {
  const starting = {
    schemaVersion: 3,
    runId: 'audit-run-01',
    planId: 'plan-test-01',
    planDigest: 'a'.repeat(64),
    targetFingerprint: 'b'.repeat(64),
    startedAt: '2026-08-02T12:00:00.000Z',
    finishedAt: null,
    status: 'starting',
    publicReport: null,
    publicationState: 'not-prepared',
    snapshotState: 'not-retained',
  } as const;
  expect(AuditRunAttemptSchema.parse(starting).status).toBe('starting');
  expect(
    AuditRunAttemptSchema.parse({
      ...starting,
      publicReport: {
        reportId: 'report-test-01',
        reportDigest: 'c'.repeat(64),
      },
      publicationState: 'prepared',
      snapshotState: 'retained',
    }).snapshotState,
  ).toBe('retained');
  expect(() =>
    AuditRunAttemptSchema.parse({ ...starting, status: 'completed', finishedAt: null }),
  ).toThrow('completion timestamp');
  expect(
    AuditRunAttemptSchema.parse({
      ...starting,
      finishedAt: '2026-08-02T12:00:01.000Z',
      status: 'completed',
      publicReport: {
        reportId: 'report-test-01',
        reportDigest: 'c'.repeat(64),
      },
      publicationState: 'published',
      snapshotState: 'release-pending',
    }).snapshotState,
  ).toBe('release-pending');
  expect(() =>
    AuditRunAttemptSchema.parse({
      ...starting,
      finishedAt: '2026-08-02T12:00:01.000Z',
      status: 'completed',
      publicReport: null,
      publicationState: 'published',
      snapshotState: 'released',
    }),
  ).toThrow('published public report');
});

test('coverage contract requires an explicit terminal outcome', () => {
  expect(() =>
    VectorCoverageSchema.parse({
      vectorId: 'vector-auth-01',
      planned: true,
      completed: true,
      findingCount: 0,
      outcome: 'unknown',
      errorCode: null,
    }),
  ).toThrow();
});

test('coverage cannot declare completion while an obligation remains incomplete', () => {
  expect(() =>
    VectorCoverageSchema.parse({
      vectorId: 'vector-terminal-contract-01',
      planned: true,
      completed: true,
      matchedSourcePaths: 1,
      evidenceMapFactCount: 1,
      evidenceMapUnansweredObligationCount: 0,
      sourcePostureAssessmentCount: 1,
      sourcePostureSupportedCount: 0,
      sourcePostureContradictedCount: 0,
      sourcePostureInconclusiveCount: 1,
      findingCount: 0,
      outcome: 'completed',
      errorCode: null,
      limitations: [],
      obligationClosure: [
        {
          obligationId: 'terminal-contract-obligation-01',
          planObligation: { obligationId: 'terminal-contract-obligation-01' },
          mapState: 'mapped',
          evidenceMapFactCount: 1,
          sourcePostureConclusion: 'inconclusive',
          investigationState: 'no-source-backed-candidate',
          candidateCount: 0,
          admittedFindingCount: 0,
          terminalDisposition: 'incomplete',
        },
      ],
    }),
  ).toThrow('complete terminal closure');
});

test('vector coverage persists only closed limitation codes', () => {
  const coverage = {
    vectorId: 'vector-limitation-contract-01',
    planned: true,
    completed: false,
    matchedSourcePaths: 0,
    evidenceMapFactCount: 0,
    evidenceMapUnansweredObligationCount: 1,
    sourcePostureAssessmentCount: 0,
    sourcePostureSupportedCount: 0,
    sourcePostureContradictedCount: 0,
    sourcePostureInconclusiveCount: 0,
    findingCount: 0,
    outcome: 'incomplete' as const,
    errorCode: 'coverage-incomplete',
    limitations: ['coverage-incomplete'],
    obligationClosure: [
      {
        obligationId: 'limitation-contract-obligation-01',
        planObligation: { obligationId: 'limitation-contract-obligation-01' },
        mapState: 'unanswered' as const,
        evidenceMapFactCount: 0,
        sourcePostureConclusion: null,
        investigationState: 'not-reached' as const,
        candidateCount: 0,
        admittedFindingCount: 0,
        terminalDisposition: 'incomplete' as const,
      },
    ],
  };
  expect(VectorCoverageSchema.parse(coverage).limitations).toEqual(['coverage-incomplete']);
  expect(() =>
    VectorCoverageSchema.parse({
      ...coverage,
      limitations: ['The model was unable to determine the source boundary.'],
    }),
  ).toThrow('closed durable code');
  expect(
    materializeVectorCoverageLimitations([
      'source-inspection-missing',
      'Model-authored limitation prose.',
      'Model-authored limitation prose.',
    ]),
  ).toEqual(['model-declared-limitation', 'source-inspection-missing']);
});

test('countercheck checkpoints retain the same exact candidate binding as verification', () => {
  const checkpoint = {
    schemaVersion: 5,
    phase: 'countercheck' as const,
    candidateGroundingProtocolFingerprint: 'a'.repeat(64),
    runId: 'audit-countercheck-contract-01',
    planId: 'plan-countercheck-contract-01',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'c'.repeat(64),
    provider: 'openai',
    model: 'model-name',
    verificationRouteFingerprint: 'd'.repeat(64),
    evidenceMapProtocolFingerprint: 'e'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'f'.repeat(64),
    vectorId: 'vector-countercheck-contract-01',
    vectorDigest: '1'.repeat(64),
    candidateOrdinal: 1,
    candidateFingerprint: '2'.repeat(64),
    evidenceMapFingerprint: '3'.repeat(64),
    sourcePostureFingerprint: '4'.repeat(64),
    state: 'pending' as const,
    savedAt: '2026-08-04T12:00:00.000Z',
  };
  expect(AuditCandidateAwareCheckpointSchema.parse(checkpoint).phase).toBe('countercheck');
  expect(() =>
    AuditCandidateAwareCheckpointSchema.parse({ ...checkpoint, candidateFingerprint: undefined }),
  ).toThrow();
});

test('persisted audit errors accept only closed fields and codes', () => {
  const sentinel = 'UNIQUE_AUDIT_ERROR_SENTINEL';
  expect(
    AuditErrorSchema.safeParse({
      code: 'provider-failure',
      stage: 'discovery',
      retryable: false,
    }).success,
  ).toBe(false);
  expect(
    AuditErrorSchema.safeParse({
      code: sentinel,
      stage: 'provider',
      retryable: false,
    }).success,
  ).toBe(false);
  expect(
    AuditErrorSchema.safeParse({
      code: 'provider-failure',
      stage: 'provider',
      message: sentinel,
      retryable: false,
    }).success,
  ).toBe(false);
});

test('centralizes audit retryability by recovery semantics', () => {
  expect(isRetryableAuditErrorCode('provider-rate-limited')).toBe(true);
  expect(isRetryableAuditErrorCode('evidence-map-incomplete')).toBe(true);
  expect(isRetryableAuditErrorCode('validation-repair-no-progress')).toBe(false);
  expect(isRetryableAuditErrorCode('provider-http-error')).toBe(false);
});

test('finding admission funnel is closed and balances every model candidate', () => {
  const funnel = {
    modelCandidateCount: 3,
    integrityRejectedCount: 1,
    toolEvidenceRejectedCount: 0,
    verifierAcceptedCount: 1,
    verifierRejectedCount: 1,
    verifierIncompleteCount: 0,
    verifierToolEvidenceRejectedCount: 0,
    verifierEvidenceRejectedCount: 0,
    verifierReconciledCount: 1,
    postVerificationRejectedCount: 0,
    duplicateCollapsedCount: 0,
    admittedFindingCount: 1,
    verificationTerminalLanes: {
      accepted: 1,
      rejected: 1,
      modelIncomplete: 0,
      stageFailed: 0,
      inspectionMissing: 0,
      wrapperContractInvalid: 0,
    },
  };
  expect(FindingAdmissionFunnelSchema.parse(funnel).admittedFindingCount).toBe(1);
  expect(() => FindingAdmissionFunnelSchema.parse({ ...funnel, admittedFindingCount: 0 })).toThrow(
    'Reconciled verifier results',
  );
  expect(() =>
    FindingAdmissionFunnelSchema.parse({ ...funnel, rawReason: 'source text' }),
  ).toThrow();
});

test('vector checkpoints bind a redacted result to one plan, target, provider, and vector', () => {
  const checkpoint = {
    schemaVersion: 17,
    runId: 'audit-run-01',
    planId: 'plan-test-01',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'a'.repeat(64),
    provider: 'openai',
    model: 'model-name',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
    vectorId: 'vector-auth-01',
    vectorDigest: 'f'.repeat(64),
    savedAt: '2026-07-29T12:00:01.000Z',
    result: {
      coverage: {
        vectorId: 'vector-auth-01',
        planned: true,
        completed: true,
        matchedSourcePaths: 1,
        evidenceMapFactCount: 1,
        evidenceMapUnansweredObligationCount: 0,
        sourcePostureAssessmentCount: 1,
        sourcePostureSupportedCount: 1,
        sourcePostureContradictedCount: 0,
        sourcePostureInconclusiveCount: 0,
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
            sourcePostureConclusion: 'risk-supported',
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
    },
  };
  expect(AuditVectorCheckpointSchema.parse(checkpoint).vectorId).toBe('vector-auth-01');
  expect(() =>
    AuditVectorCheckpointSchema.parse({ ...checkpoint, vectorId: 'vector-other-01' }),
  ).toThrow('must match');
});

test('rejects contradictory persisted coverage counters before a checkpoint can be reused', () => {
  const coverage = {
    vectorId: 'vector-conservation-01',
    planned: true,
    completed: false,
    matchedSourcePaths: 1,
    evidenceMapFactCount: 0,
    evidenceMapUnansweredObligationCount: 1,
    sourcePostureAssessmentCount: 1,
    sourcePostureSupportedCount: 0,
    sourcePostureContradictedCount: 0,
    sourcePostureInconclusiveCount: 1,
    sourcePostureNotApplicableCount: 0,
    findingCount: 0,
    reviewRequiredCount: 0,
    outcome: 'incomplete' as const,
    errorCode: 'obligation-closure-incomplete',
    limitations: [],
    obligationClosure: [
      {
        obligationId: 'conservation-obligation-01',
        planObligation: { obligationId: 'conservation-obligation-01' },
        mapState: 'mapped' as const,
        evidenceMapFactCount: 1,
        sourcePostureConclusion: 'inconclusive' as const,
        investigationState: 'incomplete' as const,
        candidateCount: 0,
        admittedFindingCount: 0,
        terminalDisposition: 'incomplete' as const,
      },
    ],
  };
  expect(() => VectorCoverageSchema.parse(coverage)).toThrow('Evidence-map facts');
  expect(() =>
    VectorCoverageSchema.parse({
      ...coverage,
      evidenceMapFactCount: 1,
      evidenceMapUnansweredObligationCount: 0,
      sourcePostureAssessmentCount: 0,
    }),
  ).toThrow('Source-posture counters');
});

test('candidate-grounding drafts bind canonical candidates without retaining raw model content', () => {
  const draft = {
    schemaVersion: 11,
    phase: 'candidate-grounding',
    candidateGroundingProtocolFingerprint: 'e'.repeat(64),
    evidenceMapFingerprint: '1'.repeat(64),
    sourcePostureFingerprint: '2'.repeat(64),
    runId: 'audit-run-01',
    planId: 'plan-test-01',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'a'.repeat(64),
    provider: 'openai',
    model: 'model-name',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
    vectorId: 'vector-auth-01',
    vectorDigest: 'f'.repeat(64),
    savedAt: '2026-07-29T12:00:01.000Z',
    groundings: { groundings: [] },
    closures: [
      {
        planObligation: { obligationId: 'draft-obligation-01' },
        disposition: 'no-source-backed-candidate',
        evidenceMapFactIds: ['fact-auth-01'],
        sourcePostureAssessmentIds: ['posture-auth-01'],
        limitations: [],
      },
    ],
    hypothesisGroundingFunnel: emptyHypothesisGroundingFunnel(),
    candidateIntegrityRejections: emptyCandidateIntegrityRejectionLedger(),
    discoveryObservation: observeModelStage({
      stage: 'investigation',
      route: 'primary',
      stageId: 'draft-discovery-01',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [],
      pricing: {},
      cacheRoutingEnabled: false,
    }),
    modelObservation: observeModelStage({
      stage: 'candidate-grounding',
      route: 'primary',
      stageId: 'draft-grounding-01',
      status: 'completed',
      durationMs: 1,
      errorCode: null,
      requests: [],
      pricing: {},
      cacheRoutingEnabled: false,
    }),
  };
  expect(AuditCandidateGroundingDraftSchema.parse(draft).phase).toBe('candidate-grounding');
  expect(() =>
    AuditCandidateGroundingDraftSchema.parse({ ...draft, candidateIntegrityRejections: undefined }),
  ).toThrow();
  expect(() => AuditCandidateGroundingDraftSchema.parse({ ...draft, schemaVersion: 1 })).toThrow();
  expect(() =>
    AuditCandidateGroundingDraftSchema.parse({ ...draft, rawModelOutput: 'sensitive content' }),
  ).toThrow();
});

test('source posture drafts preserve only the reusable candidate-blind assessment', () => {
  const draft = {
    schemaVersion: 4,
    phase: 'source-posture',
    evidenceMapFingerprint: '1'.repeat(64),
    runId: 'audit-run-01',
    planId: 'plan-test-01',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'a'.repeat(64),
    provider: 'openai',
    model: 'model-name',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
    vectorId: 'vector-auth-01',
    vectorDigest: 'f'.repeat(64),
    savedAt: '2026-07-30T12:00:01.000Z',
    sourcePosture: { assessments: [], limitations: [] },
    execution: { kind: 'deterministic' },
  };
  expect(AuditSourcePostureDraftSchema.parse(draft).phase).toBe('source-posture');
  expect(() => AuditSourcePostureDraftSchema.parse({ ...draft, findings: [] })).toThrow();
  expect(() => AuditSourcePostureDraftSchema.parse({ ...draft, execution: undefined })).toThrow();
  expect(() =>
    AuditSourcePostureDraftSchema.parse({ ...draft, execution: { kind: 'provider' } }),
  ).toThrow();
});

test('reusable audit decisions require explicit execution ownership', () => {
  const mapDraft = {
    schemaVersion: 5,
    phase: 'evidence-mapping',
    runId: 'audit-run-01',
    planId: 'plan-test-01',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'a'.repeat(64),
    provider: 'openai',
    model: 'model-name',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
    vectorId: 'vector-auth-01',
    vectorDigest: 'f'.repeat(64),
    savedAt: '2026-07-30T12:00:01.000Z',
    evidenceMap: {
      facts: [],
      unansweredPlanObligations: [],
      limitations: [],
    },
    evidenceMapFingerprint: '1'.repeat(64),
    repairAttempts: [],
    execution: { kind: 'deterministic' },
  };
  expect(AuditEvidenceMapDraftSchema.parse(mapDraft).execution.kind).toBe('deterministic');
  expect(() => AuditEvidenceMapDraftSchema.parse({ ...mapDraft, execution: undefined })).toThrow();
  expect(() =>
    AuditEvidenceMapDraftSchema.parse({
      ...mapDraft,
      modelObservation: observeModelStage({
        stage: 'evidence-mapping',
        route: 'primary',
        stageId: 'forbidden-top-level-observation',
        status: 'completed',
        durationMs: 1,
        errorCode: null,
        requests: [],
        pricing: {},
        cacheRoutingEnabled: false,
      }),
    }),
  ).toThrow();
});

test('context-overflow ledgers retain only ordered source-free topology', () => {
  const ledger = {
    schemaVersion: 3,
    phase: 'evidence-mapping',
    phaseInputFingerprint: '0'.repeat(64),
    runId: 'audit-run-01',
    planId: 'plan-test-01',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'a'.repeat(64),
    provider: 'openai',
    model: 'model-name',
    verificationRouteFingerprint: 'c'.repeat(64),
    evidenceMapProtocolFingerprint: 'd'.repeat(64),
    reviewWorkflowProtocolFingerprint: 'e'.repeat(64),
    vectorId: 'vector-auth-01',
    vectorDigest: 'f'.repeat(64),
    parentStageId: 'vector-auth-01',
    recoveryProtocolFingerprint: '1'.repeat(64),
    rootScopeFingerprint: '2'.repeat(64),
    events: [
      {
        ordinal: 1,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: '3'.repeat(64),
        state: 'pending',
        errorCode: null,
        savedAt: '2026-08-03T12:00:00.000Z',
      },
      {
        ordinal: 2,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: '3'.repeat(64),
        state: 'running',
        errorCode: null,
        savedAt: '2026-08-03T12:00:01.000Z',
      },
      {
        ordinal: 3,
        childKey: 'root',
        attempt: 1,
        scopeFingerprint: '3'.repeat(64),
        state: 'overflowed',
        errorCode: 'provider-context-overflow',
        execution: {
          kind: 'provider',
          modelObservation: observeModelStage({
            stage: 'evidence-mapping',
            route: 'primary',
            stageId: 'overflowed-root-01',
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
    ],
  };
  expect(AuditContextOverflowLedgerSchema.parse(ledger).events).toHaveLength(3);
  expect(() =>
    AuditContextOverflowLedgerSchema.parse({
      ...ledger,
      events: [{ ...ledger.events[0], ordinal: 2 }],
    }),
  ).toThrow('ordinals');
  expect(() =>
    AuditContextOverflowLedgerSchema.parse({ ...ledger, sourcePaths: ['src/app.ts'] }),
  ).toThrow();
  expect(() =>
    AuditContextOverflowLedgerSchema.parse({ ...ledger, phaseInputFingerprint: undefined }),
  ).toThrow();
  expect(() =>
    AuditContextOverflowLedgerSchema.parse({
      ...ledger,
      events: [{ ...ledger.events[2], execution: { kind: 'deterministic' } }],
    }),
  ).toThrow('provider observation');
  expect(() =>
    AuditContextOverflowLedgerSchema.parse({
      ...ledger,
      events: [{ ...ledger.events[2], execution: undefined }],
    }),
  ).toThrow('must declare provider or deterministic execution');
  expect(() =>
    AuditContextOverflowLedgerSchema.parse({
      ...ledger,
      events: [{ ...ledger.events[2], state: 'overflowed', errorCode: 'provider-failure' }],
    }),
  ).toThrow('normalized overflow code');
});
