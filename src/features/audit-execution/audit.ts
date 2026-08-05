import { DefaultMaxParallelVectors } from '../../shared/contracts/concurrency.js';
import { createStableId, sha256 } from '../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import type { AttackPlan } from '../attack-planning/index.js';
import { assertPlanMatchesTarget, hasExactPlanObligations } from '../attack-planning/index.js';
import {
  hasSuccessfulScopedSourceInspection,
  mergeModelStageObservations,
} from '../model-operations/model-operations.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';
import type {
  ContextOverflowTopology,
  ContextOverflowTopologyEvent,
} from '../review-workflow/runtime/context-overflow.js';
import { createFindingAdmissionFunnel, emptyFindingAdmissionFunnel } from './admission/funnel.js';
import {
  type AuditCandidateAwareCheckpoint,
  type AuditCandidateGroundingDraft,
  AuditCandidateGroundingDraftSchema,
  type AuditCandidateGroundingRecoveryLeaf,
  type AuditCheckpointExecution,
  type AuditContextOverflowLedger,
  type AuditError,
  type AuditEvidenceMapDraft,
  type AuditEvidenceMapRecoveryLeaf,
  type AuditEvidenceMapRepairAttempt,
  type AuditInvestigationRequest,
  AuditInvestigationRequestSchema,
  type AuditReport,
  AuditReportSchema,
  type AuditSourcePostureDraft,
  type AuditSourcePostureRecoveryLeaf,
  type AuditVectorResult,
  AuditVectorResultSchema,
  type CandidateAwareContextOverflowTopology,
  CandidateIntegrityRejectionLedgerSchema,
  DiscoveryIntegrityRejectionLedgerSchema,
  isRetryableAuditErrorCode,
  MaxParallelVectorsSchema,
  materializeAuditErrorCode,
  materializeAuditVectorResultForPersistence,
  modelObservationForAuditCheckpointExecution,
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
  CandidateGroundingOutputSchema,
  type CandidateGroundingRequest,
  CandidateGroundingRequestSchema,
  type CandidateGroundingStageOutput,
  type CanonicalCandidateGroundingOutput,
} from './candidate-grounding/contract.js';
import {
  canonicalizeCandidateGroundingOutput,
  groundedHypotheses,
  selectCanonicalSeedBoundGroundings,
  selectSeedBoundGroundings,
} from './candidate-grounding/identity.js';
import type { AuditResumeState } from './checkpoints.js';
import {
  deriveObligationClosureMatrix,
  hasCompleteObligationClosure,
} from './coverage-closure/derive.js';
import { verifyInvestigationClosures } from './coverage-closure/verify.js';
import {
  type EvidenceMap,
  type EvidenceMapInsufficiencies,
  mappedControlFactIdsForObligation,
  type UnverifiedEvidenceMap,
} from './evidence-map/contract.js';
import {
  applyCanonicalEvidenceMapRepair,
  evidenceMapFingerprint,
  evidenceMapInsufficiencySignature,
  verifyEvidenceMapInsufficiencies,
} from './evidence-map/repair.js';
import { verifyEvidenceMap } from './evidence-map/verify.js';
import type {
  HypothesisSeed,
  UnverifiedAuditCandidate,
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
import type {
  EvidenceMapRepairRequest,
  EvidenceMapRequest,
  SourcePostureRequest,
} from './phase-input/contract.js';
import { type RecoveryPhaseInput, recoveryPhaseInputFingerprint } from './recovery-phase-input.js';
import type { SourcePosture, UnverifiedSourcePosture } from './source-posture/contract.js';
import { sourcePostureFingerprint } from './source-posture/identity.js';
import { downgradeUninspectedSourcePosture, verifySourcePosture } from './source-posture/verify.js';
import {
  canonicalizeProposedFindings,
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
  Readonly<{
    evidenceMap: UnverifiedEvidenceMap | EvidenceMap;
    modelObservation?: ModelStageObservation;
  }>
>;

export type AuditEvidenceMapRepairer = (
  request: EvidenceMapRepairRequest,
  context?: AuditScopedStageContext,
) => Promise<
  Readonly<{
    evidenceMap: EvidenceMap;
    modelObservation?: ModelStageObservation;
  }>
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
    mapInsufficiencies?: EvidenceMapInsufficiencies;
    modelObservation?: ModelStageObservation;
  }>
>;

/** A grounded seed is durable work; source-backed null outcomes are unfinished. */
function retryGroundingSeeds(input: {
  seeds: readonly HypothesisSeed[];
  priorDraft: AuditCandidateGroundingDraft | undefined;
  retryUnfinished: boolean;
}): readonly HypothesisSeed[] {
  if (!input.retryUnfinished || input.priorDraft === undefined) return input.seeds;
  const groundedSeedIds = new Set(
    input.priorDraft.groundings.groundings.flatMap((outcome) =>
      outcome.disposition === 'grounded' ? [outcome.seedId] : [],
    ),
  );
  return input.seeds.filter((seed) => !groundedSeedIds.has(seed.seedId));
}

/** The first stage that still needs work after loading one exact grounding draft. */
type GroundingResumeBoundary =
  | Readonly<{ kind: 'discovery'; reason: 'no-compatible-draft' }>
  | Readonly<{
      kind: 'discovery';
      reason: 'retryable-grounding-outcome-without-durable-seed';
    }>
  | Readonly<{ kind: 'candidate-aware'; draft: AuditCandidateGroundingDraft }>;

/**
 * Selects the smallest unfinished boundary from a grounding draft that the
 * checkpoint loader and the current map/posture fingerprints already proved
 * exact. A draft deliberately does not retain discovery seeds. Consequently a
 * requested retry of a null outcome has to recreate that
 * seed through discovery; it may not invent one from a durable outcome.
 *
 * Grounded hypotheses, their closure, and both upstream observations are
 * complete durable work even when a process stopped before writing the first
 * verifier checkpoint. Candidate-aware scheduling remains owned by
 * runCandidateAwareStage, which writes its normal pending/running/completed
 * transitions for that crash window.
 */
function resolveGroundingResumeBoundary(input: {
  priorDraft: AuditCandidateGroundingDraft | undefined;
  retryUnfinished: boolean;
}): GroundingResumeBoundary {
  const draft = input.priorDraft;
  if (draft === undefined) return { kind: 'discovery', reason: 'no-compatible-draft' };
  const hasRetryableOutcome = draft.groundings.groundings.some(
    (outcome) => outcome.disposition !== 'grounded',
  );
  if (input.retryUnfinished && hasRetryableOutcome) {
    return {
      kind: 'discovery',
      reason: 'retryable-grounding-outcome-without-durable-seed',
    };
  }
  return { kind: 'candidate-aware', draft };
}

/** Canonicalizes exactly the seeds dispatched in this invocation. */
function canonicalGroundingOutput(input: {
  vector: AttackPlan['vectors'][number];
  seeds: readonly HypothesisSeed[];
  grounding:
    | Readonly<{
        groundings:
          | CandidateGroundingOutput
          | CanonicalCandidateGroundingOutput
          | CandidateGroundingStageOutput;
        modelObservation?: ModelStageObservation;
      }>
    | undefined;
  evidenceMap: EvidenceMap;
  sourcePosture: SourcePosture;
  sources: readonly SourceDocument[];
}): CanonicalCandidateGroundingOutput {
  if (input.grounding === undefined) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'Candidate grounding ended without a canonical per-seed outcome.',
    );
  }
  return isCanonicalGroundingOutput(input.grounding.groundings)
    ? { groundings: input.grounding.groundings.groundings }
    : canonicalizeCandidateGroundingOutput({
        vector: input.vector,
        seeds: input.seeds,
        output: CandidateGroundingOutputSchema.parse(input.grounding.groundings),
        evidenceMap: input.evidenceMap,
        sourcePosture: input.sourcePosture,
        sources: input.sources,
      });
}

/** Combines only exact durable grounded outcomes with this retry's new per-seed outcomes. */
function mergeRetryGroundingOutcomes(input: {
  seeds: readonly HypothesisSeed[];
  prior: CanonicalCandidateGroundingOutput;
  recovered: CanonicalCandidateGroundingOutput;
}): CanonicalCandidateGroundingOutput {
  const prior = new Map(
    input.prior.groundings.map((outcome) => [outcome.seedId, outcome] as const),
  );
  const recovered = new Map(
    input.recovered.groundings.map((outcome) => [outcome.seedId, outcome] as const),
  );
  return {
    groundings: input.seeds.map((seed) => {
      const priorOutcome = prior.get(seed.seedId);
      if (priorOutcome?.disposition === 'grounded') return priorOutcome;
      const recoveredOutcome = recovered.get(seed.seedId);
      if (recoveredOutcome === undefined) {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'Candidate grounding recovery omitted one requested seed outcome.',
        );
      }
      return recoveredOutcome;
    }),
  };
}

function isCanonicalGroundingOutput(
  output:
    | CandidateGroundingOutput
    | CanonicalCandidateGroundingOutput
    | CandidateGroundingStageOutput,
): output is CanonicalCandidateGroundingOutput {
  const first = output.groundings[0];
  return first !== undefined && 'disposition' in first;
}

/** Raw stage result is parsed at the admission boundary; noncanonical or malformed output fails closed. */
export type AuditVerificationResultWithObservation = AuditVerificationResult &
  Readonly<{
    modelObservation?: ModelStageObservation;
    /** Optional only at external test ports; production stages always declare a lane. */
    terminalLane?: VerificationTerminalLane;
  }>;

export type AuditVerifier = (
  request: AuditVerificationRequest,
  context?: CandidateAwareModelStageContext,
) => Promise<AuditVerificationResultWithObservation>;

export type AuditCounterchecker = (
  request: AuditCountercheckRequest,
  context?: CandidateAwareModelStageContext,
) => Promise<AuditVerificationResultWithObservation>;

/** Exact candidate-bound recovery state for one verifier or countercheck dispatch. */
export type CandidateAwareModelStageContext = Readonly<{
  phaseInputFingerprint: string;
  /** In-memory, content-free retention for a completed verifier/countercheck stage. */
  onCompletedModelObservation?: (observation: ModelStageObservation) => void;
  priorContextOverflowTopology?: ContextOverflowTopology;
  onContextOverflowTransition?: (input: {
    phaseInputFingerprint: string;
    recoveryProtocolFingerprint: string;
    rootScopeFingerprint: string;
    event: ContextOverflowTopologyEvent;
  }) => Promise<void>;
}>;

export type CandidateAwareCheckpointUpdate = Readonly<{
  vectorId: string;
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
  candidate: VerifiableHypothesis;
  evidenceMapFingerprint: string;
  sourcePostureFingerprint: string;
  state: AuditCandidateAwareCheckpoint['state'];
  result?: PersistedCandidateAwareResult;
  contextOverflowTopology?: CandidateAwareContextOverflowTopology;
}>;

/**
 * Checkpoint writers receive an explicit execution ownership decision. This
 * prevents resumed work from treating an absent observation as free provider work.
 */
type AuditEvidenceMapDraftUpdate = Pick<
  AuditEvidenceMapDraft,
  'vectorId' | 'evidenceMap' | 'repairAttempts'
> &
  Readonly<{ execution: AuditCheckpointExecution }>;

type AuditSourcePostureDraftUpdate = Pick<
  AuditSourcePostureDraft,
  'vectorId' | 'sourcePosture' | 'evidenceMapFingerprint'
> &
  Readonly<{ execution: AuditCheckpointExecution }>;

/** Source-free recovery context passed only to a scoped reducible model stage. */
export type AuditScopedStageContext = Readonly<{
  phaseInputFingerprint: AuditContextOverflowLedger['phaseInputFingerprint'];
  /** In-memory, content-free retention for a completed shared model stage. */
  onCompletedModelObservation?: (observation: ModelStageObservation) => void;
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
  phaseInputFingerprint: AuditContextOverflowLedger['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditContextOverflowLedger['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditContextOverflowLedger['rootScopeFingerprint'];
  event: Omit<AuditContextOverflowLedger['events'][number], 'ordinal' | 'savedAt'>;
}>;

/** A validated, redacted evidence-map child result ready for exact reuse. */
type AuditEvidenceMapRecoveryLeafUpdateBase = Readonly<{
  vectorId: string;
  parentStageId: AuditEvidenceMapRecoveryLeaf['parentStageId'];
  phaseInputFingerprint: AuditEvidenceMapRecoveryLeaf['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditEvidenceMapRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditEvidenceMapRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditEvidenceMapRecoveryLeaf['childKey'];
  scopeFingerprint: AuditEvidenceMapRecoveryLeaf['scopeFingerprint'];
  execution: AuditEvidenceMapRecoveryLeaf['execution'];
}>;

export type AuditEvidenceMapRecoveryLeafUpdate =
  | (AuditEvidenceMapRecoveryLeafUpdateBase &
      Readonly<{
        phase: 'evidence-mapping';
        evidenceMap: Extract<
          AuditEvidenceMapRecoveryLeaf,
          { phase: 'evidence-mapping' }
        >['evidenceMap'];
      }>)
  | (AuditEvidenceMapRecoveryLeafUpdateBase &
      Readonly<{
        phase: 'evidence-map-repair';
        evidenceMap: Extract<
          AuditEvidenceMapRecoveryLeaf,
          { phase: 'evidence-map-repair' }
        >['evidenceMap'];
      }>);

export type AuditSourcePostureRecoveryLeafUpdate = Readonly<{
  vectorId: string;
  parentStageId: AuditSourcePostureRecoveryLeaf['parentStageId'];
  phaseInputFingerprint: AuditSourcePostureRecoveryLeaf['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditSourcePostureRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditSourcePostureRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditSourcePostureRecoveryLeaf['childKey'];
  scopeFingerprint: AuditSourcePostureRecoveryLeaf['scopeFingerprint'];
  execution: AuditSourcePostureRecoveryLeaf['execution'];
  sourcePosture: AuditSourcePostureRecoveryLeaf['sourcePosture'];
}>;

/** A canonical, source-validated grounding child result ready for exact reuse. */
export type AuditCandidateGroundingRecoveryLeafUpdate = Readonly<{
  vectorId: string;
  parentStageId: AuditCandidateGroundingRecoveryLeaf['parentStageId'];
  phaseInputFingerprint: AuditCandidateGroundingRecoveryLeaf['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditCandidateGroundingRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditCandidateGroundingRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditCandidateGroundingRecoveryLeaf['childKey'];
  scopeFingerprint: AuditCandidateGroundingRecoveryLeaf['scopeFingerprint'];
  execution: AuditCandidateGroundingRecoveryLeaf['execution'];
  groundings: AuditCandidateGroundingRecoveryLeaf['groundings'];
}>;

/** Evaluator-only source-free projection of a structurally accepted discovery seed. */
export type AuditVerifiedDiscoverySeedUpdate = Readonly<{
  vectorId: string;
  evidenceMapFactIds: readonly string[];
}>;

export type AuditInput = Readonly<{
  plan: AttackPlan;
  targetFingerprint: string;
  contextDigest: string;
  sources: readonly SourceDocument[];
  runId: string;
  generatedAt: string;
  mapEvidence?: AuditEvidenceMapper;
  repairEvidenceMap?: AuditEvidenceMapRepairer;
  assessSourcePosture?: AuditSourcePostureAssessor;
  groundCandidates?: AuditCandidateGrounder;
  investigate: AuditInvestigator;
  verify: AuditVerifier;
  /** Evaluation-only: production admission currently relies on verifier evidence alone. */
  countercheck?: AuditCounterchecker;
  maxParallelVectors?: number;
  resumeState?: AuditResumeState;
  /** Re-executes only terminal candidate-aware incompleteness when explicitly requested. */
  retryUnfinished?: boolean;
  onEvidenceMapDraft?: (draft: AuditEvidenceMapDraftUpdate) => Promise<void>;
  onCandidateGroundingDraft?: (
    draft: Pick<
      AuditCandidateGroundingDraft,
      | 'vectorId'
      | 'groundings'
      | 'closures'
      | 'hypothesisGroundingFunnel'
      | 'candidateIntegrityRejections'
      | 'discoveryObservation'
      | 'modelObservation'
      | 'evidenceMapFingerprint'
      | 'sourcePostureFingerprint'
    >,
  ) => Promise<void>;
  onVerifiedDiscoverySeed?: (update: AuditVerifiedDiscoverySeedUpdate) => Promise<void>;
  onCandidateAwareCheckpoint?: (update: CandidateAwareCheckpointUpdate) => Promise<void>;
  onSourcePostureDraft?: (draft: AuditSourcePostureDraftUpdate) => Promise<void>;
  onContextOverflowTransition?: (update: AuditContextOverflowTransition) => Promise<void>;
  onEvidenceMapRecoveryLeaf?: (update: AuditEvidenceMapRecoveryLeafUpdate) => Promise<void>;
  onSourcePostureRecoveryLeaf?: (update: AuditSourcePostureRecoveryLeafUpdate) => Promise<void>;
  onCandidateGroundingRecoveryLeaf?: (
    update: AuditCandidateGroundingRecoveryLeafUpdate,
  ) => Promise<void>;
  onVectorResult?: (result: AuditVectorResult) => Promise<void>;
}>;

type VectorMapRepairState = Readonly<{
  evidenceMap: EvidenceMap;
  initialMapObservation?: ModelStageObservation;
  repairObservations: readonly ModelStageObservation[];
  repairAttempts: readonly AuditEvidenceMapRepairAttempt[];
}>;

/** Executes a matching strict plan without invoking model code directly. */
export async function runAudit(input: AuditInput): Promise<AuditReport> {
  assertPlanMatchesTarget(input.plan, input.targetFingerprint, input.contextDigest);
  const maxParallelVectors = MaxParallelVectorsSchema.parse(
    input.maxParallelVectors ?? DefaultMaxParallelVectors,
  );
  const candidateAwareDispatchPool = createCandidateAwareDispatchPool(maxParallelVectors);
  const vectorResults = await mapWithConcurrency(
    input.plan.vectors,
    maxParallelVectors,
    async (vector) => {
      const prior = input.resumeState?.vectorResult(vector.vectorId);
      if (prior !== undefined) return AuditVectorResultSchema.parse(prior);
      const result = materializeAuditVectorResultForPersistence(
        await executeVector(input, vector, candidateAwareDispatchPool),
      );
      try {
        await persistAuditCheckpoint(() => input.onVectorResult?.(result));
        return result;
      } catch (error) {
        if (!isCheckpointPersistenceError(error)) throw error;
        return checkpointPersistenceFailureResult(result, 'audit');
      }
    },
  );
  const coverage = vectorResults.map((result) => result.coverage);
  const errors = vectorResults.flatMap((result) => result.errors);
  const proposed = vectorResults.flatMap((result) => result.proposed);
  const reviewRequired = vectorResults.flatMap((result) => result.reviewRequired);
  const findings = synthesizeFindings(proposed);
  return AuditReportSchema.parse({
    schemaVersion: 21,
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
  repairState?: VectorMapRepairState,
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
  let retainedEvidenceMap: EvidenceMap | undefined;
  let retainedSourcePosture: SourcePosture | undefined;
  let retainedVerificationObservations: readonly ModelStageObservation[] = [];
  let retainedCountercheckObservations: readonly ModelStageObservation[] = [];
  try {
    const mapRequest = {
      vector,
      availableSourcePaths: scopedSources.map((source) => source.path),
      limitations: [...evidencePackage.limitations],
    };
    const priorMapDraft =
      repairState === undefined ? input.resumeState?.evidenceMapDraft(vector.vectorId) : undefined;
    activeStage = 'evidence-mapping';
    const mapped =
      repairState !== undefined
        ? {
            evidenceMap: repairState.evidenceMap,
            modelObservation: repairState.initialMapObservation,
          }
        : priorMapDraft === undefined
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
                scopedStageContext(
                  input,
                  vector.vectorId,
                  { phase: 'evidence-mapping' },
                  (observation) => {
                    retainedEvidenceMapObservation = observation;
                  },
                ),
              )
          : {
              evidenceMap: priorMapDraft.evidenceMap,
              modelObservation: modelObservationForAuditCheckpointExecution(
                priorMapDraft.execution,
              ),
            };
    retainedEvidenceMapObservation = mapped.modelObservation ?? retainedEvidenceMapObservation;
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
    retainedEvidenceMap = verifiedMap.evidenceMap;
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
    if (priorMapDraft === undefined && repairState === undefined) {
      await persistAuditCheckpoint(() =>
        input.onEvidenceMapDraft?.({
          vectorId: vector.vectorId,
          evidenceMap: verifiedMap.evidenceMap,
          repairAttempts: [],
          execution: auditCheckpointExecutionForModelObservation(mapped.modelObservation),
        }),
      );
    }
    const postureRequest = {
      ...mapRequest,
      evidenceMap: verifiedMap.evidenceMap,
    };
    const currentEvidenceMapFingerprint = evidenceMapFingerprint(verifiedMap.evidenceMap);
    const resumableSourcePostureDraft =
      repairState === undefined
        ? input.resumeState?.sourcePostureDraft(vector.vectorId)
        : undefined;
    const priorSourcePostureDraft =
      resumableSourcePostureDraft?.evidenceMapFingerprint === currentEvidenceMapFingerprint
        ? resumableSourcePostureDraft
        : undefined;
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
              scopedStageContext(
                input,
                vector.vectorId,
                {
                  phase: 'source-posture',
                  evidenceMapFingerprint: currentEvidenceMapFingerprint,
                },
                (observation) => {
                  retainedSourcePostureObservation = observation;
                },
              ),
            )
        : {
            sourcePosture: priorSourcePostureDraft.sourcePosture,
            modelObservation: modelObservationForAuditCheckpointExecution(
              priorSourcePostureDraft.execution,
            ),
          };
    retainedSourcePostureObservation =
      assessed.modelObservation ?? retainedSourcePostureObservation;
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
    retainedSourcePosture = verifiedSourcePosture.sourcePosture;
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
      await persistAuditCheckpoint(() =>
        input.onSourcePostureDraft?.({
          vectorId: vector.vectorId,
          sourcePosture: verifiedSourcePosture.sourcePosture,
          evidenceMapFingerprint: currentEvidenceMapFingerprint,
          execution: auditCheckpointExecutionForModelObservation(assessed.modelObservation),
        }),
      );
    }
    const currentSourcePostureFingerprint = sourcePostureFingerprint(
      verifiedSourcePosture.sourcePosture,
    );
    const resumableGroundingDraft =
      repairState === undefined
        ? input.resumeState?.candidateGroundingDraft(vector.vectorId)
        : undefined;
    const priorDraft =
      resumableGroundingDraft?.evidenceMapFingerprint === currentEvidenceMapFingerprint &&
      resumableGroundingDraft.sourcePostureFingerprint === currentSourcePostureFingerprint
        ? resumableGroundingDraft
        : undefined;
    const groundingResumeBoundary = resolveGroundingResumeBoundary({
      priorDraft,
      retryUnfinished: input.retryUnfinished === true,
    });
    const reusedGroundingDraft =
      groundingResumeBoundary.kind === 'candidate-aware'
        ? groundingResumeBoundary.draft
        : undefined;
    activeStage = 'investigation';
    const discovery =
      groundingResumeBoundary.kind === 'discovery'
        ? await input.investigate(
            AuditInvestigationRequestSchema.parse({
              ...postureRequest,
              sourcePosture: verifiedSourcePosture.sourcePosture,
            }),
            scopedStageContext(
              input,
              vector.vectorId,
              {
                phase: 'investigation',
                evidenceMapFingerprint: currentEvidenceMapFingerprint,
                sourcePostureFingerprint: currentSourcePostureFingerprint,
              },
              (observation) => {
                retainedInvestigationObservation = observation;
              },
            ),
          )
        : undefined;
    const investigationObservation =
      reusedGroundingDraft !== undefined
        ? reusedGroundingDraft.discoveryObservation
        : priorDraft !== undefined && discovery?.modelObservation !== undefined
          ? mergeModelStageObservations([
              priorDraft.discoveryObservation,
              discovery.modelObservation,
            ])
          : discovery?.modelObservation;
    retainedInvestigationObservation = investigationObservation;
    if (investigationObservation?.status === 'failed') {
      return failedVectorStageResult({
        vector,
        matchedSourcePaths: scopedSources.length,
        limitations: evidencePackage.limitations,
        code: investigationObservation.errorCode ?? 'provider-failure',
        stage: 'investigation',
        evidenceMap: verifiedMap.evidenceMap,
        sourcePosture: verifiedSourcePosture.sourcePosture,
        evidenceMapObservation: mapped.modelObservation,
        sourcePostureObservation: assessed.modelObservation,
        investigationObservation,
        verificationObservations: [],
        countercheckObservations: [],
      });
    }
    const verifiedClosures = verifyInvestigationClosures(
      vector,
      reusedGroundingDraft?.closures ?? discovery?.closures ?? [],
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
    for (const seed of verifiedSeeds.verified) {
      await persistAuditCheckpoint(() =>
        input.onVerifiedDiscoverySeed?.({
          vectorId: vector.vectorId,
          evidenceMapFactIds: seed.evidenceMapFactIds,
        }),
      );
    }
    activeStage = 'candidate-grounding';
    const groundingSeeds = retryGroundingSeeds({
      seeds: verifiedSeeds.verified,
      priorDraft,
      retryUnfinished: input.retryUnfinished === true,
    });
    const grounding =
      reusedGroundingDraft !== undefined ||
      groundingSeeds.length === 0 ||
      input.groundCandidates === undefined
        ? undefined
        : await input.groundCandidates(
            CandidateGroundingRequestSchema.parse({
              vector,
              evidenceMap: verifiedMap.evidenceMap,
              sourcePosture: verifiedSourcePosture.sourcePosture,
              seeds: groundingSeeds,
              availableSourcePaths: scopedSources.map((source) => source.path),
            }),
            scopedStageContext(
              input,
              vector.vectorId,
              {
                phase: 'candidate-grounding',
                evidenceMapFingerprint: currentEvidenceMapFingerprint,
                sourcePostureFingerprint: currentSourcePostureFingerprint,
              },
              (observation) => {
                retainedCandidateGroundingObservation = observation;
              },
            ),
          );
    if (grounding?.modelObservation?.status === 'failed') {
      return failedVectorStageResult({
        vector,
        matchedSourcePaths: scopedSources.length,
        limitations: evidencePackage.limitations,
        code: grounding.modelObservation.errorCode ?? 'provider-failure',
        stage: 'candidate-grounding',
        evidenceMap: verifiedMap.evidenceMap,
        sourcePosture: verifiedSourcePosture.sourcePosture,
        evidenceMapObservation: mapped.modelObservation,
        sourcePostureObservation: assessed.modelObservation,
        investigationObservation,
        candidateGroundingObservation: grounding.modelObservation,
        verificationObservations: [],
        countercheckObservations: [],
      });
    }
    const groundingMapInsufficiencies = grounding?.mapInsufficiencies ?? [];
    if (groundingMapInsufficiencies.length > 0) {
      return repairAndRestartVector({
        input,
        vector,
        candidateAwareDispatchPool,
        scopedSources,
        evidencePackageLimitations: evidencePackage.limitations,
        evidenceMap: verifiedMap.evidenceMap,
        initialMapObservation: mapped.modelObservation,
        repairObservations: repairState?.repairObservations ?? [],
        repairAttempts: repairState?.repairAttempts ?? priorMapDraft?.repairAttempts ?? [],
        insufficiencies: groundingMapInsufficiencies,
      });
    }
    const canonicalGroundings =
      reusedGroundingDraft !== undefined
        ? reusedGroundingDraft.groundings
        : priorDraft !== undefined && input.retryUnfinished === true
          ? mergeRetryGroundingOutcomes({
              seeds: verifiedSeeds.verified,
              prior: priorDraft.groundings,
              recovered: canonicalGroundingOutput({
                vector,
                seeds: groundingSeeds,
                grounding,
                evidenceMap: verifiedMap.evidenceMap,
                sourcePosture: verifiedSourcePosture.sourcePosture,
                sources: scopedSources,
              }),
            })
          : undefined;
    const selectedGroundings =
      reusedGroundingDraft !== undefined
        ? {
            candidates: groundedHypotheses(reusedGroundingDraft.groundings),
            seedBoundCandidates: [],
            submittedCount: groundedHypotheses(reusedGroundingDraft.groundings).length,
            nullCount: 0,
            rejectedCount: 0,
          }
        : canonicalGroundings !== undefined
          ? selectCanonicalSeedBoundGroundings(verifiedSeeds.verified, canonicalGroundings)
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
      candidates: selectedGroundings.candidates,
      rejectedCount: 0,
    };
    const hypothesisGroundingFunnel =
      reusedGroundingDraft !== undefined
        ? reusedGroundingDraft.hypothesisGroundingFunnel
        : {
            discoveredSeedCount: discovery?.seeds.length ?? 0,
            discoveryBindingRejectedCount: verifiedSeeds.rejectedCount,
            discoveryIntegrityRejections,
            groundingNullCount: selectedGroundings.nullCount,
            groundingBindingRejectedCount: selectedGroundings.rejectedCount,
            submittedCandidateCount: traceBoundCandidates.candidates.length,
          };
    const initiallyVerified = verifyModelFindings<UnverifiedAuditCandidate | VerifiableHypothesis>(
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
      reusedGroundingDraft?.candidateIntegrityRejections ??
      CandidateIntegrityRejectionLedgerSchema.parse(
        Object.fromEntries(
          CandidateStructuralRejectionReasonSchema.options.map((reason) => [
            reason,
            initiallyVerified.rejected.filter((rejection) => rejection.reason === reason).length,
          ]),
        ),
      );
    const candidateGroundingObservation =
      reusedGroundingDraft !== undefined
        ? reusedGroundingDraft.modelObservation
        : priorDraft !== undefined && grounding?.modelObservation !== undefined
          ? mergeModelStageObservations([priorDraft.modelObservation, grounding.modelObservation])
          : (grounding?.modelObservation ?? priorDraft?.modelObservation);
    retainedCandidateGroundingObservation = candidateGroundingObservation;
    if (
      reusedGroundingDraft === undefined &&
      discovery?.modelObservation !== undefined &&
      grounding?.modelObservation?.status === 'completed'
    ) {
      if (investigationObservation === undefined || candidateGroundingObservation === undefined) {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'A completed candidate-grounding draft must retain both phase observations.',
        );
      }
      await persistAuditCheckpoint(() =>
        input.onCandidateGroundingDraft?.({
          vectorId: vector.vectorId,
          evidenceMapFingerprint: currentEvidenceMapFingerprint,
          sourcePostureFingerprint: currentSourcePostureFingerprint,
          groundings: AuditCandidateGroundingDraftSchema.shape.groundings.parse(
            canonicalGroundings ??
              canonicalGroundingOutput({
                vector,
                seeds: verifiedSeeds.verified,
                grounding,
                evidenceMap: verifiedMap.evidenceMap,
                sourcePosture: verifiedSourcePosture.sourcePosture,
                sources: scopedSources,
              }),
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
          discoveryObservation: investigationObservation,
          modelObservation: candidateGroundingObservation,
        }),
      );
    }
    const errors: AuditError[] = [];
    if (verifiedModel.rejectedCount > 0) {
      errors.push({
        code: 'model-evidence-rejected',
        stage: 'verification',
        retryable: false,
      });
    }
    const verifiedFindings = verifiedModel.verified;
    activeStage = 'verification';
    const verificationCollection = await collectCandidateAwareResults(
      verifiedFindings.map(async (hypothesis, index) => {
        return runCandidateAwareStage({
          input,
          candidateAwareDispatchPool,
          vector,
          phase: 'verification',
          candidateOrdinal: index + 1,
          hypothesis,
          evidenceMapFingerprint: currentEvidenceMapFingerprint,
          sourcePostureFingerprint: currentSourcePostureFingerprint,
          execute: async (stageContext) => {
            const verificationId = `verification-${vector.vectorId}-${index + 1}`;
            const request = AuditVerificationRequestSchema.parse({
              verificationId,
              vector,
              evidenceMap: verifiedMap.evidenceMap,
              sourcePosture: verifiedSourcePosture.sourcePosture,
              hypothesis,
              availableSourcePaths: scopedSources.map((source) => source.path),
            });
            return input.verify(request, stageContext);
          },
        });
      }),
    );
    retainedVerificationObservations = verificationCollection.modelObservations;
    if (verificationCollection.error !== undefined) throw verificationCollection.error;
    const verificationResults = verificationCollection.results;
    if (verificationResults.some((result) => result.checkpointPersistenceFailed === true)) {
      return failedVectorStageResult({
        vector,
        matchedSourcePaths: scopedSources.length,
        limitations: evidencePackage.limitations,
        code: 'checkpoint-persistence-failed',
        stage: 'verification',
        evidenceMap: verifiedMap.evidenceMap,
        sourcePosture: verifiedSourcePosture.sourcePosture,
        evidenceMapObservation: mapped.modelObservation,
        sourcePostureObservation: assessed.modelObservation,
        investigationObservation,
        candidateGroundingObservation,
        verificationObservations: retainedVerificationObservations,
        countercheckObservations: [],
      });
    }
    const verifierReconciled = verificationResults.map((result, index) => {
      const hypothesis = verifiedFindings[index];
      if (result.decision !== 'accepted' || hypothesis === undefined) return [];
      const claimEvidenceBundles = result.claimEvidenceBundles;
      if (
        claimEvidenceBundles === null ||
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
      return [
        VerifiableHypothesisSchema.parse({
          ...hypothesis,
          claimEvidenceBundles,
          planObligations: result.verifiedPlanObligations,
        }),
      ];
    });
    const verificationMapInsufficiencies = verificationResults.flatMap((result) =>
      result.decision === 'incomplete' ? (result.mapInsufficiencies ?? []) : [],
    );
    if (verificationMapInsufficiencies.length > 0) {
      return repairAndRestartVector({
        input,
        vector,
        candidateAwareDispatchPool,
        scopedSources,
        evidencePackageLimitations: evidencePackage.limitations,
        evidenceMap: verifiedMap.evidenceMap,
        initialMapObservation: mapped.modelObservation,
        repairObservations: repairState?.repairObservations ?? [],
        repairAttempts: repairState?.repairAttempts ?? priorMapDraft?.repairAttempts ?? [],
        insufficiencies: verificationMapInsufficiencies,
      });
    }
    const countercheck = input.countercheck;
    activeStage = 'countercheck';
    const countercheckCollection =
      countercheck === undefined
        ? {
            results: verifierReconciled.map(() => undefined),
            modelObservations: [],
            error: undefined,
          }
        : await collectCandidateAwareResults(
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
                evidenceMapFingerprint: currentEvidenceMapFingerprint,
                sourcePostureFingerprint: currentSourcePostureFingerprint,
                execute: async (stageContext) => {
                  const countercheckId = `countercheck-${vector.vectorId}-${index + 1}`;
                  const request = AuditCountercheckRequestSchema.parse({
                    countercheckId,
                    vector,
                    evidenceMap: verifiedMap.evidenceMap,
                    sourcePosture: verifiedSourcePosture.sourcePosture,
                    hypothesis,
                    availableSourcePaths: scopedSources.map((source) => source.path),
                  });
                  return countercheck(request, stageContext);
                },
              });
            }),
          );
    retainedCountercheckObservations = countercheckCollection.modelObservations;
    // Counterchecks are evaluator-only measurements. They may challenge a
    // verifier result, but never replace the verifier's independently
    // reconciled admission decision or alter product finding coverage. Their
    // own terminal state is held only in evaluator-owned candidate checkpoints
    // and source-free model observations.
    const postVerification = verifierReconciled.flat();
    const reviewRequiredCandidates = postVerification.filter((hypothesis) =>
      hasCandidateBlindPostureContradiction(hypothesis, verifiedSourcePosture.sourcePosture),
    );
    const acceptedCandidates = postVerification.filter(
      (hypothesis) =>
        !hasCandidateBlindPostureContradiction(hypothesis, verifiedSourcePosture.sourcePosture),
    );
    const canonicalAccepted = canonicalizeProposedFindings(acceptedCandidates);
    const canonicalReviewRequired = canonicalizeProposedFindings(reviewRequiredCandidates);
    const accepted = canonicalAccepted.findings;
    const reviewRequired = canonicalReviewRequired.findings;
    for (const [index, result] of verificationResults.entries()) {
      if (result.decision === 'accepted') {
        if ((verifierReconciled[index]?.length ?? 0) > 0) continue;
        errors.push({
          code: 'verifier-evidence-rejected',
          stage: 'verification',
          retryable: false,
        });
        continue;
      }
      const operationalError = candidateAwareOperationalError(result, 'verification');
      if (operationalError !== undefined) errors.push(operationalError);
    }
    const verificationObservations = retainedVerificationObservations;
    const countercheckObservations = retainedCountercheckObservations;
    activeStage = 'synthesis';
    const admissionFunnel = createFindingAdmissionFunnel({
      modelCandidateCount: traceBoundCandidates.candidates.length,
      integrityRejectedCount: verifiedModel.rejectedCount,
      toolEvidenceRejectedCount: 0,
      verificationResults,
      verifierToolEvidenceRejectedCount: 0,
      verifierReconciledCount: verifierReconciled.filter((finding) => finding.length > 0).length,
      duplicateCollapsedCount:
        canonicalAccepted.duplicateCollapsedCount + canonicalReviewRequired.duplicateCollapsedCount,
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
        ...(repairState === undefined || repairState.repairObservations.length === 0
          ? {}
          : { evidenceMapRepairObservations: [...repairState.repairObservations] }),
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
      proposed: [...accepted],
      reviewRequired: [...reviewRequired],
    };
  } catch (error) {
    const code = errorCode(error);
    return failedVectorStageResult({
      vector,
      matchedSourcePaths: scopedSources.length,
      limitations: evidencePackage.limitations,
      code,
      stage: activeStage,
      ...(retainedEvidenceMap === undefined ? {} : { evidenceMap: retainedEvidenceMap }),
      ...(retainedSourcePosture === undefined ? {} : { sourcePosture: retainedSourcePosture }),
      evidenceMapObservation: retainedEvidenceMapObservation,
      sourcePostureObservation: retainedSourcePostureObservation,
      investigationObservation: retainedInvestigationObservation,
      candidateGroundingObservation: retainedCandidateGroundingObservation,
      verificationObservations: retainedVerificationObservations,
      countercheckObservations: retainedCountercheckObservations,
    });
  }
}

/**
 * A later phase can request only generic neutral-map evidence. This boundary
 * validates that request, dispatches the candidate-blind mapper, and restarts
 * exactly the map-dependent phases when an append succeeds.
 */
async function repairAndRestartVector(input: {
  input: AuditInput;
  vector: AttackPlan['vectors'][number];
  candidateAwareDispatchPool: CandidateAwareDispatchPool;
  scopedSources: readonly SourceDocument[];
  evidencePackageLimitations: readonly string[];
  evidenceMap: EvidenceMap;
  initialMapObservation?: ModelStageObservation;
  repairObservations: readonly ModelStageObservation[];
  repairAttempts: readonly AuditEvidenceMapRepairAttempt[];
  insufficiencies: EvidenceMapInsufficiencies;
}): Promise<AuditVectorResult> {
  const insufficiencies = verifyEvidenceMapInsufficiencies(input.vector, input.insufficiencies);
  const gapSignature = sha256(evidenceMapInsufficiencySignature(insufficiencies));
  const inputMapFingerprint = evidenceMapFingerprint(input.evidenceMap);
  const priorNoProgress = input.repairAttempts.some(
    (attempt) =>
      attempt.gapSignature === gapSignature &&
      attempt.inputMapFingerprint === inputMapFingerprint &&
      attempt.outputMapFingerprint === inputMapFingerprint &&
      attempt.appendedFactCount === 0,
  );
  if (priorNoProgress) {
    return incompleteEvidenceMapResult({
      vector: input.vector,
      matchedSourcePaths: input.scopedSources.length,
      limitations: [
        ...input.evidencePackageLimitations,
        'The same candidate-blind evidence-map repair gap already completed without a new neutral fact.',
      ],
      errorCode: 'evidence-map-repair-no-progress',
      modelObservation: input.initialMapObservation,
      repairObservations: input.repairObservations,
    });
  }
  const repairer = input.input.repairEvidenceMap;
  if (repairer === undefined) {
    return incompleteEvidenceMapResult({
      vector: input.vector,
      matchedSourcePaths: input.scopedSources.length,
      limitations: [
        ...input.evidencePackageLimitations,
        'A later audit phase identified missing neutral evidence, but no mapper repair stage is configured.',
      ],
      errorCode: 'evidence-map-repair-unavailable',
      modelObservation: input.initialMapObservation,
    });
  }
  const repaired = await repairer(
    {
      vector: input.vector,
      availableSourcePaths: input.scopedSources.map((source) => source.path),
      limitations: [...input.evidencePackageLimitations],
      evidenceMap: input.evidenceMap,
      insufficiencies,
    },
    scopedStageContext(input.input, input.vector.vectorId, {
      phase: 'evidence-map-repair',
      evidenceMapFingerprint: inputMapFingerprint,
    }),
  );
  if (repaired.modelObservation?.status === 'failed') {
    return failedVectorStageResult({
      vector: input.vector,
      matchedSourcePaths: input.scopedSources.length,
      limitations: input.evidencePackageLimitations,
      code: repaired.modelObservation.errorCode ?? 'provider-failure',
      stage: 'evidence-map-repair',
      evidenceMap: input.evidenceMap,
      evidenceMapObservation: input.initialMapObservation,
      evidenceMapRepairObservations: [...input.repairObservations, repaired.modelObservation],
      verificationObservations: [],
      countercheckObservations: [],
    });
  }
  const appended = applyCanonicalEvidenceMapRepair({
    evidenceMap: input.evidenceMap,
    repairedEvidenceMap: repaired.evidenceMap,
  });
  const attempt: AuditEvidenceMapRepairAttempt = {
    gapSignature,
    inputMapFingerprint,
    outputMapFingerprint: evidenceMapFingerprint(appended.evidenceMap),
    appendedFactCount: appended.appendedFactCount,
    execution: auditCheckpointExecutionForModelObservation(repaired.modelObservation),
  };
  const repairAttempts = [...input.repairAttempts, attempt];
  const repairObservations =
    repaired.modelObservation === undefined
      ? input.repairObservations
      : [...input.repairObservations, repaired.modelObservation];
  try {
    await persistAuditCheckpoint(() =>
      input.input.onEvidenceMapDraft?.({
        vectorId: input.vector.vectorId,
        evidenceMap: appended.evidenceMap,
        repairAttempts,
        execution: auditCheckpointExecutionForModelObservation(input.initialMapObservation),
      }),
    );
  } catch (error) {
    if (!isCheckpointPersistenceError(error)) throw error;
    return failedVectorStageResult({
      vector: input.vector,
      matchedSourcePaths: input.scopedSources.length,
      limitations: input.evidencePackageLimitations,
      code: 'checkpoint-persistence-failed',
      stage: 'evidence-map-repair',
      evidenceMap: appended.evidenceMap,
      evidenceMapObservation: input.initialMapObservation,
      evidenceMapRepairObservations: repairObservations,
      verificationObservations: [],
      countercheckObservations: [],
    });
  }
  if (appended.appendedFactCount === 0) {
    return incompleteEvidenceMapResult({
      vector: input.vector,
      matchedSourcePaths: input.scopedSources.length,
      limitations: [
        ...input.evidencePackageLimitations,
        'The candidate-blind mapper found no additional neutral source fact for the same declared evidence gap.',
      ],
      errorCode: 'evidence-map-repair-no-progress',
      modelObservation: input.initialMapObservation,
      repairObservations,
    });
  }
  return executeVector(input.input, input.vector, input.candidateAwareDispatchPool, {
    evidenceMap: appended.evidenceMap,
    ...(input.initialMapObservation === undefined
      ? {}
      : { initialMapObservation: input.initialMapObservation }),
    repairObservations,
    repairAttempts,
  });
}

function scopedStageContext(
  input: AuditInput,
  vectorId: string,
  phaseInput: Exclude<RecoveryPhaseInput, { phase: 'verification' | 'countercheck' }>,
  onCompletedModelObservation?: (observation: ModelStageObservation) => void,
): AuditScopedStageContext | undefined {
  const phase = phaseInput.phase;
  const phaseInputFingerprint = recoveryPhaseInputFingerprint(phaseInput);
  const prior = input.resumeState?.scopedArtifacts({ vectorId, phase });
  const priorContextOverflowLedger = prior?.contextOverflowLedger;
  const priorEvidenceMapRecoveryLeaves = prior?.evidenceMapRecoveryLeaves;
  const priorSourcePostureRecoveryLeaves = prior?.sourcePostureRecoveryLeaves;
  const priorCandidateGroundingRecoveryLeaves = prior?.candidateGroundingRecoveryLeaves;
  if (
    priorContextOverflowLedger === undefined &&
    priorEvidenceMapRecoveryLeaves === undefined &&
    priorSourcePostureRecoveryLeaves === undefined &&
    priorCandidateGroundingRecoveryLeaves === undefined &&
    input.onContextOverflowTransition === undefined &&
    input.onEvidenceMapRecoveryLeaf === undefined &&
    input.onSourcePostureRecoveryLeaf === undefined &&
    input.onCandidateGroundingRecoveryLeaf === undefined &&
    onCompletedModelObservation === undefined
  )
    return undefined;
  return {
    phaseInputFingerprint,
    ...(onCompletedModelObservation === undefined ? {} : { onCompletedModelObservation }),
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
            persistAuditCheckpoint(() => input.onContextOverflowTransition?.(update)),
        }),
    ...(input.onEvidenceMapRecoveryLeaf === undefined
      ? {}
      : {
          onEvidenceMapRecoveryLeaf: async (update) =>
            persistAuditCheckpoint(() => input.onEvidenceMapRecoveryLeaf?.(update)),
        }),
    ...(input.onSourcePostureRecoveryLeaf === undefined
      ? {}
      : {
          onSourcePostureRecoveryLeaf: async (update) =>
            persistAuditCheckpoint(() => input.onSourcePostureRecoveryLeaf?.(update)),
        }),
    ...(input.onCandidateGroundingRecoveryLeaf === undefined
      ? {}
      : {
          onCandidateGroundingRecoveryLeaf: async (update) =>
            persistAuditCheckpoint(() => input.onCandidateGroundingRecoveryLeaf?.(update)),
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
      reasonCode: 'output-invalid',
      reason: 'Static audit has no verifier.',
      claimEvidenceBundles: null,
      contradictionEvidence: null,
      inspectedEvidence: [],
      verifiedPlanObligations: [],
      affectedPlanObligations: [],
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
  evidenceMap?: EvidenceMap;
  sourcePosture?: SourcePosture;
  evidenceMapObservation?: ModelStageObservation;
  evidenceMapRepairObservations?: readonly ModelStageObservation[];
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
      evidenceMapFactCount: input.evidenceMap?.facts.length ?? 0,
      evidenceMapUnansweredObligationCount:
        input.evidenceMap?.unansweredPlanObligations.length ?? 0,
      ...(input.sourcePosture === undefined
        ? emptySourcePostureCoverage()
        : sourcePostureCoverage(input.sourcePosture)),
      findingCount: 0,
      outcome: terminalFailureOutcome(input.code),
      errorCode: input.code,
      limitations: uniqueSorted(input.limitations),
      obligationClosure: deriveObligationClosureMatrix({
        vector: input.vector,
        ...(input.evidenceMap === undefined ? {} : { evidenceMap: input.evidenceMap }),
        ...(input.sourcePosture === undefined ? {} : { sourcePosture: input.sourcePosture }),
      }),
      admissionFunnel: emptyFindingAdmissionFunnel(),
      verificationObservations: [...input.verificationObservations],
      countercheckObservations: [...input.countercheckObservations],
      ...(input.evidenceMapObservation === undefined
        ? {}
        : { evidenceMapObservation: input.evidenceMapObservation }),
      ...(input.evidenceMapRepairObservations === undefined
        ? {}
        : { evidenceMapRepairObservations: [...input.evidenceMapRepairObservations] }),
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
        code: materializeAuditErrorCode(input.code),
        stage: input.stage,
        retryable: isRetryableAuditErrorCode(materializeAuditErrorCode(input.code)),
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
        code: materializeAuditErrorCode(code),
        stage: 'evidence-mapping',
        retryable: isRetryableAuditErrorCode(materializeAuditErrorCode(code)),
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
  repairObservations?: readonly ModelStageObservation[];
}): AuditVectorResult {
  return {
    coverage: {
      vectorId: input.vector.vectorId,
      planned: true,
      completed: false,
      matchedSourcePaths: input.matchedSourcePaths,
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
      ...(input.repairObservations === undefined
        ? {}
        : { evidenceMapRepairObservations: [...input.repairObservations] }),
    },
    errors: [
      {
        code: materializeAuditErrorCode(input.errorCode),
        stage: 'evidence-mapping',
        retryable: isRetryableAuditErrorCode(materializeAuditErrorCode(input.errorCode)),
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
        code: materializeAuditErrorCode(input.errorCode),
        stage: 'source-posture',
        retryable: isRetryableAuditErrorCode(materializeAuditErrorCode(input.errorCode)),
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
        code: materializeAuditErrorCode(input.errorCode),
        stage: 'source-posture',
        retryable: isRetryableAuditErrorCode(materializeAuditErrorCode(input.errorCode)),
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
        retryable: isRetryableAuditErrorCode('obligation-closure-incomplete'),
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
  evidenceMapFingerprint: string;
  sourcePostureFingerprint: string;
  execute: (
    context: CandidateAwareModelStageContext,
  ) => Promise<AuditVerificationResultWithObservation>;
}): Promise<NormalizedCandidateAwareResult> {
  const phaseInputFingerprint = recoveryPhaseInputFingerprint({
    phase: input.phase,
    candidateFingerprint: candidateAwareFingerprint(input.hypothesis),
    evidenceMapFingerprint: input.evidenceMapFingerprint,
    sourcePostureFingerprint: input.sourcePostureFingerprint,
  });
  const priorCheckpoint = input.input.resumeState?.candidateAwareCheckpoint({
    vectorId: input.vector.vectorId,
    phase: input.phase,
    candidateOrdinal: input.candidateOrdinal,
    candidate: input.hypothesis,
    evidenceMapFingerprint: input.evidenceMapFingerprint,
    sourcePostureFingerprint: input.sourcePostureFingerprint,
  });
  const prior = reusableCandidateAwareResult({
    checkpoint: priorCheckpoint,
    retryUnfinished: input.input.retryUnfinished ?? false,
  });
  if (prior !== undefined) return prior;
  let contextOverflowTopology = priorCheckpoint?.contextOverflowTopology;
  if (
    contextOverflowTopology !== undefined &&
    contextOverflowTopology.phaseInputFingerprint !== phaseInputFingerprint
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The candidate-aware context-overflow topology is bound to a different phase input.',
    );
  }
  const update = async (
    state: AuditCandidateAwareCheckpoint['state'],
    result?: PersistedCandidateAwareResult,
  ): Promise<void> =>
    persistAuditCheckpoint(() =>
      input.input.onCandidateAwareCheckpoint?.({
        vectorId: input.vector.vectorId,
        phase: input.phase,
        candidateOrdinal: input.candidateOrdinal,
        candidate: input.hypothesis,
        evidenceMapFingerprint: input.evidenceMapFingerprint,
        sourcePostureFingerprint: input.sourcePostureFingerprint,
        state,
        ...(result === undefined ? {} : { result }),
        ...(contextOverflowTopology === undefined ? {} : { contextOverflowTopology }),
      }),
    );
  try {
    await update('pending');
  } catch (error) {
    if (isCheckpointPersistenceError(error)) {
      return checkpointPersistenceFailedCandidateAwareResult();
    }
    throw error;
  }
  return input.candidateAwareDispatchPool.run(async () => {
    try {
      await update('running');
    } catch (error) {
      if (isCheckpointPersistenceError(error)) {
        return checkpointPersistenceFailedCandidateAwareResult();
      }
      throw error;
    }
    let completedModelObservation: ModelStageObservation | undefined;
    let result: NormalizedCandidateAwareResult;
    try {
      result = normalizeCandidateAwareResult(
        await input.execute({
          phaseInputFingerprint,
          onCompletedModelObservation: (observation) => {
            completedModelObservation = observation;
          },
          ...(contextOverflowTopology === undefined
            ? {}
            : {
                priorContextOverflowTopology:
                  runtimeContextOverflowTopology(contextOverflowTopology),
              }),
          onContextOverflowTransition: async (transition) => {
            contextOverflowTopology = appendCandidateAwareContextOverflowEvent(
              contextOverflowTopology,
              {
                ...transition,
                phaseInputFingerprint,
              },
            );
            await update('running');
          },
        }),
      );
    } catch (error) {
      if (isProviderCancelled(error)) {
        input.candidateAwareDispatchPool.cancel(error);
        throw error;
      }
      if (isCheckpointPersistenceError(error)) {
        return checkpointPersistenceFailedCandidateAwareResult();
      }
      result = incompleteCandidateAwareResult(
        'wrapper-contract-invalid',
        completedModelObservation,
      );
    }
    try {
      await update('completed', persistCandidateAwareResult(result));
    } catch (error) {
      if (isCheckpointPersistenceError(error)) {
        return checkpointPersistenceFailedCandidateAwareResult(result.modelObservation);
      }
      throw error;
    }
    if (result.modelObservation?.errorCode === 'provider-cancelled') {
      const error = new AuditRuntimeError(
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
  checkpoint: AuditCandidateAwareCheckpoint | undefined;
  retryUnfinished: boolean;
}): NormalizedCandidateAwareResult | undefined {
  const checkpoint = input.checkpoint;
  if (
    checkpoint?.result === undefined ||
    (input.retryUnfinished && checkpoint.result.decision === 'incomplete')
  )
    return undefined;
  const { execution, ...result } = checkpoint.result;
  const modelObservation = modelObservationForAuditCheckpointExecution(execution);
  return {
    ...result,
    ...(modelObservation === undefined ? {} : { modelObservation }),
  };
}

function runtimeContextOverflowTopology(
  topology: CandidateAwareContextOverflowTopology,
): ContextOverflowTopology {
  return {
    phaseInputFingerprint: topology.phaseInputFingerprint,
    recoveryProtocolFingerprint: topology.recoveryProtocolFingerprint,
    rootScopeFingerprint: topology.rootScopeFingerprint,
    events: topology.events.map(({ ordinal: _ordinal, savedAt: _savedAt, ...event }) => event),
  };
}

function appendCandidateAwareContextOverflowEvent(
  previous: CandidateAwareContextOverflowTopology | undefined,
  input: Readonly<{
    phaseInputFingerprint: string;
    recoveryProtocolFingerprint: string;
    rootScopeFingerprint: string;
    event: ContextOverflowTopologyEvent;
  }>,
): CandidateAwareContextOverflowTopology {
  if (
    previous !== undefined &&
    (previous.phaseInputFingerprint !== input.phaseInputFingerprint ||
      previous.recoveryProtocolFingerprint !== input.recoveryProtocolFingerprint ||
      previous.rootScopeFingerprint !== input.rootScopeFingerprint)
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'Candidate-aware context-overflow topology changed its exact recovery binding.',
    );
  }
  return {
    phaseInputFingerprint: input.phaseInputFingerprint,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    events: [
      ...(previous?.events ?? []),
      {
        ordinal: (previous?.events.length ?? 0) + 1,
        ...input.event,
        savedAt: new Date().toISOString(),
      },
    ],
  };
}

/** Stores the already source-minimal canonical decision and telemetry. */
function persistCandidateAwareResult(
  result: NormalizedCandidateAwareResult,
): PersistedCandidateAwareResult {
  const { modelObservation, ...persisted } = result;
  return {
    ...persisted,
    execution: auditCheckpointExecutionForModelObservation(modelObservation),
  };
}

/** Makes the ownership choice explicit at the durable audit boundary. */
function auditCheckpointExecutionForModelObservation(
  modelObservation: ModelStageObservation | undefined,
): AuditCheckpointExecution {
  return modelObservation === undefined
    ? { kind: 'deterministic' }
    : { kind: 'provider', modelObservation };
}

type NormalizedCandidateAwareResult = AuditVerificationResult &
  Readonly<{
    modelObservation?: ModelStageObservation;
    terminalLane: VerificationTerminalLane;
    /** In-memory terminal signal; never included in a persisted verdict. */
    checkpointPersistenceFailed?: true;
  }>;

/**
 * Waits for already-dispatched siblings to settle after cancellation so their
 * completed, content-free observations remain visible in vector coverage.
 * The shared pool rejects queued siblings and prevents any later dispatch.
 */
async function collectCandidateAwareResults<
  Result extends Readonly<{ modelObservation?: ModelStageObservation }> | undefined,
>(
  work: readonly Promise<Result>[],
): Promise<
  Readonly<{
    results: readonly Result[];
    modelObservations: readonly ModelStageObservation[];
    error: Error | undefined;
  }>
> {
  const settled = await Promise.allSettled(work);
  const results = settled.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : []));
  const modelObservations = results.flatMap((result) =>
    result?.modelObservation === undefined ? [] : [result.modelObservation],
  );
  const rejection = settled.find((entry) => entry.status === 'rejected');
  return {
    results,
    modelObservations,
    error:
      rejection === undefined
        ? undefined
        : rejection.reason instanceof Error
          ? rejection.reason
          : new AuditRuntimeError(
              'provider-failure',
              'A candidate-aware stage rejected without an Error object.',
            ),
  };
}

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
    reasonCode: 'output-invalid',
    claimEvidenceBundles: null,
    contradictionEvidence: null,
    inspectedEvidence: [],
    verifiedPlanObligations: [],
    affectedPlanObligations: [],
    controlAssessment: null,
    obligationReconciliations: [],
    postureReconciliations: [],
    terminalLane,
    ...(modelObservation === undefined ? {} : { modelObservation }),
  };
}

/** Preserves a completed candidate-aware call when its required checkpoint cannot be written. */
function checkpointPersistenceFailedCandidateAwareResult(
  modelObservation?: ModelStageObservation,
): NormalizedCandidateAwareResult {
  return {
    ...incompleteCandidateAwareResult('wrapper-contract-invalid', modelObservation),
    checkpointPersistenceFailed: true,
  };
}

/**
 * Keeps a provider-normalized terminal stage code visible in the vector error
 * ledger instead of collapsing an overflow, cancellation, or cost stop into
 * generic candidate incompleteness.
 */
function candidateAwareOperationalError(
  result: AuditVerificationResultWithObservation,
  phase: 'verification' | 'countercheck',
): AuditError | undefined {
  if (result.terminalLane === 'rejected' || result.terminalLane === 'model-incomplete') {
    return undefined;
  }
  const label = phase === 'verification' ? 'verifier' : 'countercheck';
  return {
    code: materializeAuditErrorCode(
      result.modelObservation?.status === 'failed' && result.modelObservation.errorCode !== null
        ? result.modelObservation.errorCode
        : `${label}-${result.terminalLane}`,
    ),
    stage: phase,
    retryable: isRetryableAuditErrorCode(
      materializeAuditErrorCode(result.modelObservation?.errorCode ?? ''),
    ),
  };
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
  return error instanceof AuditRuntimeError ? error.code : 'audit-continuation-failed';
}

function isProviderCancelled(error: unknown): error is AuditRuntimeError {
  return error instanceof AuditRuntimeError && error.code === 'provider-cancelled';
}

/** Preserves the provider-neutral stop signal without inspecting provider text. */
function terminalFailureOutcome(errorCode: string): 'failed' | 'cancelled' {
  return errorCode === 'provider-cancelled' ? 'cancelled' : 'failed';
}

/**
 * Makes checkpoint failures explicit without retaining the callback error or
 * any source/model content. The already completed model stage remains valid
 * work and is returned in the vector's terminal coverage.
 */
async function persistAuditCheckpoint(callback: () => Promise<void> | undefined): Promise<void> {
  try {
    await callback();
  } catch {
    throw new AuditRuntimeError(
      'checkpoint-persistence-failed',
      'A required audit checkpoint could not be persisted.',
    );
  }
}

function isCheckpointPersistenceError(error: unknown): error is AuditRuntimeError {
  return error instanceof AuditRuntimeError && error.code === 'checkpoint-persistence-failed';
}

/**
 * A terminal vector result could not be checkpointed. Keep its already
 * inspected coverage and model observations for the caller, but never retain
 * its findings as a successfully persisted audit outcome.
 */
function checkpointPersistenceFailureResult(
  result: AuditVectorResult,
  stage: AuditError['stage'],
): AuditVectorResult {
  const { admissionFunnel: _admissionFunnel, ...coverage } = result.coverage;
  return AuditVectorResultSchema.parse({
    coverage: {
      ...coverage,
      completed: false,
      findingCount: 0,
      reviewRequiredCount: 0,
      outcome: 'failed',
      errorCode: 'checkpoint-persistence-failed',
      limitations: uniqueSorted([...coverage.limitations, 'checkpoint-persistence-failed']),
    },
    errors: [
      ...result.errors,
      {
        code: 'checkpoint-persistence-failed',
        stage,
        retryable: false,
      },
    ],
    proposed: [],
    reviewRequired: [],
  });
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
