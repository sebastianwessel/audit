import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/audit-harness.js';
import type {
  AuditVerificationRequest,
  AuditVerificationResult,
} from '../../audit-execution/verification/contract.js';
import { terminalLaneForVerificationDecision } from '../../audit-execution/verification/contract.js';
import { createVerificationEvidenceSelectionBasis } from '../../audit-execution/verification/evidence-basis.js';
import { materializeVerificationResult } from '../../audit-execution/verification/materialize.js';
import {
  hasSuccessfulScopedSourceInspection,
  type ModelCostCeiling,
  type ModelPricing,
  type ModelStageObservation,
} from '../../model-operations/model-operations.js';
import type { ModelRoute } from '../../model-operations/model-operations.schema.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type { VerificationModelOutput } from '../agents/verification/contract.js';
import type { ContextRecoveryScope } from '../runtime/context-overflow.js';
import { scopedInspectionRequirement } from '../tools/contract.js';
import {
  type EvaluatorFailureDiagnosticSink,
  runScopedModelStage,
  type ScopedModelStageOverflowTopologyBase,
} from './scoped-model-stage.js';

type CanonicalVerificationStageOutput = Readonly<{
  result: AuditVerificationResult;
  terminalLane:
    | 'evidence-projection-invalid'
    | ReturnType<typeof terminalLaneForVerificationDecision>;
}>;

/** Executes only the verifier's scoped challenge and fails closed when it did not inspect source. */
export async function runVerificationStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: AuditVerificationRequest;
  context: readonly ContextDocument[];
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  modelCostCeiling?: ModelCostCeiling;
  cacheRoutingEnabled: boolean;
  route?: ModelRoute;
  overflowTopology?: ScopedModelStageOverflowTopologyBase;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
  onCompletedModelObservation?: (observation: ModelStageObservation) => void;
}) {
  const stageResult = await runScopedModelStage<
    CanonicalVerificationStageOutput,
    VerificationModelOutput
  >({
    stage: 'verification',
    route: input.route ?? 'primary',
    stageId: input.request.verificationId,
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
    evaluatorFailureDiagnosticSink: input.evaluatorFailureDiagnosticSink,
    onCompletedModelObservation: input.onCompletedModelObservation,
    ...(input.overflowTopology === undefined ? {} : { overflowTopology: input.overflowTopology }),
    requireScopedSourceInspection: true,
    allowScopeSplitting: false,
    invoke: (session, _attempt, scope: ContextRecoveryScope, retryGuidance) =>
      session.workflows.verify_hypothesis.prompt({
        ...input.request,
        evidenceSelectionBasis: createVerificationEvidenceSelectionBasis(input.request),
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        retryGuidance,
      }),
    projectOutput: (output) => {
      const result = materializeVerificationResult(
        output.result,
        input.request.hypothesis,
        input.request.evidenceMap,
        input.request.sourcePosture,
      );
      return result === undefined
        ? {
            result: incompleteVerificationResult(),
            terminalLane: 'evidence-projection-invalid',
          }
        : { result, terminalLane: terminalLaneForVerificationDecision(result.decision) };
    },
  });
  if (stageResult.status === 'completed') {
    const { result, terminalLane } = stageResult.output;
    const accessedSource = hasSuccessfulScopedSourceInspection(stageResult.toolUsage);
    return {
      ...(result.decision === 'accepted' && !accessedSource
        ? {
            ...incompleteVerificationResult(),
            terminalLane: 'inspection-missing' as const,
          }
        : { ...result, terminalLane }),
      modelObservation: stageResult.modelObservation,
    };
  }
  return {
    ...incompleteVerificationResult(),
    modelObservation: stageResult.modelObservation,
    terminalLane: 'stage-failed' as const,
  };
}

/** One strict source-minimal incomplete result for every verifier-owned non-verdict path. */
function incompleteVerificationResult(): AuditVerificationResult {
  return {
    decision: 'incomplete',
    reasonCode: 'output-invalid',
    claimEvidenceBundles: null,
    contradictionEvidence: null,
    inspectedEvidence: [],
    verifiedPlanObligations: [],
    affectedPlanObligations: [],
    controlAssessment: null,
    obligationReconciliations: [],
    postureReconciliations: [],
  };
}
