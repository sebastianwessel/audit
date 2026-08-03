import type { ModelProvider } from '@purista/harness';
import { MaxParallelVectorsSchema } from '../../platform/configuration/environment.js';
import {
  createJailedReadOnlyFilesystem,
  type JailedReadOnlyFilesystem,
} from '../../platform/filesystem/index.js';
import {
  type HarnessExecutionConfiguration,
  HarnessExecutionConfigurationSchema,
} from '../../platform/harness/security-reviewer-harness.js';
import {
  SecurityReviewerError,
  SecurityReviewerErrorCodeSchema,
} from '../../shared/errors/security-reviewer-error.js';
import { assertPlanIsSealed, createPlan } from '../attack-planning/plan.js';
import type { AttackPlan } from '../attack-planning/plan.schema.js';
import {
  type AuditCandidateGroundingRecoveryLeafUpdate,
  type AuditContextOverflowTransition,
  type AuditEvidenceMapRecoveryLeafUpdate,
  type AuditScopedStageContext,
  type AuditSourcePostureRecoveryLeafUpdate,
  type AuditVerifiedDiscoverySeedUpdate,
  type CandidateAwareCheckpointUpdate,
  runAudit,
} from '../audit-execution/audit.js';
import type {
  AuditCandidateGroundingDraft,
  AuditEvidenceMapDraft,
  AuditReport,
  AuditSourcePostureDraft,
  AuditVectorResult,
} from '../audit-execution/audit.schema.js';
import type { AuditResumeState } from '../audit-execution/checkpoints.js';
import {
  createModelCostCeiling,
  type ModelCostCeilingState,
  type ModelCostCeilingUsd,
  type ModelPricing,
  type ModelRunObservation,
  type ModelStageObservation,
  summarizeModelStages,
} from '../model-operations/model-operations.js';
import {
  captureTargetInventory,
  inventoryTarget,
  type TargetInventoryCapture,
} from '../target-inventory/inventory.js';
import type { TargetInventory } from '../target-inventory/inventory.schema.js';
import {
  type ContextOverflowTopology,
  contextOverflowRecoveryProtocolFingerprint,
  contextRecoveryRootScopeFingerprint,
} from './runtime/context-overflow.js';
import { selectApplicableContext } from './runtime/source-tools.js';
import type { ResolvedVerificationRoute } from './runtime/verification-route.js';
import { runCandidateGroundingStage } from './stages/candidate-grounding.js';
import { runEvidenceMapStage } from './stages/evidence-map.js';
import { runInvestigationStage } from './stages/investigation.js';
import { runPlanningStage } from './stages/planning.js';
import { runSourcePostureStage } from './stages/source-posture.js';
import { runVerificationStage } from './stages/verification.js';

export type ReviewService = Readonly<{
  inspectTarget: (input: ReviewTargetInput) => Promise<TargetInventory>;
  recordPriorModelStages: (stages: readonly ModelStageObservation[]) => void;
  /** Current source-free run-wide dispatch-guard state, including disabled state. */
  modelCostCeilingState: () => ModelCostCeilingState;
  createPlan: (input: ReviewTargetInput & { createdAt: string; sessionId: string }) => Promise<{
    inventory: TargetInventory;
    plan: AttackPlan;
    modelObservation: ModelRunObservation;
    modelCostCeilingState?: ModelCostCeilingState;
  }>;
  audit: (
    input: ReviewTargetInput & {
      plan: AttackPlan;
      runId: string;
      generatedAt: string;
      sessionId: string;
      resumeState?: AuditResumeState;
      retryUnfinished?: boolean;
      retainedSnapshot?: TargetInventoryCapture;
      onSnapshotCaptured?: (capture: TargetInventoryCapture) => Promise<void>;
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
      onVerifiedDiscoverySeed?: (update: AuditVerifiedDiscoverySeedUpdate) => Promise<void>;
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
    },
  ) => Promise<{
    inventory: TargetInventory;
    report: AuditReport;
    modelObservation: ModelRunObservation;
    modelCostCeilingState?: ModelCostCeilingState;
  }>;
}>;

export type ReviewTargetInput = Readonly<{
  targetRoot: string;
  contextRoot?: string;
  targetDisplayName: string;
}>;

export type ReviewServiceOptions = Readonly<{
  maxParallelVectors?: number;
  harnessExecution?: HarnessExecutionConfiguration;
  modelPricing?: ModelPricing;
  modelCacheRoutingKey?: string;
  independentVerifierRoute?: ResolvedVerificationRoute;
  maxEstimatedCostUsd?: ModelCostCeilingUsd;
  priorModelStages?: readonly ModelStageObservation[];
}>;

export function createReviewService(
  modelProvider: ModelProvider,
  modelName?: string,
  options: ReviewServiceOptions = {},
): ReviewService {
  const maxParallelVectors = MaxParallelVectorsSchema.parse(options.maxParallelVectors ?? 1);
  const harnessExecution = HarnessExecutionConfigurationSchema.parse(
    options.harnessExecution ?? {},
  );
  const modelPricing: ModelPricing = options.modelPricing ?? {};
  const modelCostCeiling =
    options.maxEstimatedCostUsd === undefined
      ? undefined
      : createModelCostCeiling({
          configuredUsd: options.maxEstimatedCostUsd,
          pricing: modelPricing,
          priorStages: options.priorModelStages,
        });
  if (modelCostCeiling !== undefined && maxParallelVectors !== 1) {
    throw new SecurityReviewerError(
      'invalid-input',
      'A model-cost ceiling requires maxParallelVectors to be 1.',
    );
  }
  const cacheRoutingEnabled = options.modelCacheRoutingKey !== undefined;
  const verificationRoute = options.independentVerifierRoute;
  return Object.freeze({
    inspectTarget: async (input) => inventoryTarget(await createFilesystem(input)),
    recordPriorModelStages: (stages) => modelCostCeiling?.recordPriorStages(stages),
    modelCostCeilingState: () =>
      modelCostCeiling?.state() ?? {
        configuredUsd: null,
        accumulatedEstimatedCostUsd: null,
        reached: false,
      },
    createPlan: async (input) => {
      const { inventory, snapshot: sourceSnapshot } = await captureTargetInventory(
        await createFilesystem(input),
      );
      const planning = await runPlanningStage({
        modelProvider,
        filesystem: sourceSnapshot,
        request: {
          targetFingerprint: inventory.targetFingerprint,
          contextDigest: inventory.contextDigest,
          targetDisplayName: input.targetDisplayName,
          inventorySummary: inventory.summary,
          sourcePaths: inventory.sourcePaths,
          context: inventory.context,
          createdAt: input.createdAt,
        },
        sessionId: input.sessionId,
        modelName,
        harnessExecution,
        modelCacheRoutingKey: options.modelCacheRoutingKey,
        modelPricing,
        modelCostCeiling,
        cacheRoutingEnabled,
      });
      if (planning.status === 'failed') {
        const stableErrorCode = SecurityReviewerErrorCodeSchema.safeParse(planning.errorCode);
        throw new SecurityReviewerError(
          stableErrorCode.success ? stableErrorCode.data : 'provider-failure',
          'The planning model stage did not complete.',
        );
      }
      const plan = createPlan({
        targetFingerprint: inventory.targetFingerprint,
        contextDigest: inventory.contextDigest,
        targetDisplayName: input.targetDisplayName,
        inventorySummary: inventory.summary,
        vectors: planning.output.vectors,
        additionalObservations: planning.output.additionalObservations,
        createdAt: input.createdAt,
      });
      return {
        inventory,
        plan,
        modelObservation: summarizeModelStages([planning.modelObservation], modelPricing),
        ...(modelCostCeiling === undefined
          ? {}
          : { modelCostCeilingState: modelCostCeiling.state() }),
      };
    },
    audit: async (input) => {
      assertPlanIsSealed(input.plan);
      const capture =
        input.retainedSnapshot ?? (await captureTargetInventory(await createFilesystem(input)));
      if (input.retainedSnapshot === undefined) await input.onSnapshotCaptured?.(capture);
      const { inventory, snapshot: sourceSnapshot } = capture;
      const report = await runAudit({
        plan: input.plan,
        targetFingerprint: inventory.targetFingerprint,
        contextDigest: inventory.contextDigest,
        sources: sourceSnapshot.documents(),
        runId: input.runId,
        generatedAt: input.generatedAt,
        maxParallelVectors,
        resumeState: input.resumeState,
        retryUnfinished: input.retryUnfinished,
        onEvidenceMapDraft: input.onEvidenceMapDraft,
        onCandidateGroundingDraft: input.onCandidateGroundingDraft,
        onVerifiedDiscoverySeed: input.onVerifiedDiscoverySeed,
        onCandidateAwareCheckpoint: input.onCandidateAwareCheckpoint,
        onSourcePostureDraft: input.onSourcePostureDraft,
        onContextOverflowTransition: input.onContextOverflowTransition,
        onEvidenceMapRecoveryLeaf: input.onEvidenceMapRecoveryLeaf,
        onSourcePostureRecoveryLeaf: input.onSourcePostureRecoveryLeaf,
        onCandidateGroundingRecoveryLeaf: input.onCandidateGroundingRecoveryLeaf,
        onVectorResult: input.onVectorResult,
        mapEvidence: async (request, stageContext) => {
          const context = selectApplicableContext(inventory.context, request.availableSourcePaths);
          const recovery = overflowTopologyForStage({
            stageContext,
            phase: 'evidence-mapping',
            vectorId: request.vector.vectorId,
            sourcePaths: request.availableSourcePaths,
            context,
          });
          const evidenceMapRecovery =
            'overflowTopology' in recovery
              ? {
                  overflowTopology: {
                    ...recovery.overflowTopology,
                    ...(stageContext?.priorEvidenceMapRecoveryLeaves === undefined
                      ? {}
                      : {
                          priorRecoveredLeaves: stageContext.priorEvidenceMapRecoveryLeaves.map(
                            (leaf) => ({
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              output: leaf.evidenceMap,
                            }),
                          ),
                        }),
                    ...(stageContext?.onEvidenceMapRecoveryLeaf === undefined
                      ? {}
                      : {
                          onRecoveredLeafCompleted: async (leaf: {
                            childKey: string;
                            scopeFingerprint: string;
                            output: import('../audit-execution/evidence-map/contract.js').EvidenceMap;
                          }) =>
                            stageContext.onEvidenceMapRecoveryLeaf?.({
                              vectorId: request.vector.vectorId,
                              parentStageId: request.vector.vectorId,
                              recoveryProtocolFingerprint:
                                contextOverflowRecoveryProtocolFingerprint,
                              rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                                sourcePaths: request.availableSourcePaths,
                                context,
                              }),
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              evidenceMap: leaf.output,
                            }),
                        }),
                  },
                }
              : recovery;
          const result = await runEvidenceMapStage({
            modelProvider,
            filesystem: sourceSnapshot,
            request,
            sources: sourceSnapshot
              .documents()
              .filter((source) => request.availableSourcePaths.includes(source.path)),
            context,
            sessionId: `${input.sessionId}-${request.vector.vectorId}-evidence-map`,
            modelName,
            harnessExecution,
            modelCacheRoutingKey: options.modelCacheRoutingKey,
            modelPricing,
            modelCostCeiling,
            cacheRoutingEnabled,
            ...evidenceMapRecovery,
          });
          return result.status === 'completed'
            ? { evidenceMap: result.output, modelObservation: result.modelObservation }
            : {
                evidenceMap: {
                  facts: [],
                  controlCoverage: [],
                  unansweredPlanObligations: [],
                  limitations: [],
                },
                modelObservation: result.modelObservation,
              };
        },
        assessSourcePosture: async (request, stageContext) => {
          const context = selectApplicableContext(inventory.context, request.availableSourcePaths);
          const recovery = overflowTopologyForStage({
            stageContext,
            phase: 'source-posture',
            vectorId: request.vector.vectorId,
            sourcePaths: request.availableSourcePaths,
            context,
          });
          const sourcePostureRecovery =
            'overflowTopology' in recovery
              ? {
                  overflowTopology: {
                    ...recovery.overflowTopology,
                    ...(stageContext?.priorSourcePostureRecoveryLeaves === undefined
                      ? {}
                      : {
                          priorRecoveredLeaves: stageContext.priorSourcePostureRecoveryLeaves.map(
                            (leaf) => ({
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              output: leaf.sourcePosture,
                            }),
                          ),
                        }),
                    ...(stageContext?.onSourcePostureRecoveryLeaf === undefined
                      ? {}
                      : {
                          onRecoveredLeafCompleted: async (leaf: {
                            childKey: string;
                            scopeFingerprint: string;
                            output: import('../audit-execution/source-posture/contract.js').SourcePosture;
                          }) =>
                            stageContext.onSourcePostureRecoveryLeaf?.({
                              vectorId: request.vector.vectorId,
                              parentStageId: request.vector.vectorId,
                              recoveryProtocolFingerprint:
                                contextOverflowRecoveryProtocolFingerprint,
                              rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                                sourcePaths: request.availableSourcePaths,
                                context,
                              }),
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              sourcePosture: leaf.output,
                            }),
                        }),
                  },
                }
              : recovery;
          const result = await runSourcePostureStage({
            modelProvider,
            filesystem: sourceSnapshot,
            request,
            context,
            sessionId: `${input.sessionId}-${request.vector.vectorId}-source-posture`,
            modelName,
            harnessExecution,
            modelCacheRoutingKey: options.modelCacheRoutingKey,
            modelPricing,
            modelCostCeiling,
            cacheRoutingEnabled,
            ...sourcePostureRecovery,
          });
          return result.status === 'completed'
            ? { sourcePosture: result.output, modelObservation: result.modelObservation }
            : {
                sourcePosture: {
                  assessments: [],
                  limitations: ['The candidate-blind source posture did not complete.'],
                },
                modelObservation: result.modelObservation,
              };
        },
        investigate: (request, stageContext) => {
          const context = selectApplicableContext(inventory.context, request.availableSourcePaths);
          return runInvestigationStage({
            modelProvider,
            filesystem: sourceSnapshot,
            request,
            context,
            sessionId: `${input.sessionId}-${request.vector.vectorId}`,
            modelName,
            harnessExecution,
            modelCacheRoutingKey: options.modelCacheRoutingKey,
            modelPricing,
            modelCostCeiling,
            cacheRoutingEnabled,
            ...overflowTopologyForStage({
              stageContext,
              phase: 'investigation',
              vectorId: request.vector.vectorId,
              sourcePaths: request.availableSourcePaths,
              context,
            }),
          });
        },
        groundCandidates: async (request, stageContext) => {
          const context = selectApplicableContext(inventory.context, request.availableSourcePaths);
          const recovery = overflowTopologyForStage({
            stageContext,
            phase: 'candidate-grounding',
            vectorId: request.vector.vectorId,
            sourcePaths: request.availableSourcePaths,
            context,
          });
          const candidateGroundingRecovery =
            'overflowTopology' in recovery
              ? {
                  overflowTopology: {
                    ...recovery.overflowTopology,
                    ...(stageContext?.priorCandidateGroundingRecoveryLeaves === undefined
                      ? {}
                      : {
                          priorRecoveredLeaves:
                            stageContext.priorCandidateGroundingRecoveryLeaves.map((leaf) => ({
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              output: leaf.groundings,
                            })),
                        }),
                    ...(stageContext?.onCandidateGroundingRecoveryLeaf === undefined
                      ? {}
                      : {
                          onRecoveredLeafCompleted: async (leaf: {
                            childKey: string;
                            scopeFingerprint: string;
                            output: import('../audit-execution/candidate-grounding/contract.js').CanonicalCandidateGroundingOutput;
                          }) =>
                            stageContext.onCandidateGroundingRecoveryLeaf?.({
                              vectorId: request.vector.vectorId,
                              parentStageId: request.vector.vectorId,
                              recoveryProtocolFingerprint:
                                contextOverflowRecoveryProtocolFingerprint,
                              rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                                sourcePaths: request.availableSourcePaths,
                                context,
                              }),
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              groundings: leaf.output,
                            }),
                        }),
                  },
                }
              : recovery;
          const result = await runCandidateGroundingStage({
            modelProvider,
            filesystem: sourceSnapshot,
            request,
            sources: sourceSnapshot
              .documents()
              .filter((source) => request.availableSourcePaths.includes(source.path)),
            context,
            sessionId: `${input.sessionId}-${request.vector.vectorId}-candidate-grounding`,
            modelName,
            harnessExecution,
            modelCacheRoutingKey: options.modelCacheRoutingKey,
            modelPricing,
            modelCostCeiling,
            cacheRoutingEnabled,
            ...candidateGroundingRecovery,
          });
          return result.status === 'completed'
            ? { groundings: result.output, modelObservation: result.modelObservation }
            : { groundings: { groundings: [] }, modelObservation: result.modelObservation };
        },
        verify: (request, candidateContext) => {
          const context = selectApplicableContext(inventory.context, request.availableSourcePaths);
          const overflowTopology =
            candidateContext === undefined
              ? undefined
              : {
                  ...(candidateContext.priorContextOverflowTopology === undefined
                    ? {}
                    : { prior: candidateContext.priorContextOverflowTopology }),
                  onTransition: async (event: ContextOverflowTopology['events'][number]) =>
                    candidateContext.onContextOverflowTransition?.({
                      recoveryProtocolFingerprint: contextOverflowRecoveryProtocolFingerprint,
                      rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                        sourcePaths: request.availableSourcePaths,
                        context,
                      }),
                      event,
                    }),
                };
          return runVerificationStage({
            modelProvider: verificationRoute?.modelProvider ?? modelProvider,
            filesystem: sourceSnapshot,
            request,
            context,
            sessionId: `${input.sessionId}-${request.verificationId}`,
            modelName: verificationRoute?.modelName ?? modelName,
            harnessExecution,
            modelCacheRoutingKey:
              verificationRoute?.modelCacheRoutingKey ?? options.modelCacheRoutingKey,
            modelPricing: verificationRoute?.modelPricing ?? modelPricing,
            modelCostCeiling,
            cacheRoutingEnabled: verificationRoute?.cacheRoutingEnabled ?? cacheRoutingEnabled,
            route: verificationRoute?.route ?? 'primary',
            ...(overflowTopology === undefined ? {} : { overflowTopology }),
          });
        },
      });
      const modelStages = modelStagesForAudit(report.coverage);
      return {
        inventory,
        report,
        modelObservation: summarizeModelStages(modelStages, modelPricing),
        ...(modelCostCeiling === undefined
          ? {}
          : { modelCostCeilingState: modelCostCeiling.state() }),
      };
    },
  });
}

function overflowTopologyForStage(input: {
  stageContext: AuditScopedStageContext | undefined;
  phase: AuditContextOverflowTransition['phase'];
  vectorId: string;
  sourcePaths: readonly string[];
  context: Parameters<typeof contextRecoveryRootScopeFingerprint>[0]['context'];
}):
  | Readonly<{
      overflowTopology: Readonly<{
        prior?: ContextOverflowTopology;
        onTransition: (event: ContextOverflowTopology['events'][number]) => Promise<void>;
      }>;
    }>
  | Record<string, never> {
  const stageContext = input.stageContext;
  if (stageContext === undefined) return {};
  const rootScopeFingerprint = contextRecoveryRootScopeFingerprint({
    sourcePaths: input.sourcePaths,
    context: input.context,
  });
  const prior = stageContext.priorContextOverflowLedger;
  if (
    prior !== undefined &&
    (prior.vectorId !== input.vectorId ||
      prior.phase !== input.phase ||
      prior.parentStageId !== input.vectorId)
  ) {
    throw new SecurityReviewerError(
      'artifact-invalid',
      'The persisted context-overflow topology is bound to a different audit stage.',
    );
  }
  return {
    overflowTopology: {
      ...(prior === undefined
        ? {}
        : {
            prior: {
              recoveryProtocolFingerprint: prior.recoveryProtocolFingerprint,
              rootScopeFingerprint: prior.rootScopeFingerprint,
              events: prior.events.map(
                ({ childKey, attempt, scopeFingerprint, state, errorCode, modelObservation }) => ({
                  childKey,
                  attempt,
                  scopeFingerprint,
                  state,
                  errorCode,
                  ...(modelObservation === undefined ? {} : { modelObservation }),
                }),
              ),
            },
          }),
      onTransition: async (event) => {
        await stageContext.onContextOverflowTransition?.({
          vectorId: input.vectorId,
          phase: input.phase,
          parentStageId: input.vectorId,
          recoveryProtocolFingerprint: contextOverflowRecoveryProtocolFingerprint,
          rootScopeFingerprint,
          event,
        });
      },
    },
  };
}

/**
 * Builds the run ledger only from independently retained stage observations.
 * Countercheck remains evaluation-only, but its cost must never disappear.
 */
export function modelStagesForAudit(
  input: AuditReport | AuditReport['coverage'],
): readonly ModelStageObservation[] {
  const coverage = Array.isArray(input) ? input : input.coverage;
  return [
    ...coverage.flatMap((coverage) =>
      coverage.evidenceMapObservation === undefined ? [] : [coverage.evidenceMapObservation],
    ),
    ...coverage.flatMap((coverage) =>
      coverage.sourcePostureObservation === undefined ? [] : [coverage.sourcePostureObservation],
    ),
    ...coverage.flatMap((coverage) =>
      coverage.modelObservation === undefined ? [] : [coverage.modelObservation],
    ),
    ...coverage.flatMap((coverage) =>
      coverage.candidateGroundingObservation === undefined
        ? []
        : [coverage.candidateGroundingObservation],
    ),
    ...coverage.flatMap((coverage) => coverage.verificationObservations ?? []),
    ...coverage.flatMap((coverage) => coverage.countercheckObservations ?? []),
  ];
}

async function createFilesystem(input: ReviewTargetInput): Promise<JailedReadOnlyFilesystem> {
  return createJailedReadOnlyFilesystem({
    targetRoot: input.targetRoot,
    contextRoot: input.contextRoot,
  });
}
