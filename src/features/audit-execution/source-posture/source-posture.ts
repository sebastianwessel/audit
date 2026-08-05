import type { ModelProvider } from '@purista/harness';

import type { HarnessExecutionConfiguration } from '../../../platform/harness/audit-harness.js';
import { createStableId } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import type { AuditCheckpointExecution } from '../../audit-execution/audit.schema.js';
import type { EvidenceMap } from '../../audit-execution/evidence-map/contract.js';
import type { SourcePostureRequest } from '../../audit-execution/phase-input/contract.js';
import type { SourcePosture } from '../../audit-execution/source-posture/contract.js';
import { SourcePostureSchema } from '../../audit-execution/source-posture/contract.js';
import { verifySourcePosture } from '../../audit-execution/source-posture/verify.js';
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
  evidenceMapFactIsWithinRecoveryScope,
  invalidModelOutput,
  runScopedModelStage,
  type ScopedModelStageOverflowTopologyBase,
  scopedInspectionRequirement,
} from '../../review-workflow/stage-lifecycle/index.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type { SourcePostureModelOutput } from './agent/contract.js';

/** Candidate-blind source assessment between neutral mapping and investigation. */
export async function runSourcePostureStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: SourcePostureRequest;
  context: readonly ContextDocument[];
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  cacheRoutingEnabled: boolean;
  overflowTopology?: ScopedModelStageOverflowTopologyBase &
    Readonly<{
      priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<SourcePosture>[];
      onRecoveredLeafCompleted?: (input: {
        childKey: string;
        scope: ContextRecoveryScope;
        scopeFingerprint: string;
        execution: AuditCheckpointExecution;
        output: SourcePosture;
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
              output: SourcePosture;
            }) => {
              assertSourcePostureWithinScope(leaf.output, input.request.evidenceMap, leaf.scope);
              await onRecoveredLeafCompleted({
                childKey: leaf.childKey,
                scope: leaf.scope,
                scopeFingerprint: leaf.scopeFingerprint,
                execution: leaf.execution,
                output: leaf.output,
              });
            },
          }),
    };
  })();
  return runScopedModelStage<SourcePosture, SourcePostureModelOutput>({
    stage: 'source-posture',
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
      session.workflows.assess_vector_source_posture.prompt({
        ...input.request,
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        retryGuidance,
      }),
    projectOutput: (output) => {
      const verified = verifySourcePosture(input.request.vector, output, input.request.evidenceMap);
      if (verified.rejectedAssessmentCount > 0) {
        invalidModelOutput(['assessments']);
      }
      return verified.sourcePosture;
    },
    reduceRecoveredOutputs: (leaves) =>
      SourcePostureSchema.parse({
        assessments: input.request.vector.reviewObligations.flatMap((obligation) => {
          const assessments = leaves.flatMap((leaf) =>
            leaf.output.assessments.filter(
              (assessment) => assessment.obligationId === obligation.obligationId,
            ),
          );
          if (assessments.length === 0) return [];
          const conclusions = new Set(assessments.map((assessment) => assessment.conclusion));
          return [
            {
              assessmentId: createStableId(
                'posture',
                `${input.request.vector.vectorId}\0${obligation.obligationId}`,
              ),
              obligationId: obligation.obligationId,
              conclusion:
                conclusions.size === 1
                  ? (assessments[0]?.conclusion ?? 'inconclusive')
                  : 'inconclusive',
              notApplicableReason:
                conclusions.size === 1 && assessments[0]?.conclusion === 'not-applicable'
                  ? (assessments[0]?.notApplicableReason ?? null)
                  : null,
              evidenceMapFactIds: uniqueSorted(
                assessments.flatMap((assessment) => assessment.evidenceMapFactIds),
              ),
              limitations: uniqueSorted([
                ...assessments.flatMap((assessment) => assessment.limitations),
                ...(conclusions.size === 1
                  ? []
                  : ['Approved-scope context recovery produced non-unanimous source posture.']),
              ]),
            },
          ];
        }),
        limitations: uniqueSorted([
          ...leaves.flatMap((leaf) => leaf.output.limitations),
          'The provider context window required deterministic approved-scope recovery.',
        ]),
      }),
  });
}

/** A recovery child may retain only map evidence it could have inspected. */
function assertSourcePostureWithinScope(
  sourcePosture: Pick<SourcePosture, 'assessments'>,
  evidenceMap: EvidenceMap,
  scope: Pick<ContextRecoveryScope, 'sourcePaths' | 'lineRanges'>,
): void {
  const facts = new Map(evidenceMap.facts.map((fact) => [fact.factId, fact] as const));
  for (const assessment of sourcePosture.assessments) {
    for (const factId of assessment.evidenceMapFactIds) {
      const fact = facts.get(factId);
      if (fact === undefined || !evidenceMapFactIsWithinRecoveryScope(fact, scope)) {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'A recovery source-posture artifact references evidence outside its exact approved scope.',
        );
      }
    }
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
