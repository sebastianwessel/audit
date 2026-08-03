import type { ModelProvider } from '@purista/harness';
import type { HarnessExecutionConfiguration } from '../../../platform/harness/security-reviewer-harness.js';
import type { AuditVerificationRequest } from '../../audit-execution/verification/contract.js';
import { terminalLaneForVerificationDecision } from '../../audit-execution/verification/contract.js';
import { createVerificationEvidenceSelectionBasis } from '../../audit-execution/verification/evidence-basis.js';
import { materializeVerificationResult } from '../../audit-execution/verification/materialize.js';
import {
  hasSuccessfulScopedSourceInspection,
  type ModelCostCeiling,
  type ModelPricing,
} from '../../model-operations/model-operations.js';
import type { ModelRoute } from '../../model-operations/model-operations.schema.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type { ContextRecoveryScope } from '../runtime/context-overflow.js';
import { scopedInspectionRequirement } from '../tools/contract.js';
import { runScopedModelStage } from './scoped-model-stage.js';

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
}) {
  const stageResult = await runScopedModelStage({
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
    requireScopedSourceInspection: true,
    invoke: (session, _attempt, scope: ContextRecoveryScope) =>
      session.workflows.verify_hypothesis.prompt({
        ...input.request,
        evidenceSelectionBasis: createVerificationEvidenceSelectionBasis(input.request),
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
      }),
  });
  if (stageResult.status === 'completed') {
    const result = materializeVerificationResult(
      stageResult.output,
      input.request.hypothesis,
      input.request.evidenceMap,
      input.request.sourcePosture,
    );
    if (result === undefined) {
      return {
        decision: 'incomplete' as const,
        reason: 'The verifier selected invalid map evidence.',
        verifiedEvidence: null,
        verifiedPlanObligations: [],
        controlAssessment: null,
        obligationReconciliations: [],
        postureReconciliations: [],
        modelObservation: stageResult.modelObservation,
        terminalLane: 'evidence-projection-invalid' as const,
      };
    }
    const accessedSource = hasSuccessfulScopedSourceInspection(stageResult.toolUsage);
    return {
      ...(result.decision === 'accepted' && !accessedSource
        ? {
            decision: 'incomplete' as const,
            reason: 'The verifier accepted without inspecting scoped source evidence.',
            verifiedEvidence: null,
            verifiedPlanObligations: [],
            controlAssessment: null,
            obligationReconciliations: [],
            postureReconciliations: [],
            terminalLane: 'inspection-missing' as const,
          }
        : { ...result, terminalLane: terminalLaneForVerificationDecision(result.decision) }),
      modelObservation: stageResult.modelObservation,
    };
  }
  return {
    decision: 'incomplete' as const,
    reason: 'The independent verifier did not complete.',
    verifiedEvidence: null,
    verifiedPlanObligations: [],
    controlAssessment: null,
    obligationReconciliations: [],
    postureReconciliations: [],
    modelObservation: stageResult.modelObservation,
    terminalLane: 'stage-failed' as const,
  };
}
