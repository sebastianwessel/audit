import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/audit-harness.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import type { AuditCheckpointExecution } from '../../audit-execution/audit.schema.js';
import {
  type EvidenceMap,
  EvidenceMapSchema,
} from '../../audit-execution/evidence-map/contract.js';
import { verifyEvidenceMap } from '../../audit-execution/evidence-map/verify.js';
import type { EvidenceMapRequest } from '../../audit-execution/phase-input/contract.js';
import type { SourceEvidenceResolver } from '../../audit-execution/source-evidence-resolver.js';
import type {
  ModelPricing,
  ModelStageObservation,
} from '../../model-operations/model-operations.js';
import type {
  ContextOverflowRecoveredLeaf,
  ContextRecoveryScope,
} from '../../review-workflow/stage-lifecycle/index.js';
import {
  type EvaluatorFailureDiagnosticSink,
  invalidModelOutput,
  runScopedModelStage,
  type ScopedModelStageOverflowTopologyBase,
  scopedInspectionRequirement,
} from '../../review-workflow/stage-lifecycle/index.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type { EvidenceMapModelOutput } from './agent/contract.js';

/** Maps scoped source facts before a separate stage may form a hypothesis. */
export async function runEvidenceMapStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: EvidenceMapRequest;
  /** Lazy exact-source projection over the immutable approved snapshot. */
  sourceEvidence: SourceEvidenceResolver;
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
      ...(priorRecoveredLeaves === undefined
        ? {}
        : {
            priorRecoveredLeaves,
          }),
      ...(onRecoveredLeafCompleted === undefined
        ? {}
        : {
            onRecoveredLeafCompleted: async (leaf: {
              childKey: string;
              attempt: number;
              scope: ContextRecoveryScope;
              scopeFingerprint: string;
              execution: AuditCheckpointExecution;
              output: EvidenceMap;
            }) => {
              assertEvidenceMapWithinScope(leaf.output, leaf.scope);
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
  const result = await runScopedModelStage<EvidenceMap, EvidenceMapModelOutput>({
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
    cacheRoutingEnabled: input.cacheRoutingEnabled,
    evaluatorFailureDiagnosticSink: input.evaluatorFailureDiagnosticSink,
    onCompletedModelObservation: input.onCompletedModelObservation,
    ...(overflowTopology === undefined ? {} : { overflowTopology }),
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope, retryGuidance) =>
      session.workflows.map_vector_evidence.prompt({
        ...input.request,
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        retryGuidance,
      }),
    projectOutput: async (output, scope) => {
      const verified = await verifyEvidenceMap(
        input.request.vector,
        output,
        input.sourceEvidence.forScope(scope.sourcePaths),
      );
      if (verified.rejectedFactCount > 0) {
        invalidModelOutput(['facts']);
      }
      return verified.evidenceMap;
    },
    reduceRecoveredOutputs: (leaves) =>
      EvidenceMapSchema.parse({
        facts: mergeRecoveredFacts(leaves.flatMap((leaf) => leaf.output.facts)),
        unansweredPlanObligations: uniqueByKey(
          leaves.flatMap((leaf) => leaf.output.unansweredPlanObligations),
        ),
        limitations: uniqueSorted(leaves.flatMap((leaf) => leaf.output.limitations)),
      }),
  });
  return result;
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
      throw new AuditRuntimeError(
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
      throw new AuditRuntimeError(
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
