import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../../platform/harness/audit-harness.js';
import { canonicalJson, sha256 } from '../../../../shared/contracts/core.js';
import type { ModelPricing } from '../../../model-operations/index.js';
import {
  type EvaluatorFailureDiagnosticSink,
  projectScopedModelOutput,
  runScopedModelStage,
  scopedInspectionRequirement,
} from '../../../review-workflow/stage-lifecycle/index.js';
import type { SourceRepository } from '../../../target-inventory/source-snapshot.js';
import { createPlan, type DraftVectorInput } from '../../plan/plan.js';
import type { AdditionalObservation, AttackPlan } from '../../plan/plan.schema.js';
import {
  type PlanModelOutput,
  PlanModelOutputSchema,
  type PlanModelRequest,
} from '../agent/contract.js';
import { createExecutablePlanFromModelOutput } from '../materialize.js';

/** Creates one source-inspected draft plan through the shared scoped lifecycle. */
export async function runPlanningStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: PlanModelRequest;
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  cacheRoutingEnabled: boolean;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
}) {
  return runScopedModelStage<AttackPlan, PlanModelOutput>({
    stage: 'planning',
    route: 'primary',
    stageId: input.sessionId,
    modelProvider: input.modelProvider,
    filesystem: input.filesystem,
    availableSourcePaths: input.request.sourcePaths,
    context: input.request.context,
    sessionId: input.sessionId,
    modelName: input.modelName,
    harnessExecution: input.harnessExecution,
    modelCacheRoutingKey: input.modelCacheRoutingKey,
    modelPricing: input.modelPricing,
    cacheRoutingEnabled: input.cacheRoutingEnabled,
    evaluatorFailureDiagnosticSink: input.evaluatorFailureDiagnosticSink,
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope, retryGuidance) =>
      session.agents.planner.prompt({
        ...input.request,
        sourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        retryGuidance,
      }),
    projectOutput: (output) =>
      projectScopedModelOutput(() =>
        createExecutablePlanFromModelOutput(input.request, PlanModelOutputSchema.parse(output)),
      ),
    reduceRecoveredOutputs: (leaves) =>
      createPlan({
        targetFingerprint: input.request.targetFingerprint,
        contextDigest: input.request.contextDigest,
        targetDisplayName: input.request.targetDisplayName,
        inventorySummary: input.request.inventorySummary,
        vectors: mergeRecoveredDraftVectors(
          leaves.flatMap((leaf) => leaf.output.vectors.map(toDraftVector)),
        ),
        additionalObservations: mergeAdditionalObservations(
          leaves.flatMap((leaf) => leaf.output.additionalObservations),
        ),
        createdAt: input.request.createdAt,
      }),
  });
}

function toDraftVector(vector: AttackPlan['vectors'][number]): DraftVectorInput {
  return {
    title: vector.title,
    rationale: vector.rationale,
    enabled: vector.enabled,
    scopeGlobs: vector.scopeGlobs,
    reviewObligations: vector.reviewObligations,
    limitations: vector.limitations,
  };
}

function mergeAdditionalObservations(
  observations: readonly AdditionalObservation[],
): AdditionalObservation[] {
  const byDigest = new Map<string, AdditionalObservation>();
  for (const observation of observations) {
    byDigest.set(sha256(canonicalJson(observation)), observation);
  }
  return [...byDigest.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, observation]) => observation);
}

function mergeRecoveredDraftVectors(vectors: readonly DraftVectorInput[]): DraftVectorInput[] {
  const byDigest = new Map<string, DraftVectorInput>();
  for (const vector of vectors) {
    byDigest.set(sha256(canonicalJson(vector)), vector);
  }
  return [...byDigest.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, vector]) => vector);
}
