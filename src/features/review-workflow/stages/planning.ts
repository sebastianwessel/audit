import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import type { DraftVectorInput } from '../../attack-planning/plan.js';
import type { AdditionalObservation } from '../../attack-planning/plan.schema.js';
import type { ModelCostCeiling, ModelPricing } from '../../model-operations/model-operations.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type { PlanModelRequest } from '../agents/planning/contract.js';
import { scopedInspectionRequirement } from '../tools/contract.js';
import { runScopedModelStage } from './scoped-model-stage.js';

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
  modelCostCeiling?: ModelCostCeiling;
  cacheRoutingEnabled: boolean;
}) {
  return runScopedModelStage({
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
    modelCostCeiling: input.modelCostCeiling,
    cacheRoutingEnabled: input.cacheRoutingEnabled,
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope) =>
      session.agents.planner.prompt({
        ...input.request,
        sourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
      }),
    reduceRecoveredOutputs: (leaves) => ({
      vectors: mergeRecoveredDraftVectors(leaves.flatMap((leaf) => leaf.output.vectors)),
      additionalObservations: mergeAdditionalObservations(
        leaves.flatMap((leaf) => leaf.output.additionalObservations),
      ),
    }),
  });
}

function mergeAdditionalObservations(
  observations: readonly AdditionalObservation[],
): AdditionalObservation[] {
  const byId = new Map<string, AdditionalObservation>();
  for (const observation of observations) {
    const existing = byId.get(observation.observationId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(observation)) {
      throw new SecurityReviewerError(
        'provider-context-overflow',
        'Context recovery produced conflicting additional-observation identities.',
      );
    }
    byId.set(observation.observationId, observation);
  }
  return [...byId.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, observation]) => observation);
}

function mergeRecoveredDraftVectors(vectors: readonly DraftVectorInput[]): DraftVectorInput[] {
  const byIdentity = new Map<string, DraftVectorInput>();
  for (const vector of vectors) {
    const identity = vector.title;
    const existing = byIdentity.get(identity);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(vector)) {
      throw new SecurityReviewerError(
        'provider-context-overflow',
        'Context recovery produced conflicting planning-vector identities.',
      );
    }
    byIdentity.set(identity, vector);
  }
  return [...byIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, vector]) => vector);
}
