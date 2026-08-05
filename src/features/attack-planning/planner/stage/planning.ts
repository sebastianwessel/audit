import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../../platform/harness/audit-harness.js';
import { AuditRuntimeError } from '../../../../shared/errors/audit-runtime-error.js';
import type { ModelPricing } from '../../../model-operations/index.js';
import {
  type EvaluatorFailureDiagnosticSink,
  projectScopedModelOutput,
  runScopedModelStage,
  scopedInspectionRequirement,
} from '../../../review-workflow/stage-lifecycle/index.js';
import type { SourceRepository } from '../../../target-inventory/index.js';
import { createPlan, type DraftVectorInput } from '../../plan/plan.js';
import type { AdditionalObservation, AttackPlan } from '../../plan/plan.schema.js';
import {
  type PlanModelOutput,
  PlanModelOutputSchema,
  type PlanModelRequest,
} from '../agent/contract.js';

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
        createExecutablePlan(input.request, PlanModelOutputSchema.parse(output)),
      ),
    reduceRecoveredOutputs: (leaves) =>
      createExecutablePlan(input.request, {
        vectors: mergeRecoveredDraftVectors(
          leaves.flatMap((leaf) => leaf.output.vectors.map(toDraftVector)),
        ),
        additionalObservations: mergeAdditionalObservations(
          leaves.flatMap((leaf) => leaf.output.additionalObservations),
        ),
      }),
  });
}

function createExecutablePlan(
  request: PlanModelRequest,
  output: Readonly<{
    vectors: readonly DraftVectorInput[];
    additionalObservations: readonly AdditionalObservation[];
  }>,
): AttackPlan {
  return createPlan({
    targetFingerprint: request.targetFingerprint,
    contextDigest: request.contextDigest,
    targetDisplayName: request.targetDisplayName,
    inventorySummary: request.inventorySummary,
    vectors: output.vectors,
    additionalObservations: output.additionalObservations,
    createdAt: request.createdAt,
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
  const byId = new Map<string, AdditionalObservation>();
  for (const observation of observations) {
    const existing = byId.get(observation.observationId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(observation)) {
      throw new AuditRuntimeError(
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
      throw new AuditRuntimeError(
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
