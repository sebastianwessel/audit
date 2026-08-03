import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import type {
  CandidateGroundingRequest,
  CanonicalCandidateGroundingOutput,
} from '../../audit-execution/candidate-grounding/contract.js';
import { canonicalizeCandidateGroundingOutput } from '../../audit-execution/candidate-grounding/identity.js';
import type { SourceDocument } from '../../audit-execution/phase-input/contract.js';
import type { ModelCostCeiling, ModelPricing } from '../../model-operations/model-operations.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type {
  ContextOverflowRecoveredLeaf,
  ContextOverflowTopology,
  ContextOverflowTopologyEvent,
  ContextRecoveryScope,
} from '../runtime/context-overflow.js';
import { scopedInspectionRequirement } from '../tools/contract.js';
import { runScopedModelStage } from './scoped-model-stage.js';

/** Grounds a bounded batch of discovery seeds without permitting new discovery. */
export async function runCandidateGroundingStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: CandidateGroundingRequest;
  /** Immutable in-memory snapshot projection used before persisting recovery work. */
  sources: readonly SourceDocument[];
  context: readonly ContextDocument[];
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  modelCostCeiling?: ModelCostCeiling;
  cacheRoutingEnabled: boolean;
  overflowTopology?: Readonly<{
    prior?: ContextOverflowTopology;
    priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<CanonicalCandidateGroundingOutput>[];
    onTransition: (event: ContextOverflowTopologyEvent) => Promise<void>;
    onRecoveredLeafCompleted?: (input: {
      childKey: string;
      scopeFingerprint: string;
      output: CanonicalCandidateGroundingOutput;
    }) => Promise<void>;
  }>;
}) {
  return runScopedModelStage<CanonicalCandidateGroundingOutput>({
    stage: 'candidate-grounding',
    route: 'primary',
    stageId: input.request.vector.vectorId,
    modelProvider: input.modelProvider,
    filesystem: input.filesystem,
    availableSourcePaths: input.request.availableSourcePaths,
    context: input.context,
    sessionId: input.sessionId,
    modelName: input.modelName,
    harnessExecution: input.harnessExecution,
    modelCacheRoutingKey: input.modelCacheRoutingKey,
    modelPricing: input.modelPricing,
    modelCostCeiling: input.modelCostCeiling,
    cacheRoutingEnabled: input.cacheRoutingEnabled,
    ...(input.overflowTopology === undefined ? {} : { overflowTopology: input.overflowTopology }),
    requireScopedSourceInspection: true,
    invoke: async (session, _attempt, scope: ContextRecoveryScope) =>
      canonicalizeCandidateGroundingOutput({
        vector: input.request.vector,
        seeds: input.request.seeds,
        output: await session.workflows.ground_vector_candidates.prompt({
          ...input.request,
          availableSourcePaths: [...scope.sourcePaths],
          context: [...scope.context],
          inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        }),
        evidenceMap: input.request.evidenceMap,
        sourcePosture: input.request.sourcePosture,
        sources: input.sources,
      }),
    reduceRecoveredOutputs: (leaves) => ({
      groundings: input.request.seeds.map((seed) => {
        const groundings = leaves.flatMap((leaf) =>
          leaf.output.groundings.filter((grounding) => grounding.seedId === seed.seedId),
        );
        if (groundings.length === 0) {
          throw new SecurityReviewerError(
            'provider-context-overflow',
            'Context recovery did not return every requested grounding.',
          );
        }
        const groundingIdentities = new Set(
          groundings.map((grounding) => JSON.stringify(grounding)),
        );
        if (groundingIdentities.size > 1) {
          throw new SecurityReviewerError(
            'provider-context-overflow',
            'Context recovery produced conflicting canonical grounding outcomes.',
          );
        }
        const grounding = groundings[0];
        if (grounding === undefined) {
          throw new SecurityReviewerError(
            'provider-context-overflow',
            'Context recovery did not retain a canonical grounding outcome.',
          );
        }
        return grounding;
      }),
    }),
  });
}
