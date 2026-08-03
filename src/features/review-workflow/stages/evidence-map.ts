import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import type { SourceDocument } from '../../audit-execution/audit.schema.js';
import {
  type EvidenceMap,
  mappedControlFactIdsForObligation,
  type UnverifiedEvidenceMap,
} from '../../audit-execution/evidence-map/contract.js';
import { verifyEvidenceMap } from '../../audit-execution/evidence-map/verify.js';
import type { EvidenceMapRequest } from '../../audit-execution/phase-input/contract.js';
import type { ModelCostCeiling, ModelPricing } from '../../model-operations/model-operations.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type {
  ContextOverflowRecoveredLeaf,
  ContextOverflowTopology,
  ContextOverflowTopologyEvent,
} from '../runtime/context-overflow.js';
import { scopedInspectionRequirement } from '../tools/contract.js';
import { runScopedModelStage } from './scoped-model-stage.js';

/** Maps scoped source facts before a separate stage may form a hypothesis. */
export async function runEvidenceMapStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: EvidenceMapRequest;
  /** Internal immutable snapshot projection used to validate persisted leaves. */
  sources?: readonly SourceDocument[];
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
    priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<EvidenceMap>[];
    onTransition: (event: ContextOverflowTopologyEvent) => Promise<void>;
    onRecoveredLeafCompleted?: (input: {
      childKey: string;
      scopeFingerprint: string;
      output: EvidenceMap;
    }) => Promise<void>;
  }>;
}) {
  const overflowTopology = (() => {
    if (input.overflowTopology === undefined) return undefined;
    const { priorRecoveredLeaves, onRecoveredLeafCompleted, ...topology } = input.overflowTopology;
    return {
      ...topology,
      ...(priorRecoveredLeaves === undefined
        ? {}
        : {
            priorRecoveredLeaves: priorRecoveredLeaves.map((leaf) => ({
              ...leaf,
              output: evidenceMapRecoveryOutput(leaf.output, input.request),
            })),
          }),
      ...(onRecoveredLeafCompleted === undefined
        ? {}
        : {
            onRecoveredLeafCompleted: async (leaf: {
              childKey: string;
              scope: {
                sourcePaths: readonly string[];
                lineRanges: readonly { path: string; startLine: number; endLine: number }[];
              };
              scopeFingerprint: string;
              output: UnverifiedEvidenceMap;
            }) => {
              const evidenceMap = verifyEvidenceMap(
                input.request.vector,
                leaf.output,
                (input.sources ?? []).filter((source) =>
                  leaf.scope.sourcePaths.includes(source.path),
                ),
              ).evidenceMap;
              assertEvidenceMapWithinScope(evidenceMap, leaf.scope);
              await onRecoveredLeafCompleted({
                childKey: leaf.childKey,
                scopeFingerprint: leaf.scopeFingerprint,
                output: evidenceMap,
              });
            },
          }),
    };
  })();
  const result = await runScopedModelStage<UnverifiedEvidenceMap>({
    stage: 'evidence-mapping',
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
    ...(overflowTopology === undefined ? {} : { overflowTopology }),
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope) =>
      session.workflows.map_vector_evidence.prompt({
        ...input.request,
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
      }),
    reduceRecoveredOutputs: (leaves) => ({
      facts: mergeRecoveredFacts(leaves.flatMap((leaf) => leaf.output.facts)),
      controlCoverage: input.request.vector.reviewObligations.map((obligation) => ({
        obligationId: obligation.obligationId,
        controlFactIds: uniqueSorted(
          leaves.flatMap((leaf) =>
            leaf.output.controlCoverage
              .filter((coverage) => coverage.obligationId === obligation.obligationId)
              .flatMap((coverage) => coverage.controlFactIds),
          ),
        ),
      })),
      unansweredPlanObligations: uniqueByKey(
        leaves.flatMap((leaf) => leaf.output.unansweredPlanObligations),
      ),
      limitations: uniqueSorted([
        ...leaves.flatMap((leaf) => leaf.output.limitations),
        'The provider context window required deterministic approved-scope recovery.',
      ]),
    }),
  });
  return result;
}

/** Rehydrates a validated map fragment only at the model-workflow boundary. */
export function evidenceMapRecoveryOutput(
  evidenceMap: EvidenceMap,
  request: EvidenceMapRequest,
): UnverifiedEvidenceMap {
  return {
    facts: evidenceMap.facts,
    controlCoverage: request.vector.reviewObligations.map((obligation) => ({
      obligationId: obligation.obligationId,
      controlFactIds: mappedControlFactIdsForObligation(evidenceMap, obligation.obligationId),
    })),
    unansweredPlanObligations: evidenceMap.unansweredPlanObligations,
    limitations: evidenceMap.limitations,
  };
}

function assertEvidenceMapWithinScope(
  evidenceMap: EvidenceMap,
  scope: Readonly<{
    sourcePaths: readonly string[];
    lineRanges: readonly { path: string; startLine: number; endLine: number }[];
  }>,
): void {
  const ranges = new Map(scope.lineRanges.map((range) => [range.path, range] as const));
  for (const evidence of evidenceMap.facts.flatMap((fact) => fact.evidence)) {
    const range = ranges.get(evidence.path);
    if (
      !scope.sourcePaths.includes(evidence.path) ||
      (range !== undefined &&
        (evidence.startLine < range.startLine || evidence.startLine > range.endLine))
    ) {
      throw new SecurityReviewerError(
        'artifact-invalid',
        'A recovery evidence-map artifact contains evidence outside its exact approved scope.',
      );
    }
  }
}

function uniqueByKey<T extends { obligationId: string }>(values: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const value of values) {
    byKey.set(value.obligationId, value);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

/**
 * A recovered leaf may repeat an identical map fact when only advisory context
 * was partitioned. A reused identifier with different content is ambiguous and
 * must stop coverage rather than letting a later map validation choose one.
 */
function mergeRecoveredFacts<T extends { factId: string }>(facts: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const fact of facts) {
    const existing = byId.get(fact.factId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(fact)) {
      throw new SecurityReviewerError(
        'provider-context-overflow',
        'Context recovery produced conflicting evidence-map fact identities.',
      );
    }
    byId.set(fact.factId, fact);
  }
  return [...byId.values()].sort((left, right) => left.factId.localeCompare(right.factId));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
