import type { ModelProvider } from '@purista/harness';
import {
  type AttackPlan,
  claimEvidenceItems,
  createPlan,
  type SourceEvidence,
} from '../../src/features/attack-planning/index.js';
import {
  aggregateCandidateIntegrityRejectionLedgers,
  aggregateFindingAdmissionFunnels,
  aggregateHypothesisGroundingFunnels,
} from '../../src/features/audit-execution/admission/funnel.js';
import type {
  AuditCandidateGroundingRecoveryLeafUpdate,
  AuditContextOverflowTransition,
  AuditEvidenceMapRecoveryLeafUpdate,
  AuditSourcePostureRecoveryLeafUpdate,
  CandidateAwareCheckpointUpdate,
} from '../../src/features/audit-execution/audit.js';
import type {
  AuditCandidateAwareCheckpoint,
  AuditCandidateGroundingDraft,
  AuditCandidateGroundingRecoveryLeaf,
  AuditContextOverflowLedger,
  AuditEvidenceMapDraft,
  AuditEvidenceMapRecoveryLeaf,
  AuditSourcePostureDraft,
  AuditSourcePostureRecoveryLeaf,
  AuditVectorResult,
  CandidateIntegrityRejectionLedger,
  FindingAdmissionFunnel,
  HypothesisGroundingFunnel,
} from '../../src/features/audit-execution/audit.schema.js';
import { groundedHypotheses } from '../../src/features/audit-execution/candidate-grounding/identity.js';
import {
  type AuditCheckpointBaseBinding,
  createAuditResumeState,
} from '../../src/features/audit-execution/checkpoints.js';
import {
  type ModelCostCeiling,
  type ModelPricing,
  type ModelRunObservation,
  type ModelStageObservation,
  summarizeModelStages,
} from '../../src/features/model-operations/model-operations.js';
import {
  evidenceMapProtocolFingerprint,
  reviewWorkflowPromptProtocolFingerprint,
} from '../../src/features/review-workflow/prompt-protocol.js';
import {
  createVerificationRouteFingerprint,
  type ResolvedVerificationRoute,
} from '../../src/features/review-workflow/runtime/verification-route.js';
import { createReviewService } from '../../src/features/review-workflow/service.js';
import type { EvaluatorFailureDiagnosticSink } from '../../src/features/review-workflow/stages/scoped-model-stage.js';
import {
  MaxParallelVectorsSchema,
  type VerificationMode,
} from '../../src/platform/configuration/environment.js';
import type { HarnessExecutionConfiguration } from '../../src/platform/harness/audit-harness.js';
import { canonicalJson, createStableId, sha256 } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import { contextRoot, type LoadedCorpusPack, variantRoot } from './corpus.js';
import {
  type CorpusAnswerKey,
  type CorpusSplit,
  type EvaluationGeneratedPlanCheckpoint,
  type EvaluationTrial,
  type EvaluationTrialIdentity,
  type ExpectedEvidenceRoleTrace,
  type ExpectedEvidenceTraceCheckpointBinding,
  type FindingCoverageClass,
  type PlanEvaluationProfile,
  type PlanSemanticMeasurement,
  type RealWorldEvaluationRun,
  RealWorldEvaluationRunSchema,
} from './corpus.schema.js';
import {
  assessCorpusReadiness,
  deriveEvaluationEvidenceQualification,
} from './corpus-readiness.js';
import {
  evaluationBenchmarkProtocolFingerprint,
  evaluationPopulationDigest,
} from './evaluation-identity.js';
import {
  createExpectedEvidenceRoleTraces,
  traceDiscoveryEvidence,
  traceGroundedEvidence,
  traceMappedEvidence,
  tracePostureEvidence,
  traceTerminalCoverage,
  traceTerminalFindingEvidence,
  traceVerifiedEvidence,
} from './expected-evidence-trace.js';
import type { HoldoutAttestationReference } from './holdout-attestation.schema.js';
import { deriveEvaluationMeasurementState } from './measurement-state.js';
import { answerKeyScenarioDigest } from './plan-semantic-adjudication.js';
import type {
  PlanSemanticAdjudicationBinding,
  PlanSemanticEvaluatorOperation,
} from './plan-semantic-adjudication.schema.js';
import { planSemanticAgentProtocolFingerprint } from './plan-semantic-agent.instructions.js';
import type { SemanticPlanEvaluatorIdentity } from './plan-semantic-identity.schema.js';
import { evaluatorCheckpointModelStages } from './real-world-artifacts.js';
import {
  normalizedFindingKeys,
  normalizedPlanKeys,
  scoreFindings,
  scorePathReachability,
  summarizeReliability,
  terminalFindingEvidenceMatches,
} from './real-world-scorer.js';
import { stageEvidenceCoverage } from './stage-evidence-coverage.js';

export type CorpusEvaluationInput = Readonly<{
  pack: LoadedCorpusPack;
  modelProvider: ModelProvider;
  provider: string;
  model: string;
  split: CorpusSplit;
  caseIdFilter?: string;
  repetitions: number;
  planProfile?: PlanEvaluationProfile;
  runId: string;
  startedAt: string;
  mode: 'deterministic' | 'provider';
  executionBudget: HarnessExecutionConfiguration;
  maxParallelVectors: number;
  maxEstimatedCostUsd?: number;
  modelPricing?: ModelPricing;
  modelCacheRoutingKey?: string;
  priorTrials?: readonly EvaluationTrial[];
  /** Explicit recovery opt-in for incomplete, failed, or cancelled trials. */
  retryUnfinished?: boolean;
  onTrialComplete?: (trial: EvaluationTrial) => Promise<void>;
  promptProtocolFingerprint: string;
  verificationMode?: VerificationMode;
  verificationRouteFingerprint?: string;
  independentVerifierRoute?: ResolvedVerificationRoute;
  holdoutAttestation?: HoldoutAttestationReference;
  auditCheckpoints?: EvaluationAuditCheckpointStore;
  planningCheckpoints?: EvaluationPlanningCheckpointStore;
  expectedEvidenceTraceCheckpoints?: EvaluationExpectedEvidenceTraceCheckpointStore;
  /**
   * Evaluator-owned semantic operation. Its implementation owns exact
   * checkpoint reuse and persistence; the normal runner only supplies a
   * sealed plan and the shared dispatch guard after product closure.
   */
  semanticPlanEvaluator?: EvaluationPlanSemanticEvaluatorPort;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
}>;

export type EvaluationPlanSemanticEvaluatorPort = Readonly<{
  evaluate: (input: {
    binding: PlanSemanticAdjudicationBinding;
    plan: AttackPlan;
    answerKey: CorpusAnswerKey;
    retryUnfinished: boolean;
    /** The exact same observed-cost guard used by product planning and audit. */
    modelCostCeiling: ModelCostCeiling | undefined;
  }) => Promise<PlanSemanticEvaluatorOperation>;
}>;

/**
 * Evaluation-owned adapter around the product checkpoint contract. The product
 * runner provides source-free trial artifacts; this port keeps reusable draft
 * artifacts in the evaluator's private work root.
 */
export type EvaluationAuditCheckpointStore = Readonly<{
  load: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    retryUnfinished: boolean;
  }) => Promise<{
    /** All compatible terminal results retained solely for shared cost accounting. */
    observedVectorResults: readonly AuditVectorResult[];
    /** Compatible terminal results that are safe to pass back into audit execution. */
    vectorResults: readonly AuditVectorResult[];
    candidateGroundingDrafts: readonly AuditCandidateGroundingDraft[];
    candidateAwareCheckpoints: readonly AuditCandidateAwareCheckpoint[];
    evidenceMapDrafts: readonly AuditEvidenceMapDraft[];
    sourcePostureDrafts: readonly AuditSourcePostureDraft[];
    contextOverflowLedgers: readonly AuditContextOverflowLedger[];
    evidenceMapRecoveryLeaves: readonly AuditEvidenceMapRecoveryLeaf[];
    sourcePostureRecoveryLeaves: readonly AuditSourcePostureRecoveryLeaf[];
    candidateGroundingRecoveryLeaves: readonly AuditCandidateGroundingRecoveryLeaf[];
  }>;
  saveEvidenceMap: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    draft: Pick<AuditEvidenceMapDraft, 'vectorId' | 'evidenceMap' | 'repairAttempts' | 'execution'>;
  }) => Promise<void>;
  saveSourcePosture: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    draft: Pick<
      AuditSourcePostureDraft,
      'vectorId' | 'sourcePosture' | 'execution' | 'evidenceMapFingerprint'
    >;
  }) => Promise<void>;
  saveCandidateGrounding: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
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
    >;
  }) => Promise<void>;
  saveCandidateAware: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    update: CandidateAwareCheckpointUpdate;
  }) => Promise<void>;
  saveVectorResult: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    result: AuditVectorResult;
  }) => Promise<void>;
  saveContextOverflowTransition: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    update: AuditContextOverflowTransition;
  }) => Promise<void>;
  saveEvidenceMapRecoveryLeaf: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    update: AuditEvidenceMapRecoveryLeafUpdate;
  }) => Promise<void>;
  saveSourcePostureRecoveryLeaf: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    update: AuditSourcePostureRecoveryLeafUpdate;
  }) => Promise<void>;
  saveCandidateGroundingRecoveryLeaf: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    update: AuditCandidateGroundingRecoveryLeafUpdate;
  }) => Promise<void>;
}>;

/** Evaluator-private end-to-end-generated recovery; reviewed plans are never persisted here. */
export type EvaluationPlanningCheckpointStore = Readonly<{
  load: (input: {
    trialId: string;
    targetFingerprint: string;
    contextDigest: string;
  }) => Promise<EvaluationGeneratedPlanCheckpoint | undefined>;
  save: (input: {
    trialId: string;
    targetFingerprint: string;
    contextDigest: string;
    plan: AttackPlan;
    modelObservation: ModelRunObservation;
  }) => Promise<void>;
}>;

/** Evaluator-private, source-free phase progress for an expected-role trace. */
export type EvaluationExpectedEvidenceTraceCheckpointStore = Readonly<{
  load: (
    binding: ExpectedEvidenceTraceCheckpointBinding,
  ) => Promise<readonly ExpectedEvidenceRoleTrace[] | undefined>;
  save: (
    binding: ExpectedEvidenceTraceCheckpointBinding,
    roleTraces: readonly ExpectedEvidenceRoleTrace[],
  ) => Promise<void>;
}>;

/** Executes the normal plan/audit flow against an isolated corpus variant. */
export async function runCorpusEvaluation(
  input: CorpusEvaluationInput,
): Promise<RealWorldEvaluationRun> {
  const maxParallelVectors = MaxParallelVectorsSchema.parse(input.maxParallelVectors);
  const selectedCases = selectCasesForEvaluation(input.pack, input.split, input.caseIdFilter);
  const selectedTrialPopulation = selectedTrialPopulationForEvaluation(
    input.pack,
    input.split,
    input.caseIdFilter,
    input.repetitions,
  );
  const service = createReviewService(input.modelProvider, input.model, {
    maxParallelVectors,
    harnessExecution: input.executionBudget,
    modelPricing: input.modelPricing,
    ...(input.maxEstimatedCostUsd === undefined
      ? {}
      : {
          maxEstimatedCostUsd: input.maxEstimatedCostUsd,
          priorModelStages: priorModelStages(input.priorTrials ?? []),
        }),
    modelCacheRoutingKey: input.modelCacheRoutingKey,
    evaluatorFailureDiagnosticSink: input.evaluatorFailureDiagnosticSink,
    ...(input.independentVerifierRoute === undefined
      ? {}
      : { independentVerifierRoute: input.independentVerifierRoute }),
  });
  const priorByKey = new Map(
    (input.priorTrials ?? []).map((trial) => [trialKey(trial), trial] as const),
  );
  const trials: EvaluationTrial[] = [];
  const planProfile = input.planProfile ?? 'end-to-end-generated';
  const semanticPlanEvaluator: SemanticPlanEvaluatorIdentity | null =
    planProfile === 'audit-reviewed-plan'
      ? null
      : {
          protocolFingerprint: planSemanticAgentProtocolFingerprint,
          route: 'primary',
        };
  for (const loaded of selectedCases) {
    for (const variant of variantsFor(loaded.case.sourceDirectories)) {
      for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
        const key = trialKey({
          caseId: loaded.case.caseId,
          variant,
          repetition,
        });
        const prior = priorByKey.get(key);
        if (prior !== undefined && (prior.status === 'completed' || !input.retryUnfinished)) {
          trials.push(prior);
          continue;
        }
        const trial = await runTrial({
          ...input,
          service,
          caseId: loaded.case.caseId,
          targetRoot: variantRoot(input.pack, loaded.case, variant),
          contextRoot: contextRoot(input.pack, loaded.case),
          variant,
          repetition,
          answerKey: loaded.answerKey,
          reviewedPlan: loaded.reviewedPlan,
          planProfile,
        });
        trials.push(trial);
        await input.onTrialComplete?.(trial);
      }
    }
  }
  const pairedTrials = applyPairedPersistence(trials);
  const verificationMode = input.verificationMode ?? 'same-route';
  const verificationRouteFingerprint =
    input.verificationRouteFingerprint ??
    createVerificationRouteFingerprint({
      route: 'primary',
      provider: input.provider,
      model: input.model,
    });
  const evidenceQualification = deriveEvaluationEvidenceQualification({
    selectedSplit: input.split,
    readiness: assessCorpusReadiness(input.pack, input.startedAt, selectedCases),
    ...(input.holdoutAttestation === undefined
      ? {}
      : { holdoutAttestation: input.holdoutAttestation }),
  });
  const populationDigest = evaluationPopulationDigest({
    pack: input.pack,
    split: input.split,
    ...(input.caseIdFilter === undefined ? {} : { caseIdFilter: input.caseIdFilter }),
  });
  const benchmarkProtocolFingerprint = evaluationBenchmarkProtocolFingerprint({
    pack: input.pack,
    split: input.split,
    ...(input.caseIdFilter === undefined ? {} : { caseIdFilter: input.caseIdFilter }),
    mode: input.mode,
    provider: input.provider,
    model: input.model,
    verificationMode,
    verificationRouteFingerprint,
    repetitions: input.repetitions,
    planProfile,
    executionBudget: input.executionBudget,
    maxParallelVectors,
    promptProtocolFingerprint: input.promptProtocolFingerprint,
    semanticPlanEvaluator,
  });
  const reliability = summarizeReliability(pairedTrials, input.modelPricing ?? {}, planProfile);
  const safetyViolations = pairedTrials.filter(
    (trial) => trial.errorCode === 'safety-violation',
  ).length;
  const measurementState = deriveEvaluationMeasurementState({
    planProfile,
    trials: pairedTrials,
  });
  const diagnosticGatePassed =
    safetyViolations === 0 &&
    (planProfile === 'planning-generated'
      ? pairedTrials.every((trial) => {
          const score = trial.pathReachability;
          const semanticPlanMeasurement = trial.semanticPlanMeasurement;
          return (
            trial.status === 'completed' &&
            score !== null &&
            (score.eligibleScenarioCount === 0 ||
              (score.pathReachableScenarioCount === score.eligibleScenarioCount &&
                score.relevantPathCoverage === 1)) &&
            semanticPlanMeasurement?.status === 'completed' &&
            semanticPlanMeasurement.score.scenarioRecall === 1 &&
            semanticPlanMeasurement.score.relevantVectorPrecision === 1
          );
        })
      : pairedTrials.every((trial) => {
          if (trial.status === 'failed') return false;
          if (trial.variant === 'vulnerable') return trial.findingScore?.falseNegatives === 0;
          return trial.findingScore?.falsePositives === 0;
        }));
  const finishedAt = new Date().toISOString();
  return RealWorldEvaluationRunSchema.parse({
    schemaVersion: 15,
    runId: input.runId,
    packId: input.pack.manifest.packId,
    packVersion: input.pack.manifest.packVersion,
    corpusManifestDigest: input.pack.manifest.manifestDigest,
    populationDigest,
    benchmarkProtocolFingerprint,
    mode: input.mode,
    provider: input.provider,
    model: input.model,
    verificationMode,
    verificationRouteFingerprint,
    selectedSplit: input.split,
    ...(input.caseIdFilter === undefined ? {} : { caseIdFilter: input.caseIdFilter }),
    findingCoverage: findingCoverageFor(selectedCases),
    ...(input.holdoutAttestation === undefined
      ? {}
      : { holdoutAttestation: input.holdoutAttestation }),
    evidenceQualification,
    repetitions: input.repetitions,
    planProfile,
    semanticPlanEvaluator,
    executionBudget: input.executionBudget,
    maxParallelVectors,
    modelCostCeilingState: service.modelCostCeilingState(),
    promptProtocolFingerprint: input.promptProtocolFingerprint,
    startedAt: input.startedAt,
    finishedAt,
    selectedTrialPopulation,
    trials: pairedTrials,
    reliability,
    measurementState,
    safetyViolations,
    diagnosticGatePassed,
  });
}

export function selectedTrialPopulationForEvaluation(
  pack: LoadedCorpusPack,
  split: CorpusSplit,
  caseIdFilter: string | undefined,
  repetitions: number,
): EvaluationTrialIdentity[] {
  const selectedCases = selectCasesForEvaluation(pack, split, caseIdFilter);
  return selectedCases.flatMap((loaded) =>
    variantsFor(loaded.case.sourceDirectories).flatMap((variant) =>
      Array.from({ length: repetitions }, (_, index) => ({
        caseId: loaded.case.caseId,
        variant,
        repetition: index + 1,
      })),
    ),
  );
}

/** One evaluator-owned selection gate, run before any model service is constructed. */
export function selectCasesForEvaluation(
  pack: LoadedCorpusPack,
  split: CorpusSplit,
  caseIdFilter: string | undefined,
): readonly LoadedCorpusPack['cases'][number][] {
  const eligible = pack.cases.filter((entry) => entry.case.split === split);
  if (caseIdFilter === undefined) {
    if (eligible.length > 0) return eligible;
    throw new AuditRuntimeError(
      'invalid-input',
      'The selected evaluation split does not contain any cases.',
    );
  }
  const selected = eligible.find((entry) => entry.case.caseId === caseIdFilter);
  if (selected === undefined) {
    throw new AuditRuntimeError(
      'invalid-input',
      'The selected evaluation case does not exist in the selected split.',
    );
  }
  return [selected];
}

function findingCoverageFor(
  selectedCases: readonly LoadedCorpusPack['cases'][number][],
): FindingCoverageClass {
  const coverages = new Set(selectedCases.map((entry) => entry.answerKey.findingCoverage));
  if (coverages.size === 1 && coverages.has('targeted')) return 'targeted';
  if (coverages.size === 1 && coverages.has('exhaustive')) return 'exhaustive';
  return 'mixed';
}

function priorModelStages(trials: readonly EvaluationTrial[]): readonly ModelStageObservation[] {
  return trials.flatMap((trial) => trial.modelObservation?.stages ?? []);
}

async function runTrial(
  input: CorpusEvaluationInput & {
    service: ReturnType<typeof createReviewService>;
    caseId: string;
    targetRoot: string;
    contextRoot: string | undefined;
    variant: EvaluationTrial['variant'];
    repetition: number;
    answerKey: LoadedCorpusPack['cases'][number]['answerKey'];
    reviewedPlan: LoadedCorpusPack['cases'][number]['reviewedPlan'];
    planProfile: PlanEvaluationProfile;
  },
): Promise<EvaluationTrial> {
  const started = performance.now();
  const generatedPlan = input.planProfile !== 'audit-reviewed-plan';
  const reviewedPlanFingerprint = generatedPlan ? null : sha256(canonicalJson(input.reviewedPlan));
  const trialId = evaluationTrialId({
    runId: input.runId,
    caseId: input.caseId,
    variant: input.variant,
    repetition: input.repetition,
  });
  let planningObservation: ModelRunObservation | undefined;
  let auditObservation: ModelRunObservation | undefined;
  let auditProjection:
    | Pick<
        EvaluationTrial,
        | 'vectorCoverage'
        | 'findingKeys'
        | 'reviewRequiredKeys'
        | 'admissionFunnel'
        | 'hypothesisGroundingFunnel'
        | 'candidateIntegrityRejections'
      >
    | undefined;
  const evidenceMaps: AuditEvidenceMapDraft['evidenceMap'][] = [];
  const evidenceMapsByVector = new Map<string, AuditEvidenceMapDraft['evidenceMap']>();
  const groundedSourceEvidence: SourceEvidence[] = [];
  let expectedEvidenceRoleTraces: ExpectedEvidenceRoleTrace[] = [];
  let planKeys: string[] = [];
  let pathReachability: EvaluationTrial['pathReachability'] = null;
  try {
    const inspected =
      generatedPlan && input.planningCheckpoints !== undefined
        ? await input.service.inspectTarget({
            targetRoot: input.targetRoot,
            contextRoot: input.contextRoot,
            targetDisplayName: input.caseId,
          })
        : undefined;
    const reusablePlan =
      inspected === undefined
        ? undefined
        : await input.planningCheckpoints?.load({
            trialId,
            targetFingerprint: inspected.targetFingerprint,
            contextDigest: inspected.contextDigest,
          });
    input.service.recordPriorModelStages(reusablePlan?.modelObservation.stages ?? []);
    const created =
      reusablePlan === undefined && generatedPlan
        ? await input.service.createPlan({
            targetRoot: input.targetRoot,
            contextRoot: input.contextRoot,
            targetDisplayName: input.caseId,
            createdAt: input.startedAt,
            sessionId: `${trialId}-plan`,
          })
        : undefined;
    if (created !== undefined) {
      planningObservation = created.modelObservation;
    }
    if (created !== undefined && input.planningCheckpoints !== undefined) {
      await input.planningCheckpoints.save({
        trialId,
        targetFingerprint: created.inventory.targetFingerprint,
        contextDigest: created.inventory.contextDigest,
        plan: created.plan,
        modelObservation: created.modelObservation,
      });
    }
    planningObservation ??= reusablePlan?.modelObservation;
    const inventory =
      created?.inventory ??
      inspected ??
      (await input.service.inspectTarget({
        targetRoot: input.targetRoot,
        contextRoot: input.contextRoot,
        targetDisplayName: input.caseId,
      }));
    const draft =
      created?.plan ??
      reusablePlan?.plan ??
      createPlan({
        targetFingerprint: inventory.targetFingerprint,
        contextDigest: inventory.contextDigest,
        targetDisplayName: input.caseId,
        inventorySummary: inventory.summary,
        vectors: input.reviewedPlan.vectors,
        createdAt: input.startedAt,
      });
    expectedEvidenceRoleTraces = createExpectedEvidenceRoleTraces({
      answerKey: input.answerKey,
      plan: draft,
    });
    planKeys = generatedPlan ? [...normalizedPlanKeys(draft)] : [];
    pathReachability = generatedPlan ? scorePathReachability(input.answerKey, draft) : null;
    if (input.planProfile === 'planning-generated') {
      const semanticPlanMeasurement = await measureSemanticPlan({
        input,
        trialId,
        plan: draft,
        productClosed: true,
      });
      return {
        caseId: input.caseId,
        variant: input.variant,
        repetition: input.repetition,
        status: 'completed',
        reviewedPlanFingerprint,
        pathReachability,
        semanticPlanMeasurement,
        findingScore: null,
        planKeys,
        findingKeys: [],
        durationMs: Math.round(performance.now() - started),
        errorCode: null,
        modelCostCeilingState: input.service.modelCostCeilingState(),
        modelObservation: summarizeTrialModelObservation({
          planningObservation,
          auditObservation,
          semanticPlanMeasurement,
          modelPricing: input.modelPricing,
        }),
      };
    }
    const checkpointBinding = {
      runId: `${trialId}-audit`,
      planId: draft.planId,
      targetFingerprint: inventory.targetFingerprint,
      provider: input.provider,
      model: input.model,
      verificationRouteFingerprint:
        input.verificationRouteFingerprint ??
        createVerificationRouteFingerprint({
          route: 'primary',
          provider: input.provider,
          model: input.model,
        }),
      evidenceMapProtocolFingerprint,
      reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    };
    const expectedEvidenceTraceBinding = {
      trialId,
      planId: draft.planId,
      planDigest: draft.planDigest,
      targetFingerprint: inventory.targetFingerprint,
      contextDigest: inventory.contextDigest,
      provider: input.provider,
      model: input.model,
      verificationRouteFingerprint: checkpointBinding.verificationRouteFingerprint,
      promptProtocolFingerprint: input.promptProtocolFingerprint,
      answerKeyDigest: sha256(canonicalJson(input.answerKey)),
    };
    const persistedExpectedEvidenceTrace = await input.expectedEvidenceTraceCheckpoints?.load(
      expectedEvidenceTraceBinding,
    );
    if (persistedExpectedEvidenceTrace !== undefined) {
      expectedEvidenceRoleTraces = [...persistedExpectedEvidenceTrace];
    }
    const saveExpectedEvidenceTrace = async (): Promise<void> =>
      input.expectedEvidenceTraceCheckpoints?.save(
        expectedEvidenceTraceBinding,
        expectedEvidenceRoleTraces,
      );
    const reusable =
      input.auditCheckpoints === undefined
        ? undefined
        : await input.auditCheckpoints.load({
            binding: checkpointBinding,
            plan: draft,
            retryUnfinished: input.retryUnfinished ?? false,
          });
    if (reusable !== undefined) {
      for (const reusableMap of reusable.evidenceMapDrafts) {
        evidenceMaps.push(reusableMap.evidenceMap);
        evidenceMapsByVector.set(reusableMap.vectorId, reusableMap.evidenceMap);
        expectedEvidenceRoleTraces = traceMappedEvidence(
          expectedEvidenceRoleTraces,
          input.answerKey,
          reusableMap.evidenceMap,
        );
      }
      for (const reusablePosture of reusable.sourcePostureDrafts) {
        const evidenceMap = evidenceMapsByVector.get(reusablePosture.vectorId);
        if (evidenceMap !== undefined) {
          expectedEvidenceRoleTraces = tracePostureEvidence(
            expectedEvidenceRoleTraces,
            input.answerKey,
            evidenceMap,
            reusablePosture.sourcePosture,
          );
        }
      }
      groundedSourceEvidence.push(
        ...reusable.candidateGroundingDrafts.flatMap((draft) =>
          groundedHypotheses(draft.groundings).flatMap(claimEvidenceItems),
        ),
      );
      expectedEvidenceRoleTraces = traceGroundedEvidence(
        expectedEvidenceRoleTraces,
        input.answerKey,
        reusable.candidateGroundingDrafts.flatMap((draft) =>
          groundedHypotheses(draft.groundings).flatMap(claimEvidenceItems),
        ),
      );
      expectedEvidenceRoleTraces = traceVerifiedEvidence(
        expectedEvidenceRoleTraces,
        input.answerKey,
        reusable.candidateAwareCheckpoints.flatMap((checkpoint) =>
          checkpoint.phase === 'verification' && checkpoint.result?.decision === 'accepted'
            ? checkpoint.result.claimEvidenceBundles.flatMap((bundle) => bundle.evidence)
            : [],
        ),
      );
      input.service.recordPriorModelStages(evaluatorCheckpointModelStages(reusable));
    }
    await saveExpectedEvidenceTrace();
    const audited = await input.service.audit({
      targetRoot: input.targetRoot,
      contextRoot: input.contextRoot,
      targetDisplayName: input.caseId,
      plan: draft,
      runId: `${trialId}-audit`,
      generatedAt: input.startedAt,
      sessionId: `${trialId}-audit`,
      resumeState: createAuditResumeState({
        vectorResults: reusable?.vectorResults,
        candidateGroundingDrafts: reusable?.candidateGroundingDrafts,
        candidateAwareCheckpoints: reusable?.candidateAwareCheckpoints,
        evidenceMapDrafts: reusable?.evidenceMapDrafts,
        sourcePostureDrafts: reusable?.sourcePostureDrafts,
        contextOverflowLedgers: reusable?.contextOverflowLedgers,
        evidenceMapRecoveryLeaves: reusable?.evidenceMapRecoveryLeaves,
        sourcePostureRecoveryLeaves: reusable?.sourcePostureRecoveryLeaves,
        candidateGroundingRecoveryLeaves: reusable?.candidateGroundingRecoveryLeaves,
      }),
      retryUnfinished: input.retryUnfinished ?? false,
      onEvidenceMapDraft: async (checkpointDraft) => {
        evidenceMaps.push(checkpointDraft.evidenceMap);
        evidenceMapsByVector.set(checkpointDraft.vectorId, checkpointDraft.evidenceMap);
        await input.auditCheckpoints?.saveEvidenceMap({
          binding: checkpointBinding,
          plan: draft,
          draft: checkpointDraft,
        });
        expectedEvidenceRoleTraces = traceMappedEvidence(
          expectedEvidenceRoleTraces,
          input.answerKey,
          checkpointDraft.evidenceMap,
        );
        await saveExpectedEvidenceTrace();
      },
      onSourcePostureDraft: async (checkpointDraft) => {
        await input.auditCheckpoints?.saveSourcePosture({
          binding: checkpointBinding,
          plan: draft,
          draft: checkpointDraft,
        });
        const evidenceMap = evidenceMapsByVector.get(checkpointDraft.vectorId);
        if (evidenceMap !== undefined) {
          expectedEvidenceRoleTraces = tracePostureEvidence(
            expectedEvidenceRoleTraces,
            input.answerKey,
            evidenceMap,
            checkpointDraft.sourcePosture,
          );
        }
        await saveExpectedEvidenceTrace();
      },
      onVerifiedDiscoverySeed: async (update) => {
        const evidenceMap = evidenceMapsByVector.get(update.vectorId);
        if (evidenceMap !== undefined) {
          expectedEvidenceRoleTraces = traceDiscoveryEvidence(
            expectedEvidenceRoleTraces,
            input.answerKey,
            evidenceMap,
            update.evidenceMapFactIds,
          );
        }
        await saveExpectedEvidenceTrace();
      },
      onCandidateGroundingDraft: async (checkpointDraft) => {
        groundedSourceEvidence.push(
          ...groundedHypotheses(checkpointDraft.groundings).flatMap(claimEvidenceItems),
        );
        await input.auditCheckpoints?.saveCandidateGrounding({
          binding: checkpointBinding,
          plan: draft,
          draft: checkpointDraft,
        });
        expectedEvidenceRoleTraces = traceGroundedEvidence(
          expectedEvidenceRoleTraces,
          input.answerKey,
          groundedHypotheses(checkpointDraft.groundings).flatMap(claimEvidenceItems),
        );
        await saveExpectedEvidenceTrace();
      },
      onCandidateAwareCheckpoint: async (update) => {
        await input.auditCheckpoints?.saveCandidateAware({
          binding: checkpointBinding,
          plan: draft,
          update,
        });
        if (update.phase === 'verification' && update.state === 'completed') {
          expectedEvidenceRoleTraces = traceVerifiedEvidence(
            expectedEvidenceRoleTraces,
            input.answerKey,
            update.result?.decision === 'accepted'
              ? update.result.claimEvidenceBundles.flatMap((bundle) => bundle.evidence)
              : [],
          );
        }
        await saveExpectedEvidenceTrace();
      },
      onVectorResult: async (result) =>
        input.auditCheckpoints?.saveVectorResult({
          binding: checkpointBinding,
          plan: draft,
          result,
        }),
      onContextOverflowTransition: async (update) =>
        input.auditCheckpoints?.saveContextOverflowTransition({
          binding: checkpointBinding,
          plan: draft,
          update,
        }),
      onEvidenceMapRecoveryLeaf: async (update) =>
        input.auditCheckpoints?.saveEvidenceMapRecoveryLeaf({
          binding: checkpointBinding,
          plan: draft,
          update,
        }),
      onSourcePostureRecoveryLeaf: async (update) =>
        input.auditCheckpoints?.saveSourcePostureRecoveryLeaf({
          binding: checkpointBinding,
          plan: draft,
          update,
        }),
      onCandidateGroundingRecoveryLeaf: async (update) =>
        input.auditCheckpoints?.saveCandidateGroundingRecoveryLeaf({
          binding: checkpointBinding,
          plan: draft,
          update,
        }),
    });
    auditObservation = audited.modelObservation;
    expectedEvidenceRoleTraces = traceTerminalCoverage(
      expectedEvidenceRoleTraces,
      input.answerKey,
      draft,
      audited.report.coverage,
    );
    const terminalEvidenceMatches = terminalFindingEvidenceMatches(
      input.answerKey,
      audited.report.findings,
    );
    expectedEvidenceRoleTraces = traceTerminalFindingEvidence(
      expectedEvidenceRoleTraces,
      terminalEvidenceMatches,
    );
    await saveExpectedEvidenceTrace();
    auditProjection = {
      vectorCoverage: audited.report.coverage,
      findingKeys: normalizedFindingKeys(audited.report.findings, draft),
      reviewRequiredKeys: normalizedFindingKeys(audited.report.reviewRequired, draft),
      ...admissionFunnelForReport(audited.report.coverage),
      ...hypothesisGroundingFunnelForReport(audited.report.coverage),
      ...candidateIntegrityRejectionsForReport(audited.report.coverage),
    };
    const evidenceCoverage = stageEvidenceCoverage({
      answerKey: input.answerKey,
      evidenceMaps,
      groundedEvidence: groundedSourceEvidence,
      verifiedEvidence: [...audited.report.findings, ...audited.report.reviewRequired].flatMap(
        claimEvidenceItems,
      ),
      roleTraces: expectedEvidenceRoleTraces,
      terminalFindingEvidenceMatches: terminalEvidenceMatches,
    });
    const status = trialStatusFromCoverage(audited.report.coverage);
    const completed = status === 'completed';
    const semanticPlanMeasurement = await measureSemanticPlan({
      input,
      trialId,
      plan: draft,
      productClosed: status !== 'cancelled',
    });
    return {
      caseId: input.caseId,
      variant: input.variant,
      repetition: input.repetition,
      status,
      reviewedPlanFingerprint,
      pathReachability,
      semanticPlanMeasurement,
      findingScore: completed
        ? scoreFindings(
            input.answerKey,
            draft,
            audited.report.findings,
            input.variant,
            terminalEvidenceMatches,
          )
        : null,
      stageEvidenceCoverage: evidenceCoverage,
      reviewRequiredScore: completed
        ? scoreFindings(input.answerKey, draft, audited.report.reviewRequired, input.variant)
        : null,
      planKeys,
      durationMs: Math.round(performance.now() - started),
      errorCode: completed ? null : trialCoverageErrorCode(audited.report.coverage),
      modelCostCeilingState: input.service.modelCostCeilingState(),
      modelObservation: summarizeTrialModelObservation({
        planningObservation,
        auditObservation,
        semanticPlanMeasurement,
        modelPricing: input.modelPricing,
      }),
      ...(completed
        ? {}
        : {
            retainedUnscored: {
              acceptedFindingKeys: auditProjection.findingKeys,
              reviewRequiredFindingKeys: auditProjection.reviewRequiredKeys ?? [],
            },
          }),
      ...auditProjection,
    };
  } catch (error) {
    return {
      caseId: input.caseId,
      variant: input.variant,
      repetition: input.repetition,
      status: trialStatusFromError(error),
      reviewedPlanFingerprint,
      pathReachability,
      semanticPlanMeasurement: generatedPlan
        ? { status: 'not-reached', reason: 'product-not-closed' }
        : { status: 'not-applicable' },
      findingScore: null,
      reviewRequiredScore: null,
      stageEvidenceCoverage: stageEvidenceCoverage({
        answerKey: input.answerKey,
        evidenceMaps,
        groundedEvidence: groundedSourceEvidence,
        verifiedEvidence: [],
        roleTraces: expectedEvidenceRoleTraces,
      }),
      planKeys,
      findingKeys: auditProjection?.findingKeys ?? [],
      reviewRequiredKeys: auditProjection?.reviewRequiredKeys ?? [],
      durationMs: Math.round(performance.now() - started),
      errorCode: errorCode(error),
      modelCostCeilingState: input.service.modelCostCeilingState(),
      modelObservation: summarizeTrialModelObservation({
        planningObservation,
        auditObservation,
        semanticPlanMeasurement: undefined,
        modelPricing: input.modelPricing,
      }),
      ...(auditProjection === undefined
        ? {}
        : {
            retainedUnscored: {
              acceptedFindingKeys: auditProjection.findingKeys,
              reviewRequiredFindingKeys: auditProjection.reviewRequiredKeys ?? [],
            },
          }),
      ...(auditProjection ?? {}),
    };
  }
}

/** Single-owned evaluator-trial identity, shared with offline human adjudication. */
export function evaluationTrialId(input: {
  runId: string;
  caseId: string;
  variant: EvaluationTrial['variant'];
  repetition: number;
}): string {
  return createStableId(
    'evaluation-trial',
    `${input.runId}\0${input.caseId}\0${input.variant}\0${input.repetition}`,
  );
}

/**
 * Runs the evaluator-only semantic review only after the product stage has
 * closed. Its outcome is diagnostic metadata: it never changes audit terminal
 * state, finding scoring, or the release gate.
 */
async function measureSemanticPlan(input: {
  input: CorpusEvaluationInput & {
    service: ReturnType<typeof createReviewService>;
    caseId: string;
    variant: EvaluationTrial['variant'];
    repetition: number;
    answerKey: CorpusAnswerKey;
  };
  trialId: string;
  plan: AttackPlan;
  productClosed: boolean;
}): Promise<PlanSemanticMeasurement> {
  if (input.input.planProfile === 'audit-reviewed-plan') return { status: 'not-applicable' };
  if (!input.productClosed) return { status: 'not-reached', reason: 'product-cancelled' };
  const binding: PlanSemanticAdjudicationBinding = {
    runId: input.input.runId,
    trialId: input.trialId,
    packId: input.input.pack.manifest.packId,
    packVersion: input.input.pack.manifest.packVersion,
    caseId: input.input.caseId,
    variant: input.input.variant,
    repetition: input.input.repetition,
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    targetFingerprint: input.plan.targetFingerprint,
    contextDigest: input.plan.contextDigest,
    answerKeyScenarioDigest: answerKeyScenarioDigest(input.input.answerKey),
    reviewerProtocolFingerprint: planSemanticAgentProtocolFingerprint,
    reviewerRoute: 'primary',
  };
  const identity = {
    planDigest: binding.planDigest,
    answerKeyScenarioDigest: binding.answerKeyScenarioDigest,
    protocolFingerprint: binding.reviewerProtocolFingerprint,
    route: binding.reviewerRoute,
  };
  const evaluator = input.input.semanticPlanEvaluator;
  if (evaluator === undefined) {
    return { status: 'not-reached', reason: 'evaluator-not-configured', identity };
  }
  try {
    const operation = await evaluator.evaluate({
      binding,
      plan: input.plan,
      answerKey: input.input.answerKey,
      retryUnfinished: input.input.retryUnfinished ?? false,
      modelCostCeiling: input.input.service.modelCostCeiling(),
    });
    if (operation.status === 'completed') {
      return {
        status: 'completed',
        identity,
        score: operation.evaluation.score,
        modelObservation: operation.evaluation.modelObservation,
      };
    }
    return operation.status === 'cancelled'
      ? {
          status: 'cancelled',
          identity,
          errorCode: operation.errorCode,
          modelObservation: operation.modelObservation,
        }
      : {
          status: 'incomplete',
          identity,
          errorCode: operation.errorCode,
          modelObservation: operation.modelObservation,
        };
  } catch (error) {
    return {
      status: 'incomplete',
      identity,
      errorCode: errorCode(error),
      modelObservation: null,
    };
  }
}

/** Preserves every reached content-free model stage, including when a later evaluator step fails. */
function summarizeTrialModelObservation(input: {
  planningObservation: ModelRunObservation | undefined;
  auditObservation: ModelRunObservation | undefined;
  semanticPlanMeasurement: PlanSemanticMeasurement | undefined;
  modelPricing: ModelPricing | undefined;
}): ModelRunObservation | null {
  const stages = [
    ...(input.planningObservation?.stages ?? []),
    ...(input.auditObservation?.stages ?? []),
    ...(input.semanticPlanMeasurement?.status === 'completed'
      ? [input.semanticPlanMeasurement.modelObservation]
      : input.semanticPlanMeasurement?.status === 'incomplete' ||
          input.semanticPlanMeasurement?.status === 'cancelled'
        ? input.semanticPlanMeasurement.modelObservation === null
          ? []
          : [input.semanticPlanMeasurement.modelObservation]
        : []),
  ];
  return stages.length === 0 ? null : summarizeModelStages(stages, input.modelPricing ?? {});
}

function trialStatusFromCoverage(
  coverage: readonly { completed: boolean; outcome: string }[],
): EvaluationTrial['status'] {
  if (coverage.every((entry) => entry.completed)) return 'completed';
  if (coverage.some((entry) => entry.outcome === 'cancelled')) return 'cancelled';
  if (coverage.some((entry) => entry.outcome === 'failed')) return 'failed';
  return 'incomplete';
}

function trialCoverageErrorCode(
  coverage: readonly {
    completed: boolean;
    outcome: string;
    errorCode: string | null;
  }[],
): string {
  return (
    coverage.find((entry) => !entry.completed && entry.errorCode !== null)?.errorCode ??
    'audit-coverage-incomplete'
  );
}

function trialStatusFromError(error: unknown): EvaluationTrial['status'] {
  return error instanceof AuditRuntimeError && error.code === 'provider-cancelled'
    ? 'cancelled'
    : 'failed';
}

function admissionFunnelForReport(
  coverage: ReadonlyArray<{ admissionFunnel?: FindingAdmissionFunnel }>,
) {
  const funnels = coverage.flatMap((entry) =>
    entry.admissionFunnel === undefined ? [] : [entry.admissionFunnel],
  );
  return funnels.length === 0 ? {} : { admissionFunnel: aggregateFindingAdmissionFunnels(funnels) };
}

function hypothesisGroundingFunnelForReport(
  coverage: ReadonlyArray<{
    hypothesisGroundingFunnel?: HypothesisGroundingFunnel;
  }>,
) {
  const funnels = coverage.flatMap((entry) =>
    entry.hypothesisGroundingFunnel === undefined ? [] : [entry.hypothesisGroundingFunnel],
  );
  return funnels.length === 0
    ? {}
    : {
        hypothesisGroundingFunnel: aggregateHypothesisGroundingFunnels(funnels),
      };
}

function candidateIntegrityRejectionsForReport(
  coverage: ReadonlyArray<{
    candidateIntegrityRejections?: CandidateIntegrityRejectionLedger;
  }>,
) {
  const ledgers = coverage.flatMap((entry) =>
    entry.candidateIntegrityRejections === undefined ? [] : [entry.candidateIntegrityRejections],
  );
  return ledgers.length === 0
    ? {}
    : {
        candidateIntegrityRejections: aggregateCandidateIntegrityRejectionLedgers(ledgers),
      };
}

function variantsFor(sourceDirectories: {
  vulnerable: string;
  patched?: string;
  benign?: string;
}): EvaluationTrial['variant'][] {
  return [
    'vulnerable',
    ...(sourceDirectories.patched === undefined ? [] : (['patched'] as const)),
    ...(sourceDirectories.benign === undefined ? [] : (['benign'] as const)),
  ];
}

function trialKey(input: Pick<EvaluationTrial, 'caseId' | 'variant' | 'repetition'>): string {
  return `${input.caseId}\0${input.variant}\0${input.repetition}`;
}

function applyPairedPersistence(trials: readonly EvaluationTrial[]): EvaluationTrial[] {
  const vulnerableExpectedFindingIds = new Map<string, readonly string[]>();
  for (const trial of trials) {
    if (
      trial.variant === 'vulnerable' &&
      trial.status === 'completed' &&
      trial.findingScore !== null
    ) {
      vulnerableExpectedFindingIds.set(
        `${trial.caseId}\0${trial.repetition}`,
        trial.findingScore.matchedExpectedFindingIds,
      );
    }
  }
  return trials.map((trial) => {
    if (trial.variant !== 'patched' || trial.status !== 'completed' || trial.findingScore === null)
      return trial;
    const paired = vulnerableExpectedFindingIds.get(`${trial.caseId}\0${trial.repetition}`) ?? [];
    const persisted = trial.findingScore.matchedExpectedFindingIds.filter((identifier) =>
      paired.includes(identifier),
    ).length;
    return {
      ...trial,
      findingScore: {
        ...trial.findingScore,
        pairedPersistence: paired.length === 0 ? null : persisted / paired.length,
      },
    };
  });
}

function errorCode(error: unknown): string {
  return error instanceof AuditRuntimeError ? error.code : 'provider-failure';
}
