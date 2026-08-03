import type { ModelProvider } from '@purista/harness';
import {
  MaxParallelVectorsSchema,
  type VerificationMode,
} from '../../platform/configuration/environment.js';
import type { HarnessExecutionConfiguration } from '../../platform/harness/security-reviewer-harness.js';
import { canonicalJson, createStableId, sha256 } from '../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { createPlan } from '../attack-planning/plan.js';
import type { AttackPlan } from '../attack-planning/plan.schema.js';
import {
  aggregateCandidateIntegrityRejectionLedgers,
  aggregateFindingAdmissionFunnels,
  aggregateHypothesisGroundingFunnels,
} from '../audit-execution/admission/funnel.js';
import type {
  AuditCandidateGroundingRecoveryLeafUpdate,
  AuditContextOverflowTransition,
  AuditEvidenceMapRecoveryLeafUpdate,
  AuditSourcePostureRecoveryLeafUpdate,
  CandidateAwareCheckpointUpdate,
} from '../audit-execution/audit.js';
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
} from '../audit-execution/audit.schema.js';
import {
  type AuditCheckpointBaseBinding,
  createAuditResumeState,
} from '../audit-execution/checkpoints.js';
import {
  type ModelPricing,
  type ModelRunObservation,
  type ModelStageObservation,
  summarizeModelStages,
} from '../model-operations/model-operations.js';
import {
  evidenceMapProtocolFingerprint,
  reviewWorkflowPromptProtocolFingerprint,
} from '../review-workflow/prompt-protocol.js';
import {
  createVerificationRouteFingerprint,
  type ResolvedVerificationRoute,
} from '../review-workflow/runtime/verification-route.js';
import { createReviewService } from '../review-workflow/service.js';
import { contextRoot, type LoadedCorpusPack, variantRoot } from './corpus.js';
import {
  type CorpusSplit,
  type EvaluationGeneratedPlanCheckpoint,
  type EvaluationMeasurementScope,
  type EvaluationTrial,
  type FindingCoverageClass,
  type PlanEvaluationProfile,
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
import type { HoldoutAttestationReference } from './holdout-attestation.schema.js';
import { evaluatorCheckpointModelStages } from './real-world-artifacts.js';
import {
  normalizedFindingKeys,
  normalizedPlanKeys,
  scoreFindings,
  scorePlan,
  summarizeReliability,
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
  measurementScope?: EvaluationMeasurementScope;
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
    draft: Pick<AuditEvidenceMapDraft, 'vectorId' | 'evidenceMap' | 'modelObservation'>;
  }) => Promise<void>;
  saveSourcePosture: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    draft: Pick<AuditSourcePostureDraft, 'vectorId' | 'sourcePosture' | 'modelObservation'>;
  }) => Promise<void>;
  saveCandidateGrounding: (input: {
    binding: AuditCheckpointBaseBinding;
    plan: AttackPlan;
    draft: Pick<
      AuditCandidateGroundingDraft,
      | 'vectorId'
      | 'findings'
      | 'closures'
      | 'hypothesisGroundingFunnel'
      | 'candidateIntegrityRejections'
      | 'discoveryObservation'
      | 'modelObservation'
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

/** Evaluator-private generated-plan recovery; reviewed plans are never persisted here. */
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

/** Executes the normal plan/audit flow against an isolated corpus variant. */
export async function runCorpusEvaluation(
  input: CorpusEvaluationInput,
): Promise<RealWorldEvaluationRun> {
  const maxParallelVectors = MaxParallelVectorsSchema.parse(input.maxParallelVectors);
  const selectedCases = selectCasesForEvaluation(input.pack, input.split, input.caseIdFilter);
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
    ...(input.independentVerifierRoute === undefined
      ? {}
      : { independentVerifierRoute: input.independentVerifierRoute }),
  });
  const priorByKey = new Map(
    (input.priorTrials ?? []).map((trial) => [trialKey(trial), trial] as const),
  );
  const trials: EvaluationTrial[] = [];
  const measurementScope = input.measurementScope ?? 'full-workflow';
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
          measurementScope,
        });
        trials.push(trial);
        await input.onTrialComplete?.(trial);
      }
    }
  }
  const pairedTrials = applyPairedPersistence(trials);
  const planProfile = input.planProfile ?? 'generated-plan';
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
    readiness: assessCorpusReadiness(input.pack, input.startedAt),
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
    measurementScope,
    executionBudget: input.executionBudget,
    maxParallelVectors,
    promptProtocolFingerprint: input.promptProtocolFingerprint,
  });
  const reliability = summarizeReliability(
    pairedTrials,
    input.modelPricing ?? {},
    planProfile,
    measurementScope,
  );
  const safetyViolations = pairedTrials.filter(
    (trial) => trial.errorCode === 'safety-violation',
  ).length;
  const gatePassed =
    safetyViolations === 0 &&
    (measurementScope === 'planning-only'
      ? pairedTrials.every((trial) => {
          const score = trial.planScore;
          return (
            trial.status === 'completed' &&
            score !== null &&
            (score.expectedScenarioCount === 0 ||
              (score.scopedScenarioCount === score.expectedScenarioCount &&
                score.relevantPathCoverage === 1))
          );
        })
      : pairedTrials.every((trial) => {
          if (trial.status === 'failed') return false;
          if (trial.variant === 'vulnerable') return trial.findingScore?.falseNegatives === 0;
          return trial.findingScore?.falsePositives === 0;
        }));
  const finishedAt = new Date().toISOString();
  return RealWorldEvaluationRunSchema.parse({
    schemaVersion: 5,
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
    measurementScope,
    executionBudget: input.executionBudget,
    maxParallelVectors,
    promptProtocolFingerprint: input.promptProtocolFingerprint,
    startedAt: input.startedAt,
    finishedAt,
    trials: pairedTrials,
    reliability,
    safetyViolations,
    gatePassed,
  });
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
    throw new SecurityReviewerError(
      'invalid-input',
      'The selected evaluation split does not contain any cases.',
    );
  }
  const selected = eligible.find((entry) => entry.case.caseId === caseIdFilter);
  if (selected === undefined) {
    throw new SecurityReviewerError(
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
    measurementScope: EvaluationMeasurementScope;
  },
): Promise<EvaluationTrial> {
  const started = performance.now();
  const generatedPlan = (input.planProfile ?? 'generated-plan') === 'generated-plan';
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
  const groundedSourceEvidence: AuditCandidateGroundingDraft['findings'][number]['evidence'][number][] =
    [];
  let planKeys: string[] = [];
  let planScore: EvaluationTrial['planScore'] = null;
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
    planKeys = generatedPlan ? [...normalizedPlanKeys(draft)] : [];
    planScore = generatedPlan ? scorePlan(input.answerKey, draft) : null;
    if (input.measurementScope === 'planning-only') {
      return {
        caseId: input.caseId,
        variant: input.variant,
        repetition: input.repetition,
        status: 'completed',
        reviewedPlanFingerprint,
        planScore,
        findingScore: null,
        planKeys,
        findingKeys: [],
        durationMs: Math.round(performance.now() - started),
        errorCode: null,
        modelObservation: summarizeTrialModelObservation({
          planningObservation,
          auditObservation,
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
    const reusable =
      input.auditCheckpoints === undefined
        ? undefined
        : await input.auditCheckpoints.load({
            binding: checkpointBinding,
            plan: draft,
            retryUnfinished: input.retryUnfinished ?? false,
          });
    if (reusable !== undefined) {
      evidenceMaps.push(...reusable.evidenceMapDrafts.map((draft) => draft.evidenceMap));
      groundedSourceEvidence.push(
        ...reusable.candidateGroundingDrafts.flatMap((draft) =>
          draft.findings.flatMap((finding) => finding.evidence),
        ),
      );
      input.service.recordPriorModelStages(evaluatorCheckpointModelStages(reusable));
    }
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
        await input.auditCheckpoints?.saveEvidenceMap({
          binding: checkpointBinding,
          plan: draft,
          draft: checkpointDraft,
        });
      },
      onSourcePostureDraft: async (checkpointDraft) =>
        input.auditCheckpoints?.saveSourcePosture({
          binding: checkpointBinding,
          plan: draft,
          draft: checkpointDraft,
        }),
      onCandidateGroundingDraft: async (checkpointDraft) => {
        groundedSourceEvidence.push(
          ...checkpointDraft.findings.flatMap((finding) => finding.evidence),
        );
        await input.auditCheckpoints?.saveCandidateGrounding({
          binding: checkpointBinding,
          plan: draft,
          draft: checkpointDraft,
        });
      },
      onCandidateAwareCheckpoint: async (update) =>
        input.auditCheckpoints?.saveCandidateAware({
          binding: checkpointBinding,
          plan: draft,
          update,
        }),
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
        (finding) => finding.evidence,
      ),
    });
    const status = trialStatusFromCoverage(audited.report.coverage);
    const completed = status === 'completed';
    return {
      caseId: input.caseId,
      variant: input.variant,
      repetition: input.repetition,
      status,
      reviewedPlanFingerprint,
      planScore,
      findingScore: completed
        ? scoreFindings(input.answerKey, draft, audited.report.findings, input.variant)
        : null,
      stageEvidenceCoverage: evidenceCoverage,
      reviewRequiredScore: completed
        ? scoreFindings(input.answerKey, draft, audited.report.reviewRequired, input.variant)
        : null,
      planKeys,
      durationMs: Math.round(performance.now() - started),
      errorCode: completed ? null : trialCoverageErrorCode(audited.report.coverage),
      modelObservation: summarizeTrialModelObservation({
        planningObservation,
        auditObservation,
        modelPricing: input.modelPricing,
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
      planScore,
      findingScore: null,
      reviewRequiredScore: null,
      stageEvidenceCoverage: stageEvidenceCoverage({
        answerKey: input.answerKey,
        evidenceMaps,
        groundedEvidence: groundedSourceEvidence,
        verifiedEvidence: [],
      }),
      planKeys,
      findingKeys: auditProjection?.findingKeys ?? [],
      reviewRequiredKeys: auditProjection?.reviewRequiredKeys ?? [],
      durationMs: Math.round(performance.now() - started),
      errorCode: errorCode(error),
      modelObservation: summarizeTrialModelObservation({
        planningObservation,
        auditObservation,
        modelPricing: input.modelPricing,
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

/** Preserves every reached content-free model stage, including when a later evaluator step fails. */
function summarizeTrialModelObservation(input: {
  planningObservation: ModelRunObservation | undefined;
  auditObservation: ModelRunObservation | undefined;
  modelPricing: ModelPricing | undefined;
}): ModelRunObservation | null {
  const stages = [
    ...(input.planningObservation?.stages ?? []),
    ...(input.auditObservation?.stages ?? []),
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
  return error instanceof SecurityReviewerError && error.code === 'provider-cancelled'
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
  const vulnerableKeys = new Map<string, readonly string[]>();
  for (const trial of trials) {
    if (trial.variant === 'vulnerable' && trial.status === 'completed') {
      vulnerableKeys.set(`${trial.caseId}\0${trial.repetition}`, trial.findingKeys);
    }
  }
  return trials.map((trial) => {
    if (trial.variant !== 'patched' || trial.status !== 'completed' || trial.findingScore === null)
      return trial;
    const paired = vulnerableKeys.get(`${trial.caseId}\0${trial.repetition}`) ?? [];
    const persisted = trial.findingKeys.filter((key) => paired.includes(key)).length;
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
  return error instanceof SecurityReviewerError ? error.code : 'provider-failure';
}
