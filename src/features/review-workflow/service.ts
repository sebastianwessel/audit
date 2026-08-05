import type { ModelProvider } from '@purista/harness';
import {
  createJailedReadOnlyFilesystem,
  type JailedReadOnlyFilesystem,
} from '../../platform/filesystem/index.js';
import {
  type HarnessExecutionConfiguration,
  HarnessExecutionConfigurationSchema,
} from '../../platform/harness/audit-harness.js';
import {
  DefaultMaxParallelVectors,
  MaxParallelVectorsSchema,
} from '../../shared/contracts/concurrency.js';
import {
  AuditRuntimeError,
  AuditRuntimeErrorCodeSchema,
} from '../../shared/errors/audit-runtime-error.js';
import {
  type AttackPlan,
  assertPlanIsSealed,
  assertPlanMatchesTarget,
} from '../attack-planning/index.js';
import { runPlanningStage } from '../attack-planning/planner/stage/index.js';
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
  AuditCheckpointExecution,
  AuditContextOverflowLedger,
  AuditEvidenceMapDraft,
  AuditReport,
  AuditSourcePostureDraft,
  AuditVectorResult,
} from '../audit-execution/audit.schema.js';
import { runCandidateGroundingStage } from '../audit-execution/candidate-grounding/stage/index.js';
import type { AuditResumeState } from '../audit-execution/checkpoints.js';
import {
  runEvidenceMapRepairStage,
  runEvidenceMapStage,
} from '../audit-execution/evidence-map/stage/index.js';
import { selectScopedSourcePaths } from '../audit-execution/investigation/scope.js';
import { runInvestigationStage } from '../audit-execution/investigation/stage/index.js';
import { modelStagesForAudit } from '../audit-execution/model-stage-observations.js';
import { runSourcePostureStage } from '../audit-execution/source-posture/stage/index.js';
import { runVerificationStage } from '../audit-execution/verification/stage/index.js';
import type { PublicAuditReport } from '../audit-report/public-contract.js';
import {
  type DeveloperGuidanceAttempt,
  type DeveloperGuidanceCheckpoint,
  type DeveloperGuidanceItem,
  type DeveloperGuidanceReport,
  DeveloperGuidanceReportSchema,
} from '../developer-guidance/guidance.schema.js';
import {
  createDeveloperGuidanceFindingBinding,
  createDeveloperGuidanceId,
  createDeveloperGuidanceReportDigest,
  latestDeveloperGuidanceAttempts,
} from '../developer-guidance/identity.js';
import { runDeveloperGuidanceStage } from '../developer-guidance/stage/index.js';
import {
  type ModelPricing,
  type ModelRunObservation,
  summarizeModelStages,
} from '../model-operations/model-operations.js';
import {
  captureTargetInventory,
  inventoryTarget,
  type TargetInventoryCapture,
} from '../target-inventory/inventory.js';
import type { TargetInventory } from '../target-inventory/inventory.schema.js';
import { admittedSourcePaths } from '../target-inventory/inventory.schema.js';
import {
  type ContextOverflowTopology,
  contextOverflowRecoveryProtocolFingerprint,
  contextRecoveryRootScopeFingerprint,
} from './runtime/context-overflow.js';
import { selectApplicableContext } from './runtime/source-tools.js';
import type { ResolvedVerificationRoute } from './runtime/verification-route.js';
import type { EvaluatorFailureDiagnosticSink } from './stages/scoped-model-stage.js';

export type ReviewService = Readonly<{
  inspectTarget: (input: ReviewTargetInput) => Promise<TargetInventory>;
  createPlan: (input: ReviewTargetInput & { createdAt: string; sessionId: string }) => Promise<{
    inventory: TargetInventory;
    plan: AttackPlan;
    modelObservation: ModelRunObservation;
  }>;
  createDeveloperGuidance: (
    input: ReviewTargetInput & {
      plan: AttackPlan;
      report: PublicAuditReport;
      retainedTarget?: TargetInventoryCapture;
      recoveredCheckpoint?: DeveloperGuidanceCheckpoint;
      retryUnfinished?: boolean;
      onCheckpoint?: (state: { attempts: readonly DeveloperGuidanceAttempt[] }) => Promise<void>;
      runId: string;
      generatedAt: string;
      sessionId: string;
    },
  ) => Promise<{
    inventory: TargetInventory;
    guidance: DeveloperGuidanceReport;
    modelObservation: ModelRunObservation;
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
        draft: Pick<
          AuditEvidenceMapDraft,
          'vectorId' | 'evidenceMap' | 'repairAttempts' | 'execution'
        >,
      ) => Promise<void>;
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
      onSourcePostureDraft?: (
        draft: Pick<
          AuditSourcePostureDraft,
          'vectorId' | 'sourcePosture' | 'execution' | 'evidenceMapFingerprint'
        >,
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
  /** Evaluator-only best-effort diagnostics; product callers must leave this absent. */
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
}>;

export type DeveloperGuidanceTargetInput = ReviewTargetInput &
  Readonly<{
    plan: AttackPlan;
    report: PublicAuditReport;
  }>;

function assertDeveloperGuidanceBindings(
  input: DeveloperGuidanceTargetInput,
  inventory: TargetInventory,
): void {
  assertPlanIsSealed(input.plan);
  assertPlanMatchesTarget(input.plan, inventory.targetFingerprint, inventory.contextDigest);
  if (
    input.report.planId !== input.plan.planId ||
    input.report.targetFingerprint !== inventory.targetFingerprint
  ) {
    throw new AuditRuntimeError(
      'invalid-input',
      'Developer guidance requires a report for the exact sealed plan and target.',
    );
  }
}

/**
 * Validates every non-provider input and captures the immutable state that the
 * later guidance stage is allowed to inspect.
 */
export async function prepareDeveloperGuidanceTarget(
  input: DeveloperGuidanceTargetInput,
): Promise<TargetInventoryCapture> {
  const capture = await captureTargetInventory(await createFilesystem(input));
  assertDeveloperGuidanceBindings(input, capture.inventory);
  return capture;
}

export function createReviewService(
  modelProvider: ModelProvider,
  modelName?: string,
  options: ReviewServiceOptions = {},
): ReviewService {
  const maxParallelVectors = MaxParallelVectorsSchema.parse(
    options.maxParallelVectors ?? DefaultMaxParallelVectors,
  );
  const harnessExecution = HarnessExecutionConfigurationSchema.parse(
    options.harnessExecution ?? {},
  );
  const modelPricing: ModelPricing = options.modelPricing ?? {};
  const cacheRoutingEnabled = options.modelCacheRoutingKey !== undefined;
  const verificationRoute = options.independentVerifierRoute;
  return Object.freeze({
    inspectTarget: async (input) => inventoryTarget(await createFilesystem(input)),
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
          sourcePaths: admittedSourcePaths(inventory.sourceSnapshot),
          context: inventory.context,
          createdAt: input.createdAt,
        },
        sessionId: input.sessionId,
        modelName,
        harnessExecution,
        modelCacheRoutingKey: options.modelCacheRoutingKey,
        modelPricing,
        cacheRoutingEnabled,
        evaluatorFailureDiagnosticSink: options.evaluatorFailureDiagnosticSink,
      });
      if (planning.status === 'failed') {
        const stableErrorCode = AuditRuntimeErrorCodeSchema.safeParse(planning.errorCode);
        throw new AuditRuntimeError(
          stableErrorCode.success ? stableErrorCode.data : 'provider-failure',
          'The planning model stage did not complete.',
        );
      }
      return {
        inventory,
        plan: planning.output,
        modelObservation: summarizeModelStages([planning.modelObservation], modelPricing),
      };
    },
    createDeveloperGuidance: async (input) => {
      const capture = input.retainedTarget ?? (await prepareDeveloperGuidanceTarget(input));
      const { inventory, snapshot } = capture;
      assertDeveloperGuidanceBindings(input, inventory);
      const attempts = [...(input.recoveredCheckpoint?.attempts ?? [])];
      const recoveredByFinding = latestDeveloperGuidanceAttempts(input.recoveredCheckpoint);
      const reportFindingIds = new Set(input.report.findings.map((finding) => finding.findingId));
      if (attempts.some((attempt) => !reportFindingIds.has(attempt.item.findingId))) {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'A recovered developer-guidance item is not an accepted report finding.',
        );
      }
      for (const attempt of attempts) {
        const finding = input.report.findings.find(
          (candidate) => candidate.findingId === attempt.item.findingId,
        );
        if (finding === undefined) {
          throw new AuditRuntimeError(
            'artifact-invalid',
            'A recovered developer-guidance attempt is not an accepted report finding.',
          );
        }
        const binding = createDeveloperGuidanceFindingBinding(finding);
        if (
          attempt.item.findingFingerprint !== binding.findingFingerprint ||
          attempt.item.vectorId !== binding.vectorId ||
          attempt.modelObservation.stageId !==
            createDeveloperGuidanceId(input.report.reportId, finding.findingId)
        ) {
          throw new AuditRuntimeError(
            'artifact-invalid',
            'A recovered developer-guidance attempt does not match its accepted finding.',
          );
        }
      }
      for (const finding of input.report.findings) {
        const binding = createDeveloperGuidanceFindingBinding(finding);
        const recovered = recoveredByFinding.get(finding.findingId);
        if (recovered !== undefined) {
          if (
            recovered.item.findingFingerprint !== binding.findingFingerprint ||
            recovered.item.vectorId !== binding.vectorId
          ) {
            throw new AuditRuntimeError(
              'artifact-invalid',
              'A recovered developer-guidance item does not match its accepted finding.',
            );
          }
          if (recovered.item.status === 'completed' || input.retryUnfinished !== true) continue;
        }
        const vector = input.plan.vectors.find(
          (candidate) => candidate.vectorId === finding.vectorId,
        );
        if (vector === undefined) {
          throw new AuditRuntimeError(
            'artifact-invalid',
            'A report finding has no matching plan vector.',
          );
        }
        const sourcePaths = selectScopedSourcePaths(
          vector,
          admittedSourcePaths(inventory.sourceSnapshot),
        );
        const stage = await runDeveloperGuidanceStage({
          modelProvider,
          filesystem: snapshot,
          request: {
            guidanceId: createDeveloperGuidanceId(input.report.reportId, finding.findingId),
            finding,
            vector,
            availableSourcePaths: sourcePaths,
            context: [...selectApplicableContext(inventory.context, sourcePaths)],
          },
          context: selectApplicableContext(inventory.context, sourcePaths),
          sessionId: input.sessionId,
          modelName,
          harnessExecution,
          modelCacheRoutingKey: options.modelCacheRoutingKey,
          modelPricing,
          cacheRoutingEnabled,
        });
        const item: DeveloperGuidanceItem =
          stage.status === 'completed'
            ? {
                ...binding,
                status: 'completed',
                recommendedPriority: stage.output.recommendedPriority,
              }
            : stage.errorCode === 'provider-cancelled'
              ? { ...binding, status: 'cancelled', reasonCode: 'provider-cancelled' }
              : { ...binding, status: 'incomplete', reasonCode: stage.errorCode };
        attempts.push({
          attempt: (recovered?.attempt ?? 0) + 1,
          item,
          modelObservation: stage.modelObservation,
        });
        await input.onCheckpoint?.({ attempts });
      }
      const finalAttempts = new Map(recoveredByFinding);
      for (const attempt of attempts) {
        const current = finalAttempts.get(attempt.item.findingId);
        if (current === undefined || current.attempt < attempt.attempt) {
          finalAttempts.set(attempt.item.findingId, attempt);
        }
      }
      const items = input.report.findings.map((finding) => {
        const attempt = finalAttempts.get(finding.findingId);
        if (attempt === undefined) {
          throw new AuditRuntimeError(
            'artifact-invalid',
            'Developer guidance is missing a terminal item for an accepted report finding.',
          );
        }
        return attempt.item;
      });
      const guidance = DeveloperGuidanceReportSchema.parse({
        schemaVersion: 3,
        guidanceId: createDeveloperGuidanceId(input.report.reportId, input.runId),
        runId: input.runId,
        reportId: input.report.reportId,
        reportDigest: createDeveloperGuidanceReportDigest(input.report),
        planId: input.plan.planId,
        planDigest: input.plan.planDigest,
        targetFingerprint: inventory.targetFingerprint,
        contextDigest: inventory.contextDigest,
        generatedAt: input.generatedAt,
        items,
        modelObservation: summarizeModelStages(
          attempts.map((attempt) => attempt.modelObservation),
          modelPricing,
        ),
      });
      return {
        inventory,
        guidance,
        modelObservation: guidance.modelObservation,
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
        sourceSnapshot,
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
                          priorRecoveredLeaves: stageContext.priorEvidenceMapRecoveryLeaves
                            .filter(
                              (leaf) =>
                                leaf.phaseInputFingerprint === stageContext.phaseInputFingerprint,
                            )
                            .map((leaf) => ({
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              output: leaf.evidenceMap,
                            })),
                        }),
                    ...(stageContext?.onEvidenceMapRecoveryLeaf === undefined
                      ? {}
                      : {
                          onRecoveredLeafCompleted: async (leaf: {
                            childKey: string;
                            scopeFingerprint: string;
                            execution: AuditCheckpointExecution;
                            output: import('../audit-execution/evidence-map/contract.js').EvidenceMap;
                          }) =>
                            stageContext.onEvidenceMapRecoveryLeaf?.({
                              vectorId: request.vector.vectorId,
                              phase: 'evidence-mapping',
                              parentStageId: request.vector.vectorId,
                              phaseInputFingerprint: stageContext.phaseInputFingerprint,
                              recoveryProtocolFingerprint:
                                contextOverflowRecoveryProtocolFingerprint,
                              rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                                sourcePaths: request.availableSourcePaths,
                                context,
                              }),
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              execution: leaf.execution,
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
            sources: await sourceSnapshot.documents(request.availableSourcePaths),
            context,
            sessionId: `${input.sessionId}-${request.vector.vectorId}-evidence-map`,
            modelName,
            harnessExecution,
            modelCacheRoutingKey: options.modelCacheRoutingKey,
            modelPricing,
            cacheRoutingEnabled,
            evaluatorFailureDiagnosticSink: options.evaluatorFailureDiagnosticSink,
            onCompletedModelObservation: stageContext?.onCompletedModelObservation,
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
        repairEvidenceMap: async (request, stageContext) => {
          const context = selectApplicableContext(inventory.context, request.availableSourcePaths);
          const recovery = overflowTopologyForStage({
            stageContext,
            phase: 'evidence-map-repair',
            vectorId: request.vector.vectorId,
            sourcePaths: request.availableSourcePaths,
            context,
          });
          const evidenceMapRepairRecovery =
            'overflowTopology' in recovery
              ? {
                  overflowTopology: {
                    ...recovery.overflowTopology,
                    ...(stageContext?.priorEvidenceMapRecoveryLeaves === undefined
                      ? {}
                      : {
                          priorRecoveredLeaves: stageContext.priorEvidenceMapRecoveryLeaves
                            .filter(
                              (leaf) =>
                                leaf.phase === 'evidence-map-repair' &&
                                leaf.phaseInputFingerprint === stageContext.phaseInputFingerprint,
                            )
                            .map((leaf) => ({
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              output: leaf.evidenceMap,
                            })),
                        }),
                    ...(stageContext?.onEvidenceMapRecoveryLeaf === undefined
                      ? {}
                      : {
                          onRecoveredLeafCompleted: async (leaf: {
                            childKey: string;
                            scopeFingerprint: string;
                            execution: AuditCheckpointExecution;
                            output: import('../audit-execution/evidence-map/contract.js').EvidenceMap;
                          }) =>
                            stageContext.onEvidenceMapRecoveryLeaf?.({
                              vectorId: request.vector.vectorId,
                              phase: 'evidence-map-repair',
                              parentStageId: request.vector.vectorId,
                              phaseInputFingerprint: stageContext.phaseInputFingerprint,
                              recoveryProtocolFingerprint:
                                contextOverflowRecoveryProtocolFingerprint,
                              rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                                sourcePaths: request.availableSourcePaths,
                                context,
                              }),
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              execution: leaf.execution,
                              evidenceMap: leaf.output,
                            }),
                        }),
                  },
                }
              : recovery;
          const result = await runEvidenceMapRepairStage({
            modelProvider,
            filesystem: sourceSnapshot,
            request,
            sources: await sourceSnapshot.documents(request.availableSourcePaths),
            context,
            sessionId: `${input.sessionId}-${request.vector.vectorId}-evidence-map-repair`,
            modelName,
            harnessExecution,
            modelCacheRoutingKey: options.modelCacheRoutingKey,
            modelPricing,
            cacheRoutingEnabled,
            evaluatorFailureDiagnosticSink: options.evaluatorFailureDiagnosticSink,
            onCompletedModelObservation: stageContext?.onCompletedModelObservation,
            ...evidenceMapRepairRecovery,
          });
          return result.status === 'completed'
            ? { evidenceMap: result.output, modelObservation: result.modelObservation }
            : { evidenceMap: request.evidenceMap, modelObservation: result.modelObservation };
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
                          priorRecoveredLeaves: stageContext.priorSourcePostureRecoveryLeaves
                            .filter(
                              (leaf) =>
                                leaf.phaseInputFingerprint === stageContext.phaseInputFingerprint,
                            )
                            .map((leaf) => ({
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              output: leaf.sourcePosture,
                            })),
                        }),
                    ...(stageContext?.onSourcePostureRecoveryLeaf === undefined
                      ? {}
                      : {
                          onRecoveredLeafCompleted: async (leaf: {
                            childKey: string;
                            scopeFingerprint: string;
                            execution: AuditCheckpointExecution;
                            output: import('../audit-execution/source-posture/contract.js').SourcePosture;
                          }) =>
                            stageContext.onSourcePostureRecoveryLeaf?.({
                              vectorId: request.vector.vectorId,
                              parentStageId: request.vector.vectorId,
                              phaseInputFingerprint: stageContext.phaseInputFingerprint,
                              recoveryProtocolFingerprint:
                                contextOverflowRecoveryProtocolFingerprint,
                              rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                                sourcePaths: request.availableSourcePaths,
                                context,
                              }),
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              execution: leaf.execution,
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
            cacheRoutingEnabled,
            evaluatorFailureDiagnosticSink: options.evaluatorFailureDiagnosticSink,
            onCompletedModelObservation: stageContext?.onCompletedModelObservation,
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
            cacheRoutingEnabled,
            evaluatorFailureDiagnosticSink: options.evaluatorFailureDiagnosticSink,
            onCompletedModelObservation: stageContext?.onCompletedModelObservation,
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
                          priorRecoveredLeaves: stageContext.priorCandidateGroundingRecoveryLeaves
                            .filter(
                              (leaf) =>
                                leaf.phaseInputFingerprint === stageContext.phaseInputFingerprint,
                            )
                            .map((leaf) => ({
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
                            execution: AuditCheckpointExecution;
                            output: import('../audit-execution/candidate-grounding/contract.js').CanonicalCandidateGroundingOutput;
                          }) =>
                            stageContext.onCandidateGroundingRecoveryLeaf?.({
                              vectorId: request.vector.vectorId,
                              parentStageId: request.vector.vectorId,
                              phaseInputFingerprint: stageContext.phaseInputFingerprint,
                              recoveryProtocolFingerprint:
                                contextOverflowRecoveryProtocolFingerprint,
                              rootScopeFingerprint: contextRecoveryRootScopeFingerprint({
                                sourcePaths: request.availableSourcePaths,
                                context,
                              }),
                              childKey: leaf.childKey,
                              scopeFingerprint: leaf.scopeFingerprint,
                              execution: leaf.execution,
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
            sources: await sourceSnapshot.documents(request.availableSourcePaths),
            context,
            sessionId: `${input.sessionId}-${request.vector.vectorId}-candidate-grounding`,
            modelName,
            harnessExecution,
            modelCacheRoutingKey: options.modelCacheRoutingKey,
            modelPricing,
            cacheRoutingEnabled,
            evaluatorFailureDiagnosticSink: options.evaluatorFailureDiagnosticSink,
            onCompletedModelObservation: stageContext?.onCompletedModelObservation,
            ...candidateGroundingRecovery,
          });
          return result.status === 'completed'
            ? {
                groundings: result.output,
                mapInsufficiencies: result.output.mapInsufficiencies ?? [],
                modelObservation: result.modelObservation,
              }
            : { groundings: { groundings: [] }, modelObservation: result.modelObservation };
        },
        verify: (request, candidateContext) => {
          const context = selectApplicableContext(inventory.context, request.availableSourcePaths);
          const overflowTopology =
            candidateContext === undefined
              ? undefined
              : {
                  phaseInputFingerprint: candidateContext.phaseInputFingerprint,
                  ...(candidateContext.priorContextOverflowTopology === undefined
                    ? {}
                    : { prior: candidateContext.priorContextOverflowTopology }),
                  onTransition: async (event: ContextOverflowTopology['events'][number]) =>
                    candidateContext.onContextOverflowTransition?.({
                      phaseInputFingerprint: candidateContext.phaseInputFingerprint,
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
            cacheRoutingEnabled: verificationRoute?.cacheRoutingEnabled ?? cacheRoutingEnabled,
            evaluatorFailureDiagnosticSink: options.evaluatorFailureDiagnosticSink,
            onCompletedModelObservation: candidateContext?.onCompletedModelObservation,
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
        phaseInputFingerprint: AuditContextOverflowLedger['phaseInputFingerprint'];
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
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The persisted context-overflow topology is bound to a different audit stage.',
    );
  }
  const reusablePrior =
    prior?.phaseInputFingerprint === stageContext.phaseInputFingerprint ? prior : undefined;
  return {
    overflowTopology: {
      phaseInputFingerprint: stageContext.phaseInputFingerprint,
      ...(reusablePrior === undefined
        ? {}
        : {
            prior: {
              phaseInputFingerprint: reusablePrior.phaseInputFingerprint,
              recoveryProtocolFingerprint: reusablePrior.recoveryProtocolFingerprint,
              rootScopeFingerprint: reusablePrior.rootScopeFingerprint,
              events: reusablePrior.events.map(
                ({ childKey, attempt, scopeFingerprint, state, errorCode, execution }) => ({
                  childKey,
                  attempt,
                  scopeFingerprint,
                  state,
                  errorCode,
                  ...(execution === undefined ? {} : { execution }),
                }),
              ),
            },
          }),
      onTransition: async (event) => {
        await stageContext.onContextOverflowTransition?.({
          vectorId: input.vectorId,
          phase: input.phase,
          parentStageId: input.vectorId,
          phaseInputFingerprint: stageContext.phaseInputFingerprint,
          recoveryProtocolFingerprint: contextOverflowRecoveryProtocolFingerprint,
          rootScopeFingerprint,
          event,
        });
      },
    },
  };
}

async function createFilesystem(input: ReviewTargetInput): Promise<JailedReadOnlyFilesystem> {
  return createJailedReadOnlyFilesystem({
    targetRoot: input.targetRoot,
    contextRoot: input.contextRoot,
  });
}
