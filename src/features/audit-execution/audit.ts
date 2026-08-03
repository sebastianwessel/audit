import { createStableId } from '../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { assertPlanMatchesTarget } from '../attack-planning/plan.js';
import type { AttackPlan, ProposedFinding } from '../attack-planning/plan.schema.js';
import { hasExactPlanObligations } from '../attack-planning/plan.schema.js';
import { hasSuccessfulScopedSourceInspection } from '../model-operations/model-operations.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';
import { createFindingAdmissionFunnel, emptyFindingAdmissionFunnel } from './admission/funnel.js';
import {
  type AuditCandidateAwareCheckpoint,
  type AuditCandidateGroundingDraft,
  AuditCandidateGroundingDraftSchema,
  type AuditCandidateGroundingRecoveryLeaf,
  type AuditContextOverflowLedger,
  type AuditError,
  type AuditEvidenceMapDraft,
  type AuditEvidenceMapRecoveryLeaf,
  type AuditInvestigationRequest,
  AuditInvestigationRequestSchema,
  type AuditReport,
  AuditReportSchema,
  type AuditSourcePostureDraft,
  type AuditSourcePostureRecoveryLeaf,
  type AuditVectorResult,
  AuditVectorResultSchema,
  CandidateIntegrityRejectionLedgerSchema,
  DiscoveryIntegrityRejectionLedgerSchema,
  MaxParallelVectorsSchema,
  type PersistedCandidateAwareResult,
  type SourceDocument,
  type VectorCoverage,
} from './audit.schema.js';
import {
  type CandidateAwareDispatchPool,
  createCandidateAwareDispatchPool,
} from './candidate-aware-dispatch.js';
import { candidateAwareFingerprint } from './candidate-aware-identity.js';
import {
  type CandidateGroundingOutput,
  type CandidateGroundingRequest,
  CandidateGroundingRequestSchema,
  type CanonicalCandidateGroundingOutput,
} from './candidate-grounding/contract.js';
import {
  selectCanonicalSeedBoundGroundings,
  selectSeedBoundGroundings,
} from './candidate-grounding/identity.js';
import {
  deriveObligationClosureMatrix,
  hasCompleteObligationClosure,
} from './coverage-closure/derive.js';
import { verifyInvestigationClosures } from './coverage-closure/verify.js';
import {
  type EvidenceMap,
  mappedControlFactIdsForObligation,
  type UnverifiedEvidenceMap,
} from './evidence-map/contract.js';
import { verifyEvidenceMap } from './evidence-map/verify.js';
import type {
  HypothesisSeed,
  UnverifiedInvestigationObligationClosure,
} from './investigation/contract.js';
import {
  CandidateStructuralRejectionReasonSchema,
  HypothesisSeedStructuralRejectionReasonSchema,
} from './investigation/contract.js';
import { buildInvestigationEvidencePackage } from './investigation/evidence-package.js';
import { selectScopedSources } from './investigation/scope.js';
import { verifyHypothesisSeeds } from './investigation/seed.js';
import { verifyModelFindings } from './investigation/verify.js';
import type { EvidenceMapRequest, SourcePostureRequest } from './phase-input/contract.js';
import type { SourcePosture, UnverifiedSourcePosture } from './source-posture/contract.js';
import { downgradeUninspectedSourcePosture, verifySourcePosture } from './source-posture/verify.js';
import {
  redactProposedFinding,
  synthesizeFindings,
  synthesizeReviewRequiredFindings,
} from './synthesis/findings.js';
import { classifyAuditTerminal } from './terminal-classification.js';
import {
  type AuditCountercheckRequest,
  AuditCountercheckRequestSchema,
  type AuditVerificationRequest,
  AuditVerificationRequestSchema,
  type AuditVerificationResult,
  AuditVerificationResultSchema,
  type PlanObligationReconciliation,
  type SourcePostureReconciliation,
  terminalLaneForVerificationDecision,
  type VerifiableHypothesis,
  VerifiableHypothesisSchema,
  type VerificationTerminalLane,
  VerificationTerminalLaneSchema,
} from './verification/contract.js';

export type AuditInvestigationResult = Readonly<{
  seeds: readonly HypothesisSeed[];
  closures: readonly UnverifiedInvestigationObligationClosure[];
  modelObservation?: ModelStageObservation;
}>;

export type AuditInvestigator = (
  request: AuditInvestigationRequest,
  context?: AuditScopedStageContext,
) => Promise<AuditInvestigationResult>;

export type AuditEvidenceMapper = (
  request: EvidenceMapRequest,
  context?: AuditScopedStageContext,
) => Promise<
  Readonly<{ evidenceMap: UnverifiedEvidenceMap; modelObservation?: ModelStageObservation }>
>;

export type AuditSourcePostureAssessor = (
  request: SourcePostureRequest,
  context?: AuditScopedStageContext,
) => Promise<
  Readonly<{ sourcePosture: UnverifiedSourcePosture; modelObservation?: ModelStageObservation }>
>;

export type AuditCandidateGrounder = (
  request: CandidateGroundingRequest,
  context?: AuditScopedStageContext,
) => Promise<
  Readonly<{
    groundings: CandidateGroundingOutput | CanonicalCandidateGroundingOutput;
    modelObservation?: ModelStageObservation;
  }>
>;

function isCanonicalGroundingOutput(
  output: CandidateGroundingOutput | CanonicalCandidateGroundingOutput,
): output is CanonicalCandidateGroundingOutput {
  const first = output.groundings[0];
  return first !== undefined && 'disposition' in first;
}

/** Raw stage result is parsed at the admission boundary; legacy/malformed output fails closed. */
export type AuditVerificationResultWithObservation = Readonly<{
  decision: AuditVerificationResult['decision'];
  reason: string;
  verifiedEvidence: AuditVerificationResult['verifiedEvidence'];
  verifiedPlanObligations: AuditVerificationResult['verifiedPlanObligations'];
  controlAssessment?: AuditVerificationResult['controlAssessment'];
  obligationReconciliations?: AuditVerificationResult['obligationReconciliations'];
  postureReconciliations?: AuditVerificationResult['postureReconciliations'];
  modelObservation?: ModelStageObservation;
  /** Optional only at external test ports; production stages always declare a lane. */
  terminalLane?: VerificationTerminalLane;
}>;

export type AuditVerifier = (
  request: AuditVerificationRequest,
) => Promise<AuditVerificationResultWithObservation>;

export type AuditCounterchecker = (
  request: AuditCountercheckRequest,
) => Promise<AuditVerificationResultWithObservation>;

export type CandidateAwareCheckpointUpdate = Readonly<{
  vectorId: string;
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
  candidate: VerifiableHypothesis;
  state: AuditCandidateAwareCheckpoint['state'];
  result?: PersistedCandidateAwareResult;
}>;

/** Source-free recovery context passed only to a scoped reducible model stage. */
export type AuditScopedStageContext = Readonly<{
  priorContextOverflowLedger?: AuditContextOverflowLedger;
  priorEvidenceMapRecoveryLeaves?: readonly AuditEvidenceMapRecoveryLeaf[];
  priorSourcePostureRecoveryLeaves?: readonly AuditSourcePostureRecoveryLeaf[];
  priorCandidateGroundingRecoveryLeaves?: readonly AuditCandidateGroundingRecoveryLeaf[];
  onContextOverflowTransition?: (update: AuditContextOverflowTransition) => Promise<void>;
  onEvidenceMapRecoveryLeaf?: (update: AuditEvidenceMapRecoveryLeafUpdate) => Promise<void>;
  onSourcePostureRecoveryLeaf?: (update: AuditSourcePostureRecoveryLeafUpdate) => Promise<void>;
  onCandidateGroundingRecoveryLeaf?: (
    update: AuditCandidateGroundingRecoveryLeafUpdate,
  ) => Promise<void>;
}>;

/** One durable topology transition; it deliberately contains neither source nor model content. */
export type AuditContextOverflowTransition = Readonly<{
  vectorId: string;
  phase: AuditContextOverflowLedger['phase'];
  parentStageId: AuditContextOverflowLedger['parentStageId'];
  recoveryProtocolFingerprint: AuditContextOverflowLedger['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditContextOverflowLedger['rootScopeFingerprint'];
  event: Omit<AuditContextOverflowLedger['events'][number], 'ordinal' | 'savedAt'>;
}>;

/** A validated, redacted evidence-map child result ready for exact reuse. */
export type AuditEvidenceMapRecoveryLeafUpdate = Readonly<{
  vectorId: string;
  parentStageId: AuditEvidenceMapRecoveryLeaf['parentStageId'];
  recoveryProtocolFingerprint: AuditEvidenceMapRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditEvidenceMapRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditEvidenceMapRecoveryLeaf['childKey'];
  scopeFingerprint: AuditEvidenceMapRecoveryLeaf['scopeFingerprint'];
  evidenceMap: AuditEvidenceMapRecoveryLeaf['evidenceMap'];
}>;

export type AuditSourcePostureRecoveryLeafUpdate = Readonly<{
  vectorId: string;
  parentStageId: AuditSourcePostureRecoveryLeaf['parentStageId'];
  recoveryProtocolFingerprint: AuditSourcePostureRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditSourcePostureRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditSourcePostureRecoveryLeaf['childKey'];
  scopeFingerprint: AuditSourcePostureRecoveryLeaf['scopeFingerprint'];
  sourcePosture: AuditSourcePostureRecoveryLeaf['sourcePosture'];
}>;

/** A canonical, source-validated grounding child result ready for exact reuse. */
export type AuditCandidateGroundingRecoveryLeafUpdate = Readonly<{
  vectorId: string;
  parentStageId: AuditCandidateGroundingRecoveryLeaf['parentStageId'];
  recoveryProtocolFingerprint: AuditCandidateGroundingRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditCandidateGroundingRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditCandidateGroundingRecoveryLeaf['childKey'];
  scopeFingerprint: AuditCandidateGroundingRecoveryLeaf['scopeFingerprint'];
  groundings: AuditCandidateGroundingRecoveryLeaf['groundings'];
}>;

export type AuditInput = Readonly<{
  plan: AttackPlan;
  targetFingerprint: string;
  contextDigest: string;
  sources: readonly SourceDocument[];
  runId: string;
  generatedAt: string;
  mapEvidence?: AuditEvidenceMapper;
  assessSourcePosture?: AuditSourcePostureAssessor;
  groundCandidates?: AuditCandidateGrounder;
  investigate: AuditInvestigator;
  verify: AuditVerifier;
  /** Evaluation-only: production admission currently relies on verifier evidence alone. */
  countercheck?: AuditCounterchecker;
  maxParallelVectors?: number;
  priorVectorResults?: readonly AuditVectorResult[];
  priorCandidateGroundingDrafts?: readonly AuditCandidateGroundingDraft[];
  priorCandidateAwareCheckpoints?: readonly AuditCandidateAwareCheckpoint[];
  priorEvidenceMapDrafts?: readonly AuditEvidenceMapDraft[];
  priorSourcePostureDrafts?: readonly AuditSourcePostureDraft[];
  priorContextOverflowLedgers?: readonly AuditContextOverflowLedger[];
  priorEvidenceMapRecoveryLeaves?: readonly AuditEvidenceMapRecoveryLeaf[];
  priorSourcePostureRecoveryLeaves?: readonly AuditSourcePostureRecoveryLeaf[];
  priorCandidateGroundingRecoveryLeaves?: readonly AuditCandidateGroundingRecoveryLeaf[];
  /** Re-executes only terminal candidate-aware incompleteness when explicitly requested. */
  retryUnfinished?: boolean;
  onEvidenceMapDraft?: (
    draft: Pick<AuditEvidenceMapDraft, 'vectorId' | 'evidenceMap' | 'modelObservation'>,
  ) => Promise<void>;
  onCandidateGroundingDraft?: (
    draft: Pick<
      AuditCandidateGroundingDraft,
      | 'vectorId'
      | 'findings'
      | 'closures'
      | 'hypothesisGroundingFunnel'
      | 'candidateIntegrityRejections'
      | 'discoveryObservation'
      | 'modelObservation'
    >,
  ) => Promise<void>;
  onCandidateAwareCheckpoint?: (update: CandidateAwareCheckpointUpdate) => Promise<void>;
  onSourcePostureDraft?: (
    draft: Pick<AuditSourcePostureDraft, 'vectorId' | 'sourcePosture' | 'modelObservation'>,
  ) => Promise<void>;
  onContextOverflowTransition?: (update: AuditContextOverflowTransition) => Promise<void>;
  onEvidenceMapRecoveryLeaf?: (update: AuditEvidenceMapRecoveryLeafUpdate) => Promise<void>;
  onSourcePostureRecoveryLeaf?: (update: AuditSourcePostureRecoveryLeafUpdate) => Promise<void>;
  onCandidateGroundingRecoveryLeaf?: (
    update: AuditCandidateGroundingRecoveryLeafUpdate,
  ) => Promise<void>;
  onVectorResult?: (result: AuditVectorResult) => Promise<void>;
}>;

/** Executes a matching strict plan without invoking model code directly. */
export async function runAudit(input: AuditInput): Promise<AuditReport> {
  assertPlanMatchesTarget(input.plan, input.targetFingerprint, input.contextDigest);
  const maxParallelVectors = MaxParallelVectorsSchema.parse(input.maxParallelVectors ?? 1);
  const candidateAwareDispatchPool = createCandidateAwareDispatchPool(maxParallelVectors);
  const priorByVectorId = new Map(
    (input.priorVectorResults ?? []).map((result) => [result.coverage.vectorId, result] as const),
  );
  const vectorResults = await mapWithConcurrency(
    input.plan.vectors,
    maxParallelVectors,
    async (vector) => {
      const prior = priorByVectorId.get(vector.vectorId);
      if (prior !== undefined) return AuditVectorResultSchema.parse(prior);
      const result = await executeVector(input, vector, candidateAwareDispatchPool);
      await input.onVectorResult?.(result);
      return result;
    },
  );
  const coverage = vectorResults.map((result) => result.coverage);
  const errors = vectorResults.flatMap((result) => result.errors);
  const proposed = vectorResults.flatMap((result) => result.proposed);
  const reviewRequired = vectorResults.flatMap((result) => result.reviewRequired);
  const findings = synthesizeFindings(proposed);
  return AuditReportSchema.parse({
    schemaVersion: 15,
    reportId: createStableId('report', `${input.plan.planId}\0${input.runId}`),
    runId: input.runId,
    planId: input.plan.planId,
    targetFingerprint: input.targetFingerprint,
    generatedAt: input.generatedAt,
    coverage,
    findings,
    reviewRequired: synthesizeReviewRequiredFindings(reviewRequired),
    errors,
  });
}

async function executeVector(
  input: AuditInput,
  vector: AttackPlan['vectors'][number],
  candidateAwareDispatchPool: CandidateAwareDispatchPool,
): Promise<AuditVectorResult> {
  if (!vector.enabled) {
    return {
      coverage: skippedCoverage(vector, 'The reviewer disabled this vector.'),
      errors: [],
      proposed: [],
      reviewRequired: [],
    };
  }
  const scopedSources = selectScopedSources(vector, input.sources);
  if (scopedSources.length === 0) {
    return {
      coverage: emptyScopeCoverage(
        vector,
        'No admitted repository source files matched this vector scope; revise the plan scope or provide a source-backed applicability decision.',
      ),
      errors: [],
      proposed: [],
      reviewRequired: [],
    };
  }
  const evidencePackage = buildInvestigationEvidencePackage(scopedSources, []);
  let activeStage: AuditError['stage'] = 'evidence-mapping';
  let retainedEvidenceMapObservation: ModelStageObservation | undefined;
  let retainedSourcePostureObservation: ModelStageObservation | undefined;
  let retainedInvestigationObservation: ModelStageObservation | undefined;
  let retainedCandidateGroundingObservation: ModelStageObservation | undefined;
  let retainedVerificationObservations: readonly ModelStageObservation[] = [];
  let retainedCountercheckObservations: readonly ModelStageObservation[] = [];
  try {
    const mapRequest = {
      vector,
      availableSourcePaths: scopedSources.map((source) => source.path),
      limitations: [...evidencePackage.limitations],
    };
    const priorMapDraft = input.priorEvidenceMapDrafts?.find(
      (draft) => draft.vectorId === vector.vectorId,
    );
    activeStage = 'evidence-mapping';
    const mapped =
      priorMapDraft === undefined
        ? input.mapEvidence === undefined
          ? {
              evidenceMap: {
                facts: [],
                controlCoverage: [],
                unansweredPlanObligations: [],
                limitations: [],
              },
            }
          : await input.mapEvidence(
              mapRequest,
              scopedStageContext(input, vector.vectorId, 'evidence-mapping'),
            )
        : {
            evidenceMap: priorMapDraft.evidenceMap,
            modelObservation: priorMapDraft.modelObservation,
          };
    retainedEvidenceMapObservation = mapped.modelObservation;
    if (mapped.modelObservation?.status === 'failed') {
      return failedEvidenceMapResult(
        vector,
        scopedSources.length,
        evidencePackage.limitations,
        mapped.modelObservation.errorCode ?? 'provider-failure',
        mapped.modelObservation,
      );
    }
    const verifiedMap = verifyEvidenceMap(vector, mapped.evidenceMap, scopedSources);
    const mapRequiresToolEvidence =
      verifiedMap.evidenceMap.facts.length > 0 &&
      mapped.modelObservation !== undefined &&
      !hasSuccessfulScopedSourceInspection(mapped.modelObservation.toolUsage);
    if (
      mapRequiresToolEvidence ||
      verifiedMap.evidenceMap.facts.length === 0 ||
      !verifiedMap.complete
    ) {
      return incompleteEvidenceMapResult({
        vector,
        matchedSourcePaths: scopedSources.length,
        limitations: [
          ...evidencePackage.limitations,
          ...verifiedMap.evidenceMap.limitations,
          ...(mapRequiresToolEvidence
            ? ['Source-backed evidence mapping requires a scoped read or search call.']
            : !verifiedMap.complete
              ? ['The evidence map did not explicitly represent every approved review obligation.']
              : ['No source-backed evidence facts were mapped for this vector.']),
        ],
        errorCode: mapRequiresToolEvidence ? 'tool-evidence-required' : 'evidence-map-incomplete',
        modelObservation: mapped.modelObservation,
      });
    }
    if (priorMapDraft === undefined) {
      await input.onEvidenceMapDraft?.({
        vectorId: vector.vectorId,
        evidenceMap: verifiedMap.evidenceMap,
        ...(mapped.modelObservation === undefined
          ? {}
          : { modelObservation: mapped.modelObservation }),
      });
    }
    const postureRequest = {
      ...mapRequest,
      evidenceMap: verifiedMap.evidenceMap,
    };
    const priorSourcePostureDraft = input.priorSourcePostureDrafts?.find(
      (draft) => draft.vectorId === vector.vectorId,
    );
    activeStage = 'source-posture';
    const assessed =
      priorSourcePostureDraft === undefined
        ? input.assessSourcePosture === undefined
          ? {
              sourcePosture: {
                assessments: [],
                limitations: ['Static audit has no candidate-blind source posture assessor.'],
              },
            }
          : await input.assessSourcePosture(
              postureRequest,
              scopedStageContext(input, vector.vectorId, 'source-posture'),
            )
        : {
            sourcePosture: priorSourcePostureDraft.sourcePosture,
            modelObservation: priorSourcePostureDraft.modelObservation,
          };
    retainedSourcePostureObservation = assessed.modelObservation;
    if (assessed.modelObservation?.status === 'failed') {
      return failedSourcePostureResult({
        vector,
        matchedSourcePaths: scopedSources.length,
        evidenceMap: verifiedMap.evidenceMap,
        limitations: [...evidencePackage.limitations, ...verifiedMap.evidenceMap.limitations],
        errorCode: assessed.modelObservation.errorCode ?? 'provider-failure',
        evidenceMapObservation: mapped.modelObservation,
        sourcePostureObservation: assessed.modelObservation,
      });
    }
    const initialSourcePosture = verifySourcePosture(
      vector,
      assessed.sourcePosture,
      verifiedMap.evidenceMap,
    );
    const postureRequiresToolEvidence =
      initialSourcePosture.sourcePosture.assessments.some(
        (assessment) => assessment.conclusion !== 'inconclusive',
      ) &&
      assessed.modelObservation !== undefined &&
      !hasSuccessfulScopedSourceInspection(assessed.modelObservation.toolUsage);
    const verifiedSourcePosture = {
      ...initialSourcePosture,
      sourcePosture: postureRequiresToolEvidence
        ? downgradeUninspectedSourcePosture(initialSourcePosture.sourcePosture)
        : initialSourcePosture.sourcePosture,
    };
    if (!verifiedSourcePosture.complete) {
      return incompleteSourcePostureResult({
        vector,
        matchedSourcePaths: scopedSources.length,
        evidenceMap: verifiedMap.evidenceMap,
        sourcePosture: verifiedSourcePosture.sourcePosture,
        limitations: [
          ...evidencePackage.limitations,
          ...verifiedMap.evidenceMap.limitations,
          ...verifiedSourcePosture.sourcePosture.limitations,
        ],
        errorCode: 'source-posture-incomplete',
        evidenceMapObservation: mapped.modelObservation,
        sourcePostureObservation: assessed.modelObservation,
      });
    }
    if (priorSourcePostureDraft === undefined) {
      await input.onSourcePostureDraft?.({
        vectorId: vector.vectorId,
        sourcePosture: verifiedSourcePosture.sourcePosture,
        ...(assessed.modelObservation === undefined
          ? {}
          : { modelObservation: assessed.modelObservation }),
      });
    }
    const priorDraft = input.priorCandidateGroundingDrafts?.find(
      (draft) => draft.vectorId === vector.vectorId,
    );
    activeStage = 'investigation';
    const discovery =
      priorDraft === undefined
        ? await input.investigate(
            AuditInvestigationRequestSchema.parse({
              ...postureRequest,
              sourcePosture: verifiedSourcePosture.sourcePosture,
            }),
            scopedStageContext(input, vector.vectorId, 'investigation'),
          )
        : undefined;
    const investigationObservation =
      priorDraft?.discoveryObservation ?? discovery?.modelObservation;
    retainedInvestigationObservation = investigationObservation;
    if (investigationObservation?.status === 'failed') {
      return failedInvestigationResult(
        vector,
        scopedSources.length,
        0,
        evidencePackage.limitations,
        investigationObservation.errorCode ?? 'provider-failure',
        investigationObservation,
      );
    }
    const verifiedClosures = verifyInvestigationClosures(
      vector,
      priorDraft?.closures ?? discovery?.closures ?? [],
      verifiedMap.evidenceMap,
      verifiedSourcePosture.sourcePosture,
    );
    if (!verifiedClosures.complete) {
      return incompleteInvestigationClosureResult({
        vector,
        matchedSourcePaths: scopedSources.length,
        evidenceMap: verifiedMap.evidenceMap,
        sourcePosture: verifiedSourcePosture.sourcePosture,
        limitations: [
          ...evidencePackage.limitations,
          ...verifiedMap.evidenceMap.limitations,
          ...verifiedSourcePosture.sourcePosture.limitations,
          'The investigator did not close every declared review obligation with valid phase references.',
        ],
        evidenceMapObservation: mapped.modelObservation,
        sourcePostureObservation: assessed.modelObservation,
        modelObservation: investigationObservation,
      });
    }
    const verifiedSeeds = verifyHypothesisSeeds(
      vector,
      discovery?.seeds ?? [],
      verifiedMap.evidenceMap,
      verifiedSourcePosture.sourcePosture,
    );
    const discoveryIntegrityRejections = DiscoveryIntegrityRejectionLedgerSchema.parse(
      Object.fromEntries(
        HypothesisSeedStructuralRejectionReasonSchema.options.map((reason) => [
          reason,
          verifiedSeeds.rejected.filter((rejection) => rejection.reason === reason).length,
        ]),
      ),
    );
    activeStage = 'candidate-grounding';
    const grounding =
      priorDraft !== undefined ||
      verifiedSeeds.verified.length === 0 ||
      input.groundCandidates === undefined
        ? undefined
        : await input.groundCandidates(
            CandidateGroundingRequestSchema.parse({
              vector,
              evidenceMap: verifiedMap.evidenceMap,
              sourcePosture: verifiedSourcePosture.sourcePosture,
              seeds: verifiedSeeds.verified,
              availableSourcePaths: scopedSources.map((source) => source.path),
            }),
            scopedStageContext(input, vector.vectorId, 'candidate-grounding'),
          );
    if (grounding?.modelObservation?.status === 'failed') {
      return failedInvestigationResult(
        vector,
        scopedSources.length,
        verifiedMap.evidenceMap.facts.length,
        evidencePackage.limitations,
        grounding.modelObservation.errorCode ?? 'provider-failure',
        grounding.modelObservation,
      );
    }
    const selectedGroundings =
      priorDraft !== undefined
        ? {
            candidates: priorDraft.findings,
            seedBoundCandidates: [],
            submittedCount: priorDraft.findings.length,
            nullCount: 0,
            rejectedCount: 0,
          }
        : grounding === undefined
          ? {
              candidates: [],
              seedBoundCandidates: [],
              submittedCount: 0,
              nullCount: 0,
              rejectedCount: verifiedSeeds.verified.length,
            }
          : isCanonicalGroundingOutput(grounding.groundings)
            ? selectCanonicalSeedBoundGroundings(verifiedSeeds.verified, grounding.groundings)
            : selectSeedBoundGroundings(
                verifiedSeeds.verified,
                grounding.groundings,
                verifiedMap.evidenceMap,
              );
    const traceBoundCandidates = {
      candidates: priorDraft === undefined ? selectedGroundings.candidates : priorDraft.findings,
      rejectedCount: 0,
    };
    const hypothesisGroundingFunnel = priorDraft?.hypothesisGroundingFunnel ?? {
      discoveredSeedCount: discovery?.seeds.length ?? 0,
      discoveryBindingRejectedCount: verifiedSeeds.rejectedCount,
      discoveryIntegrityRejections,
      groundingNullCount: selectedGroundings.nullCount,
      groundingBindingRejectedCount: selectedGroundings.rejectedCount,
      submittedCandidateCount: traceBoundCandidates.candidates.length,
    };
    const initiallyVerified = verifyModelFindings(
      vector,
      traceBoundCandidates.candidates,
      scopedSources,
      verifiedMap.evidenceMap,
      verifiedSourcePosture.sourcePosture,
    );
    const verifiedModel = {
      verified: initiallyVerified.verified,
      rejectedCount: initiallyVerified.rejectedCount,
    };
    const candidateIntegrityRejections =
      priorDraft?.candidateIntegrityRejections ??
      CandidateIntegrityRejectionLedgerSchema.parse(
        Object.fromEntries(
          CandidateStructuralRejectionReasonSchema.options.map((reason) => [
            reason,
            initiallyVerified.rejected.filter((rejection) => rejection.reason === reason).length,
          ]),
        ),
      );
    const candidateGroundingObservation =
      priorDraft?.modelObservation ?? grounding?.modelObservation;
    retainedCandidateGroundingObservation = candidateGroundingObservation;
    if (priorDraft === undefined && grounding?.modelObservation?.status === 'completed') {
      await input.onCandidateGroundingDraft?.({
        vectorId: vector.vectorId,
        findings: AuditCandidateGroundingDraftSchema.shape.findings.parse(
          verifiedModel.verified.map(redactVerifiableHypothesis),
        ),
        closures: AuditCandidateGroundingDraftSchema.shape.closures.parse(
          verifiedClosures.closures,
        ),
        hypothesisGroundingFunnel:
          AuditCandidateGroundingDraftSchema.shape.hypothesisGroundingFunnel.parse(
            hypothesisGroundingFunnel,
          ),
        candidateIntegrityRejections:
          AuditCandidateGroundingDraftSchema.shape.candidateIntegrityRejections.parse(
            candidateIntegrityRejections,
          ),
        ...(discovery?.modelObservation === undefined
          ? {}
          : { discoveryObservation: discovery.modelObservation }),
        ...(grounding.modelObservation === undefined
          ? {}
          : { modelObservation: grounding.modelObservation }),
      });
    }
    const errors: AuditError[] = [];
    if (verifiedModel.rejectedCount > 0) {
      errors.push({
        code: 'model-evidence-rejected',
        stage: 'verification',
        message: `${verifiedModel.rejectedCount} model candidate finding(s) lacked valid in-scope source evidence.`,
        retryable: false,
      });
    }
    const verifiedFindings = verifiedModel.verified;
    activeStage = 'verification';
    const verificationResults = await Promise.all(
      verifiedFindings.map(async (hypothesis, index) => {
        return runCandidateAwareStage({
          input,
          candidateAwareDispatchPool,
          vector,
          phase: 'verification',
          candidateOrdinal: index + 1,
          hypothesis,
          execute: async () => {
            const verificationId = `verification-${vector.vectorId}-${index + 1}`;
            const request = AuditVerificationRequestSchema.parse({
              verificationId,
              vector,
              evidenceMap: verifiedMap.evidenceMap,
              sourcePosture: verifiedSourcePosture.sourcePosture,
              hypothesis,
              availableSourcePaths: scopedSources.map((source) => source.path),
            });
            return input.verify(request);
          },
        });
      }),
    );
    const verifierReconciled = verificationResults.map((result, index) => {
      const hypothesis = verifiedFindings[index];
      if (result.decision !== 'accepted' || hypothesis === undefined) return [];
      const verifiedEvidence = result.verifiedEvidence;
      if (
        verifiedEvidence === null ||
        result.controlAssessment === null ||
        !hasValidSourceEvidence(result.controlAssessment.evidence, scopedSources) ||
        !hasCompleteMappedControlConsideration(
          result.controlAssessment.consideredEvidenceMapFactIds ?? [],
          result.controlAssessment.evidence,
          hypothesis,
          verifiedMap.evidenceMap,
        ) ||
        !hasCompletePlanObligationReconciliation(
          result.obligationReconciliations,
          hypothesis,
          verifiedMap.evidenceMap,
        ) ||
        !hasCompletePostureReconciliation(
          result.postureReconciliations,
          hypothesis,
          verifiedSourcePosture.sourcePosture,
          verifiedMap.evidenceMap,
        ) ||
        !hasExactPlanObligations(result.verifiedPlanObligations, hypothesis.planObligations)
      )
        return [];
      return verifyModelFindings(
        vector,
        [
          {
            ...hypothesis,
            evidence: verifiedEvidence,
            planObligations: result.verifiedPlanObligations,
          },
        ],
        scopedSources,
        verifiedMap.evidenceMap,
        verifiedSourcePosture.sourcePosture,
        false,
      ).verified;
    });
    retainedVerificationObservations = verificationResults.flatMap((result) =>
      result.modelObservation === undefined ? [] : [result.modelObservation],
    );
    const countercheck = input.countercheck;
    activeStage = 'countercheck';
    const countercheckResults =
      countercheck === undefined
        ? verifierReconciled.map(() => undefined)
        : await Promise.all(
            verifierReconciled.map(async (reconciledFinding, index) => {
              const hypothesis = reconciledFinding[0];
              if (hypothesis === undefined) return undefined;
              return runCandidateAwareStage({
                input,
                candidateAwareDispatchPool,
                vector,
                phase: 'countercheck',
                candidateOrdinal: index + 1,
                hypothesis,
                execute: async () => {
                  const countercheckId = `countercheck-${vector.vectorId}-${index + 1}`;
                  const request = AuditCountercheckRequestSchema.parse({
                    countercheckId,
                    vector,
                    evidenceMap: verifiedMap.evidenceMap,
                    sourcePosture: verifiedSourcePosture.sourcePosture,
                    hypothesis,
                    availableSourcePaths: scopedSources.map((source) => source.path),
                  });
                  return countercheck(request);
                },
              });
            }),
          );
    const counterchecked = countercheckResults.map((result, index) => {
      const hypothesis = verifierReconciled[index]?.[0];
      if (result?.decision !== 'accepted' || hypothesis === undefined) return [];
      const verifiedEvidence = result.verifiedEvidence;
      if (
        verifiedEvidence === null ||
        result.controlAssessment === null ||
        !hasValidSourceEvidence(result.controlAssessment.evidence, scopedSources) ||
        !hasCompleteMappedControlConsideration(
          result.controlAssessment.consideredEvidenceMapFactIds ?? [],
          result.controlAssessment.evidence,
          hypothesis,
          verifiedMap.evidenceMap,
        ) ||
        !hasCompletePlanObligationReconciliation(
          result.obligationReconciliations,
          hypothesis,
          verifiedMap.evidenceMap,
        ) ||
        !hasCompletePostureReconciliation(
          result.postureReconciliations,
          hypothesis,
          verifiedSourcePosture.sourcePosture,
          verifiedMap.evidenceMap,
        ) ||
        !hasExactPlanObligations(result.verifiedPlanObligations, hypothesis.planObligations)
      )
        return [];
      return verifyModelFindings(
        vector,
        [
          {
            ...hypothesis,
            evidence: verifiedEvidence,
            planObligations: result.verifiedPlanObligations,
          },
        ],
        scopedSources,
        verifiedMap.evidenceMap,
        verifiedSourcePosture.sourcePosture,
        false,
      ).verified;
    });
    const postVerification =
      countercheck === undefined ? verifierReconciled.flat() : counterchecked.flat();
    const reviewRequired = postVerification.filter((hypothesis) =>
      hasCandidateBlindPostureContradiction(hypothesis, verifiedSourcePosture.sourcePosture),
    );
    const accepted = postVerification.filter(
      (hypothesis) =>
        !hasCandidateBlindPostureContradiction(hypothesis, verifiedSourcePosture.sourcePosture),
    );
    if (reviewRequired.length > 0) {
      errors.push({
        code: 'candidate-blind-contradiction-review-required',
        stage: 'verification',
        message: `${reviewRequired.length} source-backed hypothesis(es) require human review because candidate-blind and candidate-aware review disagree.`,
        retryable: false,
      });
    }
    for (const [index, result] of verificationResults.entries()) {
      if (result.decision === 'accepted') {
        if ((verifierReconciled[index]?.length ?? 0) > 0) continue;
        errors.push({
          code: 'verifier-evidence-rejected',
          stage: 'verification',
          message: 'The verifier-selected source evidence failed integrity validation.',
          retryable: false,
        });
        continue;
      }
      errors.push({
        code: candidateAwareTerminalErrorCode(result, 'verification'),
        stage: 'verification',
        message:
          result.decision === 'rejected'
            ? 'The independent verifier rejected the hypothesis.'
            : 'The independent verifier could not decide from bounded static evidence.',
        retryable: candidateAwareResultIsRetryable(result),
      });
    }
    for (const [index, result] of countercheckResults.entries()) {
      if (result === undefined) continue;
      if (result.decision === 'accepted') {
        if ((counterchecked[index]?.length ?? 0) > 0) continue;
        errors.push({
          code: 'countercheck-evidence-rejected',
          stage: 'countercheck',
          message: 'The countercheck-selected source evidence failed integrity validation.',
          retryable: false,
        });
        continue;
      }
      errors.push({
        code: candidateAwareTerminalErrorCode(result, 'countercheck'),
        stage: 'countercheck',
        message:
          result.decision === 'rejected'
            ? 'The independent countercheck rejected the verifier-accepted hypothesis.'
            : 'The independent countercheck could not decide from bounded static evidence.',
        retryable: candidateAwareResultIsRetryable(result),
      });
    }
    const verificationObservations = retainedVerificationObservations;
    const countercheckObservations = countercheckResults.flatMap((result) =>
      result?.modelObservation === undefined ? [] : [result.modelObservation],
    );
    retainedCountercheckObservations = countercheckObservations;
    activeStage = 'synthesis';
    const admissionFunnel = createFindingAdmissionFunnel({
      modelCandidateCount: traceBoundCandidates.candidates.length,
      integrityRejectedCount: verifiedModel.rejectedCount,
      toolEvidenceRejectedCount: 0,
      verificationResults,
      verifierToolEvidenceRejectedCount: 0,
      verifierReconciledCount: verifierReconciled.filter((finding) => finding.length > 0).length,
      admittedFindingCount: accepted.length,
    });
    const obligationClosure = deriveObligationClosureMatrix({
      vector,
      evidenceMap: verifiedMap.evidenceMap,
      sourcePosture: verifiedSourcePosture.sourcePosture,
      investigationClosures: verifiedClosures.closures,
      candidates: verifiedModel.verified,
      admittedFindings: accepted,
      rejectedCandidates: verifiedFindings.filter((_hypothesis, index) => {
        const result = verificationResults[index];
        return (
          result?.decision === 'rejected' ||
          (result?.decision === 'accepted' && (verifierReconciled[index]?.length ?? 0) === 0)
        );
      }),
      incompleteCandidates: verifiedFindings.filter(
        (_hypothesis, index) => verificationResults[index]?.decision === 'incomplete',
      ),
      reviewRequiredFindings: reviewRequired,
    });
    const closureComplete = hasCompleteObligationClosure(obligationClosure);
    const entirelyNotApplicable =
      closureComplete &&
      obligationClosure.every((closure) => closure.terminalDisposition === 'not-applicable');
    return {
      coverage: {
        vectorId: vector.vectorId,
        planned: true,
        completed: closureComplete,
        matchedSourcePaths: scopedSources.length,
        deterministicCandidateCount: 0,
        evidenceMapFactCount: verifiedMap.evidenceMap.facts.length,
        evidenceMapUnansweredObligationCount:
          verifiedMap.evidenceMap.unansweredPlanObligations.length,
        ...sourcePostureCoverage(verifiedSourcePosture.sourcePosture),
        findingCount: accepted.length,
        reviewRequiredCount: reviewRequired.length,
        outcome: !closureComplete
          ? 'incomplete'
          : entirelyNotApplicable
            ? 'not-applicable'
            : 'completed',
        errorCode: closureComplete ? null : 'obligation-closure-incomplete',
        limitations: closureComplete
          ? [...evidencePackage.limitations]
          : [
              ...evidencePackage.limitations,
              'At least one declared review obligation did not reach a complete terminal closure.',
            ],
        obligationClosure,
        admissionFunnel,
        hypothesisGroundingFunnel,
        candidateIntegrityRejections,
        ...(mapped.modelObservation === undefined
          ? {}
          : { evidenceMapObservation: mapped.modelObservation }),
        ...(assessed.modelObservation === undefined
          ? {}
          : { sourcePostureObservation: assessed.modelObservation }),
        ...(investigationObservation === undefined
          ? {}
          : { modelObservation: investigationObservation }),
        ...(candidateGroundingObservation === undefined
          ? {}
          : {
              candidateGroundingObservation,
            }),
        verificationObservations: [...verificationObservations],
        countercheckObservations: [...countercheckObservations],
      },
      errors,
      proposed: accepted.map(redactVerifiedFinding),
      reviewRequired: reviewRequired.map(redactVerifiedFinding),
    };
  } catch (error) {
    const code = errorCode(error);
    return failedVectorStageResult({
      vector,
      matchedSourcePaths: scopedSources.length,
      limitations: evidencePackage.limitations,
      code,
      stage: activeStage,
      evidenceMapObservation: retainedEvidenceMapObservation,
      sourcePostureObservation: retainedSourcePostureObservation,
      investigationObservation: retainedInvestigationObservation,
      candidateGroundingObservation: retainedCandidateGroundingObservation,
      verificationObservations: retainedVerificationObservations,
      countercheckObservations: retainedCountercheckObservations,
    });
  }
}

function scopedStageContext(
  input: AuditInput,
  vectorId: string,
  phase: AuditContextOverflowLedger['phase'],
): AuditScopedStageContext | undefined {
  const priorContextOverflowLedger = input.priorContextOverflowLedgers?.find(
    (ledger) => ledger.vectorId === vectorId && ledger.phase === phase,
  );
  const priorEvidenceMapRecoveryLeaves =
    phase === 'evidence-mapping'
      ? input.priorEvidenceMapRecoveryLeaves?.filter((leaf) => leaf.vectorId === vectorId)
      : undefined;
  const priorSourcePostureRecoveryLeaves =
    phase === 'source-posture'
      ? input.priorSourcePostureRecoveryLeaves?.filter((leaf) => leaf.vectorId === vectorId)
      : undefined;
  const priorCandidateGroundingRecoveryLeaves =
    phase === 'candidate-grounding'
      ? input.priorCandidateGroundingRecoveryLeaves?.filter((leaf) => leaf.vectorId === vectorId)
      : undefined;
  if (
    priorContextOverflowLedger === undefined &&
    priorEvidenceMapRecoveryLeaves === undefined &&
    priorSourcePostureRecoveryLeaves === undefined &&
    priorCandidateGroundingRecoveryLeaves === undefined &&
    input.onContextOverflowTransition === undefined &&
    input.onEvidenceMapRecoveryLeaf === undefined &&
    input.onSourcePostureRecoveryLeaf === undefined &&
    input.onCandidateGroundingRecoveryLeaf === undefined
  )
    return undefined;
  return {
    ...(priorContextOverflowLedger === undefined ? {} : { priorContextOverflowLedger }),
    ...(priorEvidenceMapRecoveryLeaves === undefined ? {} : { priorEvidenceMapRecoveryLeaves }),
    ...(priorSourcePostureRecoveryLeaves === undefined ? {} : { priorSourcePostureRecoveryLeaves }),
    ...(priorCandidateGroundingRecoveryLeaves === undefined
      ? {}
      : { priorCandidateGroundingRecoveryLeaves }),
    ...(input.onContextOverflowTransition === undefined
      ? {}
      : {
          onContextOverflowTransition: async (update) =>
            input.onContextOverflowTransition?.(update),
        }),
    ...(input.onEvidenceMapRecoveryLeaf === undefined
      ? {}
      : {
          onEvidenceMapRecoveryLeaf: async (update) => input.onEvidenceMapRecoveryLeaf?.(update),
        }),
    ...(input.onSourcePostureRecoveryLeaf === undefined
      ? {}
      : {
          onSourcePostureRecoveryLeaf: async (update) =>
            input.onSourcePostureRecoveryLeaf?.(update),
        }),
    ...(input.onCandidateGroundingRecoveryLeaf === undefined
      ? {}
      : {
          onCandidateGroundingRecoveryLeaf: async (update) =>
            input.onCandidateGroundingRecoveryLeaf?.(update),
        }),
  };
}

/** Maintains a deterministic no-provider entry point for baseline tests and ablations. */
export async function runStaticAudit(
  input: Omit<AuditInput, 'investigate' | 'verify' | 'countercheck'>,
): Promise<AuditReport> {
  return runAudit({
    ...input,
    investigate: async () => ({ seeds: [], closures: [] }),
    mapEvidence: async () => ({
      evidenceMap: {
        facts: [],
        controlCoverage: [],
        unansweredPlanObligations: [],
        limitations: ['Static audit has no mapper.'],
      },
    }),
    verify: async () => ({
      decision: 'incomplete',
      reason: 'Static audit has no verifier.',
      verifiedEvidence: null,
      verifiedPlanObligations: [],
      controlAssessment: null,
      obligationReconciliations: [],
      postureReconciliations: [],
    }),
  });
}

function hasValidSourceEvidence(
  evidence: readonly { path: string; startLine: number }[],
  sources: readonly SourceDocument[],
): boolean {
  const byPath = new Map(sources.map((source) => [source.path, source] as const));
  return (
    evidence.length > 0 &&
    evidence.every((item) => {
      const source = byPath.get(item.path);
      return source?.content.split(/\r?\n/u)[item.startLine - 1] !== undefined;
    })
  );
}

/**
 * Validates only declared posture coverage and neutral-map provenance. It does
 * not infer whether either the posture or claim is semantically correct.
 */
function hasCompletePostureReconciliation(
  reconciliations: readonly SourcePostureReconciliation[],
  hypothesis: VerifiableHypothesis,
  sourcePosture: SourcePosture,
  evidenceMap: EvidenceMap,
): boolean {
  const requiredAssessments = sourcePosture.assessments.filter((assessment) =>
    hypothesis.planObligations.some(
      (obligation) => obligation.obligationId === assessment.obligationId,
    ),
  );
  if (
    reconciliations.length !== requiredAssessments.length ||
    reconciliations.some((reconciliation) => reconciliation.disposition === 'unresolved')
  ) {
    return false;
  }
  const reconciledAssessmentIds = reconciliations.map(
    (reconciliation) => reconciliation.assessmentId,
  );
  if (
    new Set(reconciledAssessmentIds).size !== reconciledAssessmentIds.length ||
    !requiredAssessments.every((assessment) =>
      reconciledAssessmentIds.includes(assessment.assessmentId),
    )
  ) {
    return false;
  }
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  return reconciliations.every((reconciliation) => {
    const assessment = requiredAssessments.find(
      (candidate) => candidate.assessmentId === reconciliation.assessmentId,
    );
    if (assessment === undefined) return false;
    const permittedEvidence = assessment.evidenceMapFactIds.flatMap(
      (factId) => facts.get(factId)?.evidence ?? [],
    );
    return reconciliation.evidence.every((evidence) =>
      permittedEvidence.some(
        (mapEvidence) =>
          mapEvidence.path === evidence.path && mapEvidence.startLine === evidence.startLine,
      ),
    );
  });
}

/**
 * Detects a disagreement between two independently sequenced, source-scoped
 * model judgments without inferring security semantics from source text,
 * language, or a detector rule. The caller preserves it for human review.
 */
function hasCandidateBlindPostureContradiction(
  hypothesis: VerifiableHypothesis,
  sourcePosture: SourcePosture,
): boolean {
  return sourcePosture.assessments.some(
    (assessment) =>
      assessment.conclusion === 'risk-contradicted' &&
      hypothesis.planObligations.some(
        (obligation) => obligation.obligationId === assessment.obligationId,
      ),
  );
}

/**
 * Validates only exact approved-obligation coverage and map-selected source
 * provenance. It does not infer whether a reconciliation is semantically true.
 */
function hasCompletePlanObligationReconciliation(
  reconciliations: readonly PlanObligationReconciliation[],
  hypothesis: VerifiableHypothesis,
  evidenceMap: EvidenceMap,
): boolean {
  if (
    !hasExactPlanObligations(
      reconciliations.map((reconciliation) => reconciliation.planObligation),
      hypothesis.planObligations,
    ) ||
    reconciliations.some((reconciliation) => reconciliation.disposition === 'unresolved')
  ) {
    return false;
  }
  return reconciliations.every((reconciliation) => {
    const permittedEvidence = evidenceMap.facts
      .filter((fact) =>
        fact.planObligations.some(
          (obligation) => obligation.obligationId === reconciliation.planObligation.obligationId,
        ),
      )
      .flatMap((fact) => fact.evidence);
    return reconciliation.evidence.every((evidence) =>
      permittedEvidence.some(
        (mapEvidence) =>
          mapEvidence.path === evidence.path && mapEvidence.startLine === evidence.startLine,
      ),
    );
  });
}

export function auditExitCode(report: AuditReport): 0 | 1 | 3 {
  return classifyAuditTerminal(report).exitCode;
}

function skippedCoverage(
  vector: AttackPlan['vectors'][number],
  limitation: string,
): VectorCoverage {
  return {
    vectorId: vector.vectorId,
    planned: true,
    completed: true,
    matchedSourcePaths: 0,
    deterministicCandidateCount: 0,
    evidenceMapFactCount: 0,
    evidenceMapUnansweredObligationCount: 0,
    ...emptySourcePostureCoverage(),
    findingCount: 0,
    outcome: 'skipped',
    errorCode: null,
    limitations: [limitation],
    obligationClosure: deriveObligationClosureMatrix({ vector }),
    admissionFunnel: emptyFindingAdmissionFunnel(),
    verificationObservations: [],
  };
}

function emptyScopeCoverage(
  vector: AttackPlan['vectors'][number],
  limitation: string,
): VectorCoverage {
  return {
    ...skippedCoverage(vector, limitation),
    completed: false,
    outcome: 'incomplete',
    errorCode: 'no-admitted-source-in-scope',
  };
}

/**
 * Preserves the exact phase and every completed source-free observation when
 * persistence or orchestration fails outside a model stage's normal result.
 */
function failedVectorStageResult(input: {
  vector: AttackPlan['vectors'][number];
  matchedSourcePaths: number;
  limitations: readonly string[];
  code: string;
  stage: AuditError['stage'];
  evidenceMapObservation?: ModelStageObservation;
  sourcePostureObservation?: ModelStageObservation;
  investigationObservation?: ModelStageObservation;
  candidateGroundingObservation?: ModelStageObservation;
  verificationObservations: readonly ModelStageObservation[];
  countercheckObservations: readonly ModelStageObservation[];
}): AuditVectorResult {
  return {
    coverage: {
      vectorId: input.vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths: input.matchedSourcePaths,
      deterministicCandidateCount: 0,
      evidenceMapFactCount: 0,
      evidenceMapUnansweredObligationCount: 0,
      ...emptySourcePostureCoverage(),
      findingCount: 0,
      outcome: terminalFailureOutcome(input.code),
      errorCode: input.code,
      limitations: uniqueSorted(input.limitations),
      obligationClosure: deriveObligationClosureMatrix({ vector: input.vector }),
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [...input.verificationObservations],
      countercheckObservations: [...input.countercheckObservations],
      ...(input.evidenceMapObservation === undefined
        ? {}
        : { evidenceMapObservation: input.evidenceMapObservation }),
      ...(input.sourcePostureObservation === undefined
        ? {}
        : { sourcePostureObservation: input.sourcePostureObservation }),
      ...(input.investigationObservation === undefined
        ? {}
        : { modelObservation: input.investigationObservation }),
      ...(input.candidateGroundingObservation === undefined
        ? {}
        : { candidateGroundingObservation: input.candidateGroundingObservation }),
    },
    errors: [
      {
        code: input.code,
        stage: input.stage,
        message: 'The approved vector could not complete its recorded audit phase.',
        retryable: input.code === 'provider-failure',
      },
    ],
    proposed: [],
    reviewRequired: [],
  };
}

function failedInvestigationResult(
  vector: AttackPlan['vectors'][number],
  matchedSourcePaths: number,
  deterministicCandidateCount: number,
  limitations: readonly string[],
  code: string,
  modelObservation?: ModelStageObservation,
): AuditVectorResult {
  return {
    coverage: {
      vectorId: vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths,
      deterministicCandidateCount,
      evidenceMapFactCount: 0,
      evidenceMapUnansweredObligationCount: 0,
      ...emptySourcePostureCoverage(),
      findingCount: 0,
      outcome: terminalFailureOutcome(code),
      errorCode: code,
      limitations: [...limitations],
      obligationClosure: deriveObligationClosureMatrix({ vector }),
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [],
      ...(modelObservation === undefined ? {} : { modelObservation }),
    },
    errors: [
      {
        code,
        stage: 'investigation',
        message: 'The model investigation for this approved vector did not complete.',
        retryable: code === 'provider-failure',
      },
    ],
    proposed: [],
    reviewRequired: [],
  };
}

function failedEvidenceMapResult(
  vector: AttackPlan['vectors'][number],
  matchedSourcePaths: number,
  limitations: readonly string[],
  code: string,
  evidenceMapObservation?: ModelStageObservation,
): AuditVectorResult {
  return {
    coverage: {
      vectorId: vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths,
      deterministicCandidateCount: 0,
      evidenceMapFactCount: 0,
      evidenceMapUnansweredObligationCount: 0,
      ...emptySourcePostureCoverage(),
      findingCount: 0,
      outcome: terminalFailureOutcome(code),
      errorCode: code,
      limitations: [...limitations],
      obligationClosure: deriveObligationClosureMatrix({ vector }),
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [],
      ...(evidenceMapObservation === undefined ? {} : { evidenceMapObservation }),
    },
    errors: [
      {
        code,
        stage: 'evidence-mapping',
        message: 'The source evidence mapping for this approved vector did not complete.',
        retryable: code === 'provider-failure',
      },
    ],
    proposed: [],
    reviewRequired: [],
  };
}

function incompleteEvidenceMapResult(input: {
  vector: AttackPlan['vectors'][number];
  matchedSourcePaths: number;
  limitations: readonly string[];
  errorCode: string;
  modelObservation?: ModelStageObservation;
}): AuditVectorResult {
  return {
    coverage: {
      vectorId: input.vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths: input.matchedSourcePaths,
      deterministicCandidateCount: 0,
      evidenceMapFactCount: 0,
      evidenceMapUnansweredObligationCount: 0,
      ...emptySourcePostureCoverage(),
      findingCount: 0,
      outcome: 'incomplete',
      errorCode: input.errorCode,
      limitations: uniqueSorted(input.limitations),
      obligationClosure: deriveObligationClosureMatrix({ vector: input.vector }),
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [],
      ...(input.modelObservation === undefined
        ? {}
        : { evidenceMapObservation: input.modelObservation }),
    },
    errors: [
      {
        code: input.errorCode,
        stage: 'evidence-mapping',
        message: 'The source evidence map could not establish a bounded basis for investigation.',
        retryable: true,
      },
    ],
    proposed: [],
    reviewRequired: [],
  };
}

function failedSourcePostureResult(input: {
  vector: AttackPlan['vectors'][number];
  matchedSourcePaths: number;
  evidenceMap: EvidenceMap;
  limitations: readonly string[];
  errorCode: string;
  evidenceMapObservation?: ModelStageObservation;
  sourcePostureObservation?: ModelStageObservation;
}): AuditVectorResult {
  return {
    coverage: {
      vectorId: input.vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths: input.matchedSourcePaths,
      deterministicCandidateCount: 0,
      evidenceMapFactCount: input.evidenceMap.facts.length,
      evidenceMapUnansweredObligationCount: input.evidenceMap.unansweredPlanObligations.length,
      ...emptySourcePostureCoverage(),
      findingCount: 0,
      outcome: terminalFailureOutcome(input.errorCode),
      errorCode: input.errorCode,
      limitations: uniqueSorted(input.limitations),
      obligationClosure: deriveObligationClosureMatrix({
        vector: input.vector,
        evidenceMap: input.evidenceMap,
      }),
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [],
      ...(input.evidenceMapObservation === undefined
        ? {}
        : { evidenceMapObservation: input.evidenceMapObservation }),
      ...(input.sourcePostureObservation === undefined
        ? {}
        : { sourcePostureObservation: input.sourcePostureObservation }),
    },
    errors: [
      {
        code: input.errorCode,
        stage: 'source-posture',
        message: 'The candidate-blind source posture for this approved vector did not complete.',
        retryable: input.errorCode === 'provider-failure',
      },
    ],
    proposed: [],
    reviewRequired: [],
  };
}

function incompleteSourcePostureResult(input: {
  vector: AttackPlan['vectors'][number];
  matchedSourcePaths: number;
  evidenceMap: EvidenceMap;
  sourcePosture: SourcePosture;
  limitations: readonly string[];
  errorCode: string;
  evidenceMapObservation?: ModelStageObservation;
  sourcePostureObservation?: ModelStageObservation;
}): AuditVectorResult {
  return {
    coverage: {
      vectorId: input.vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths: input.matchedSourcePaths,
      deterministicCandidateCount: 0,
      evidenceMapFactCount: input.evidenceMap.facts.length,
      evidenceMapUnansweredObligationCount: input.evidenceMap.unansweredPlanObligations.length,
      ...sourcePostureCoverage(input.sourcePosture),
      findingCount: 0,
      outcome: 'incomplete',
      errorCode: input.errorCode,
      limitations: uniqueSorted(input.limitations),
      obligationClosure: deriveObligationClosureMatrix({
        vector: input.vector,
        evidenceMap: input.evidenceMap,
        sourcePosture: input.sourcePosture,
      }),
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [],
      ...(input.evidenceMapObservation === undefined
        ? {}
        : { evidenceMapObservation: input.evidenceMapObservation }),
      ...(input.sourcePostureObservation === undefined
        ? {}
        : { sourcePostureObservation: input.sourcePostureObservation }),
    },
    errors: [
      {
        code: input.errorCode,
        stage: 'source-posture',
        message:
          'The candidate-blind source posture could not establish every approved obligation.',
        retryable: true,
      },
    ],
    proposed: [],
    reviewRequired: [],
  };
}

function incompleteInvestigationClosureResult(input: {
  vector: AttackPlan['vectors'][number];
  matchedSourcePaths: number;
  evidenceMap: EvidenceMap;
  sourcePosture: SourcePosture;
  limitations: readonly string[];
  evidenceMapObservation?: ModelStageObservation;
  sourcePostureObservation?: ModelStageObservation;
  modelObservation?: ModelStageObservation;
}): AuditVectorResult {
  const obligationClosure = deriveObligationClosureMatrix({
    vector: input.vector,
    evidenceMap: input.evidenceMap,
    sourcePosture: input.sourcePosture,
  });
  return {
    coverage: {
      vectorId: input.vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths: input.matchedSourcePaths,
      deterministicCandidateCount: 0,
      evidenceMapFactCount: input.evidenceMap.facts.length,
      evidenceMapUnansweredObligationCount: input.evidenceMap.unansweredPlanObligations.length,
      ...sourcePostureCoverage(input.sourcePosture),
      findingCount: 0,
      outcome: 'incomplete',
      errorCode: 'obligation-closure-incomplete',
      limitations: uniqueSorted(input.limitations),
      obligationClosure,
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [],
      ...(input.evidenceMapObservation === undefined
        ? {}
        : { evidenceMapObservation: input.evidenceMapObservation }),
      ...(input.sourcePostureObservation === undefined
        ? {}
        : { sourcePostureObservation: input.sourcePostureObservation }),
      ...(input.modelObservation === undefined ? {} : { modelObservation: input.modelObservation }),
    },
    errors: [
      {
        code: 'obligation-closure-incomplete',
        stage: 'investigation',
        message:
          'The investigator did not provide a valid terminal closure for every review obligation.',
        retryable: true,
      },
    ],
    proposed: [],
    reviewRequired: [],
  };
}

function emptySourcePostureCoverage() {
  return {
    sourcePostureAssessmentCount: 0,
    sourcePostureSupportedCount: 0,
    sourcePostureContradictedCount: 0,
    sourcePostureInconclusiveCount: 0,
    sourcePostureNotApplicableCount: 0,
  };
}

function sourcePostureCoverage(sourcePosture: SourcePosture) {
  return {
    sourcePostureAssessmentCount: sourcePosture.assessments.length,
    sourcePostureSupportedCount: sourcePosture.assessments.filter(
      (assessment) => assessment.conclusion === 'risk-supported',
    ).length,
    sourcePostureContradictedCount: sourcePosture.assessments.filter(
      (assessment) => assessment.conclusion === 'risk-contradicted',
    ).length,
    sourcePostureInconclusiveCount: sourcePosture.assessments.filter(
      (assessment) => assessment.conclusion === 'inconclusive',
    ).length,
    sourcePostureNotApplicableCount: sourcePosture.assessments.filter(
      (assessment) => assessment.conclusion === 'not-applicable',
    ).length,
  };
}

/**
 * Structural only: every neutral control fact relevant to this hypothesis must
 * be explicitly considered by the verifier. It does not decide effectiveness.
 */
function hasCompleteMappedControlConsideration(
  consideredFactIds: readonly string[],
  controlEvidence: readonly { path: string; startLine: number }[],
  hypothesis: VerifiableHypothesis,
  evidenceMap: EvidenceMap,
): boolean {
  const requiredFactIds = hypothesis.planObligations.flatMap((obligation) =>
    mappedControlFactIdsForObligation(evidenceMap, obligation.obligationId),
  );
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  return requiredFactIds.every((factId) => {
    const fact = facts.get(factId);
    return (
      fact !== undefined &&
      consideredFactIds.includes(factId) &&
      fact.evidence.some((factEvidence) =>
        controlEvidence.some(
          (verifierEvidence) =>
            verifierEvidence.path === factEvidence.path &&
            verifierEvidence.startLine === factEvidence.startLine,
        ),
      )
    );
  });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function redactVerifiableHypothesis(hypothesis: VerifiableHypothesis): VerifiableHypothesis {
  const { evidenceMapFactIds, sourcePostureAssessmentIds, ...finding } = hypothesis;
  return VerifiableHypothesisSchema.parse({
    ...redactProposedFinding(finding),
    evidenceMapFactIds,
    sourcePostureAssessmentIds,
  });
}

function redactVerifiedFinding(hypothesis: VerifiableHypothesis): ProposedFinding {
  const {
    evidenceMapFactIds: _evidenceMapFactIds,
    sourcePostureAssessmentIds: _sourcePostureAssessmentIds,
    ...finding
  } = hypothesis;
  return redactProposedFinding(finding);
}

/**
 * Runs exactly one candidate-aware unit through the audit-wide pool. Its
 * state transitions are durable when the caller supplies the output callback;
 * an interrupted pending/running unit is never mistaken for a model result.
 */
async function runCandidateAwareStage(input: {
  input: AuditInput;
  candidateAwareDispatchPool: CandidateAwareDispatchPool;
  vector: AttackPlan['vectors'][number];
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
  hypothesis: VerifiableHypothesis;
  execute: () => Promise<AuditVerificationResultWithObservation>;
}): Promise<NormalizedCandidateAwareResult> {
  const prior = reusableCandidateAwareResult({
    checkpoints: input.input.priorCandidateAwareCheckpoints ?? [],
    vectorId: input.vector.vectorId,
    phase: input.phase,
    candidateOrdinal: input.candidateOrdinal,
    hypothesis: input.hypothesis,
    retryUnfinished: input.input.retryUnfinished ?? false,
  });
  if (prior !== undefined) return prior;
  const update = async (
    state: AuditCandidateAwareCheckpoint['state'],
    result?: PersistedCandidateAwareResult,
  ): Promise<void> =>
    input.input.onCandidateAwareCheckpoint?.({
      vectorId: input.vector.vectorId,
      phase: input.phase,
      candidateOrdinal: input.candidateOrdinal,
      candidate: input.hypothesis,
      state,
      ...(result === undefined ? {} : { result }),
    });
  await update('pending');
  return input.candidateAwareDispatchPool.run(async () => {
    await update('running');
    let result: NormalizedCandidateAwareResult;
    try {
      result = normalizeCandidateAwareResult(await input.execute());
    } catch (error) {
      if (isProviderCancelled(error)) {
        input.candidateAwareDispatchPool.cancel(error);
        throw error;
      }
      result = incompleteCandidateAwareResult('wrapper-contract-invalid');
    }
    await update('completed', persistCandidateAwareResult(result));
    if (result.modelObservation?.errorCode === 'provider-cancelled') {
      const error = new SecurityReviewerError(
        'provider-cancelled',
        'The candidate-aware model stage was cancelled by the provider.',
      );
      input.candidateAwareDispatchPool.cancel(error);
      throw error;
    }
    return result;
  });
}

/** Restores only an exact terminal result; its original model rationale stays discarded. */
function reusableCandidateAwareResult(input: {
  checkpoints: readonly AuditCandidateAwareCheckpoint[];
  vectorId: string;
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
  hypothesis: VerifiableHypothesis;
  retryUnfinished: boolean;
}): NormalizedCandidateAwareResult | undefined {
  const candidateFingerprint = candidateAwareFingerprint(input.hypothesis);
  const checkpoint = input.checkpoints.find(
    (candidate) =>
      candidate.vectorId === input.vectorId &&
      candidate.phase === input.phase &&
      candidate.candidateOrdinal === input.candidateOrdinal &&
      candidate.candidateFingerprint === candidateFingerprint &&
      candidate.state === 'completed' &&
      candidate.result !== undefined,
  );
  if (
    checkpoint?.result === undefined ||
    (input.retryUnfinished && checkpoint.result.decision === 'incomplete')
  )
    return undefined;
  return {
    ...checkpoint.result,
    reason: 'The exact persisted candidate-aware terminal result was reused.',
  };
}

/** Stores the canonical decision and telemetry, never the model-authored rationale. */
function persistCandidateAwareResult(
  result: NormalizedCandidateAwareResult,
): PersistedCandidateAwareResult {
  const { reason: _reason, ...persisted } = result;
  return persisted;
}

type NormalizedCandidateAwareResult = AuditVerificationResult &
  Readonly<{
    modelObservation?: ModelStageObservation;
    terminalLane: VerificationTerminalLane;
  }>;

/**
 * Creates the one source-free fallback for a verifier/countercheck wrapper
 * failure. Raw error and model content are intentionally not retained.
 */
function incompleteCandidateAwareResult(
  terminalLane: Extract<VerificationTerminalLane, 'wrapper-contract-invalid'>,
  modelObservation?: ModelStageObservation,
): NormalizedCandidateAwareResult {
  return {
    decision: 'incomplete',
    reason: 'The candidate-aware stage did not produce a valid terminal result.',
    verifiedEvidence: null,
    verifiedPlanObligations: [],
    controlAssessment: null,
    obligationReconciliations: [],
    postureReconciliations: [],
    terminalLane,
    ...(modelObservation === undefined ? {} : { modelObservation }),
  };
}

/**
 * Keeps a provider-normalized terminal stage code visible in the vector error
 * ledger instead of collapsing an overflow, cancellation, or cost stop into
 * generic candidate incompleteness.
 */
function candidateAwareTerminalErrorCode(
  result: AuditVerificationResultWithObservation,
  phase: 'verification' | 'countercheck',
): string {
  const label = phase === 'verification' ? 'verifier' : 'countercheck';
  if (result.decision === 'rejected') return `${label}-rejected`;
  if (result.modelObservation?.status === 'failed' && result.modelObservation.errorCode !== null) {
    return result.modelObservation.errorCode;
  }
  return `${label}-incomplete`;
}

function candidateAwareResultIsRetryable(result: AuditVerificationResultWithObservation): boolean {
  if (result.decision !== 'incomplete') return false;
  return result.modelObservation?.errorCode !== 'provider-cancelled';
}

/**
 * Preserves a valid stage observation while separating an invalid wrapper
 * contract from a model-declared incomplete verdict.
 */
function normalizeCandidateAwareResult(
  value: AuditVerificationResultWithObservation,
): NormalizedCandidateAwareResult {
  const { modelObservation, terminalLane: declaredLane, ...verdict } = value;
  const parsedVerdict = AuditVerificationResultSchema.safeParse(verdict);
  if (!parsedVerdict.success) {
    return incompleteCandidateAwareResult('wrapper-contract-invalid', modelObservation);
  }
  const parsedLane = VerificationTerminalLaneSchema.safeParse(
    declaredLane ?? terminalLaneForVerificationDecision(parsedVerdict.data.decision),
  );
  if (
    !parsedLane.success ||
    !isCompatibleTerminalLane(parsedVerdict.data.decision, parsedLane.data)
  ) {
    return incompleteCandidateAwareResult('wrapper-contract-invalid', modelObservation);
  }
  return {
    ...parsedVerdict.data,
    terminalLane: parsedLane.data,
    ...(modelObservation === undefined ? {} : { modelObservation }),
  };
}

function isCompatibleTerminalLane(
  decision: AuditVerificationResult['decision'],
  terminalLane: VerificationTerminalLane,
): boolean {
  if (decision === 'accepted') return terminalLane === 'accepted';
  if (decision === 'rejected') return terminalLane === 'rejected';
  return terminalLane !== 'accepted' && terminalLane !== 'rejected';
}

function errorCode(error: unknown): string {
  return error instanceof SecurityReviewerError ? error.code : 'provider-failure';
}

function isProviderCancelled(error: unknown): error is SecurityReviewerError {
  return error instanceof SecurityReviewerError && error.code === 'provider-cancelled';
}

/** Preserves the provider-neutral stop signal without inspecting provider text. */
function terminalFailureOutcome(errorCode: string): 'failed' | 'cancelled' {
  return errorCode === 'provider-cancelled' ? 'cancelled' : 'failed';
}

async function mapWithConcurrency<T, Result>(
  values: readonly T[],
  maximum: number,
  action: (value: T) => Promise<Result>,
): Promise<Result[]> {
  const pending = values.map((value, index) => ({ value, index }));
  const completed: Array<{ index: number; result: Result }> = [];
  const workerCount = Math.min(maximum, pending.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (next < pending.length) {
        const entry = pending[next];
        next += 1;
        if (entry === undefined) continue;
        completed.push({ index: entry.index, result: await action(entry.value) });
      }
    }),
  );
  return completed.sort((left, right) => left.index - right.index).map((entry) => entry.result);
}
