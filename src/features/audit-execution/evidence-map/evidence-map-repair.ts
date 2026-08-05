import type { ModelProvider } from '@purista/harness';

import type { HarnessExecutionConfiguration } from '../../../platform/harness/audit-harness.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import type { AuditCheckpointExecution } from '../../audit-execution/audit.schema.js';
import type { EvidenceMap } from '../../audit-execution/evidence-map/contract.js';
import {
  appendCanonicalEvidenceMapFacts,
  applyEvidenceMapRepair,
} from '../../audit-execution/evidence-map/repair.js';
import type {
  EvidenceMapRepairRequest,
  SourceDocument,
} from '../../audit-execution/phase-input/contract.js';
import type {
  ModelPricing,
  ModelStageObservation,
} from '../../model-operations/model-operations.js';
import type { ContextOverflowRecoveredLeaf } from '../../review-workflow/stage-lifecycle/index.js';
import {
  type EvaluatorFailureDiagnosticSink,
  invalidModelOutput,
  runScopedModelStage,
  type ScopedModelStageOverflowTopologyBase,
  scopedInspectionRequirement,
} from '../../review-workflow/stage-lifecycle/index.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';

/**
 * Runs the mapper-owned append-only repair stage. Raw model output is reduced
 * to the next canonical evidence map while the scoped lifecycle still owns its
 * observation, retry guidance, overflow recovery, and retained provider use.
 */
export async function runEvidenceMapRepairStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: EvidenceMapRepairRequest;
  /** Immutable approved source snapshot used to canonicalize repair facts. */
  sources: readonly SourceDocument[];
  context: readonly ContextDocument[];
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  cacheRoutingEnabled: boolean;
  overflowTopology?: ScopedModelStageOverflowTopologyBase &
    Readonly<{
      priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<EvidenceMap>[];
      onRecoveredLeafCompleted?: (input: {
        childKey: string;
        scopeFingerprint: string;
        execution: AuditCheckpointExecution;
        output: EvidenceMap;
      }) => Promise<void>;
    }>;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
  onCompletedModelObservation?: (observation: ModelStageObservation) => void;
}) {
  const overflowTopology = (() => {
    if (input.overflowTopology === undefined) return undefined;
    const { priorRecoveredLeaves, onRecoveredLeafCompleted, ...topology } = input.overflowTopology;
    return {
      ...topology,
      ...(priorRecoveredLeaves === undefined ? {} : { priorRecoveredLeaves }),
      ...(onRecoveredLeafCompleted === undefined
        ? {}
        : {
            onRecoveredLeafCompleted: async (leaf: {
              childKey: string;
              attempt: number;
              scope: { sourcePaths: readonly string[] };
              scopeFingerprint: string;
              execution: AuditCheckpointExecution;
              output: EvidenceMap;
            }) => {
              assertRepairMapWithinScope(leaf.output, input.request.evidenceMap, leaf.scope);
              await onRecoveredLeafCompleted({
                childKey: leaf.childKey,
                scopeFingerprint: leaf.scopeFingerprint,
                execution: leaf.execution,
                output: leaf.output,
              });
            },
          }),
    };
  })();
  return runScopedModelStage<
    EvidenceMap,
    import('./agent/contract.js').EvidenceMapRepairModelOutput
  >({
    stage: 'evidence-map-repair',
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
    cacheRoutingEnabled: input.cacheRoutingEnabled,
    evaluatorFailureDiagnosticSink: input.evaluatorFailureDiagnosticSink,
    onCompletedModelObservation: input.onCompletedModelObservation,
    ...(overflowTopology === undefined ? {} : { overflowTopology }),
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope, retryGuidance) =>
      session.workflows.repair_vector_evidence.prompt({
        ...input.request,
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        retryGuidance,
      }),
    projectOutput: (output) => {
      try {
        return applyEvidenceMapRepair({
          vector: input.request.vector,
          evidenceMap: input.request.evidenceMap,
          repair: output,
          sources: input.sources,
        }).evidenceMap;
      } catch (error) {
        if (error instanceof AuditRuntimeError && error.code === 'artifact-invalid') {
          invalidModelOutput(['facts']);
        }
        throw error;
      }
    },
    reduceRecoveredOutputs: (leaves) =>
      appendCanonicalEvidenceMapFacts({
        evidenceMap: input.request.evidenceMap,
        facts: mergeRecoveredRepairFacts(
          leaves.flatMap((leaf) => repairAdditions(input.request.evidenceMap, leaf.output)),
        ),
      }).evidenceMap,
  });
}

/** A recovered child may retain only newly appended facts inside its exact scope. */
function assertRepairMapWithinScope(
  evidenceMap: EvidenceMap,
  priorEvidenceMap: EvidenceMap,
  scope: Readonly<{ sourcePaths: readonly string[] }>,
): void {
  for (const fact of repairAdditions(priorEvidenceMap, evidenceMap)) {
    if (fact.evidence.some((evidence) => !scope.sourcePaths.includes(evidence.path))) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'A recovery evidence-map repair artifact contains evidence outside its exact approved scope.',
      );
    }
  }
}

/** Rejects changed/omitted base facts before a persisted repair child can be reused. */
function repairAdditions(priorEvidenceMap: EvidenceMap, repairedEvidenceMap: EvidenceMap) {
  const priorById = new Map(priorEvidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  const additions = repairedEvidenceMap.facts.flatMap((fact) => {
    const prior = priorById.get(fact.factId);
    if (prior === undefined) return [fact];
    if (JSON.stringify(prior) !== JSON.stringify(fact)) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'A recovery evidence-map repair artifact changed an existing neutral fact.',
      );
    }
    return [];
  });
  if (additions.length + priorEvidenceMap.facts.length !== repairedEvidenceMap.facts.length) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A recovery evidence-map repair artifact omitted an existing neutral fact.',
    );
  }
  return additions;
}

/** Exact duplicates may be reassembled; conflicting identities fail closed. */
function mergeRecoveredRepairFacts<T extends { factId: string }>(facts: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const fact of facts) {
    const existing = byId.get(fact.factId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(fact)) {
      throw new AuditRuntimeError(
        'provider-context-overflow',
        'Context recovery produced conflicting evidence-map repair fact identities.',
      );
    }
    byId.set(fact.factId, fact);
  }
  return [...byId.values()].sort((left, right) => left.factId.localeCompare(right.factId));
}
