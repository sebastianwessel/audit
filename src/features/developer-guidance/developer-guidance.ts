import type { ModelProvider } from '@purista/harness';

import type { HarnessExecutionConfiguration } from '../../platform/harness/audit-harness.js';
import type { ModelPricing } from '../model-operations/index.js';
import {
  runScopedModelStage,
  scopedInspectionRequirement,
} from '../review-workflow/stage-lifecycle/index.js';
import type { ContextDocument, SourceRepository } from '../target-inventory/index.js';
import type {
  DeveloperGuidanceModelInput,
  DeveloperGuidanceModelOutput,
} from './agent/contract.js';

/** Runs non-gating advice in the exact vector scope that admitted the finding. */
export async function runDeveloperGuidanceStage(input: {
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  request: Omit<DeveloperGuidanceModelInput, 'inspectionRequirement' | 'retryGuidance'>;
  context: readonly ContextDocument[];
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  cacheRoutingEnabled: boolean;
}) {
  return runScopedModelStage<DeveloperGuidanceModelOutput>({
    stage: 'developer-guidance',
    route: 'primary',
    stageId: input.request.guidanceId,
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
    requireScopedSourceInspection: true,
    // Guidance contains model-authored prose that may never enter a durable
    // checkpoint. It therefore has no lossless persisted partition reducer.
    // A provider context overflow remains explicit incomplete coverage.
    allowScopeSplitting: false,
    invoke: (session, _attempt, scope, retryGuidance) =>
      session.workflows.create_developer_guidance.prompt({
        ...input.request,
        availableSourcePaths: [...scope.sourcePaths],
        context: [...scope.context],
        inspectionRequirement: scopedInspectionRequirement(scope.sourcePaths),
        retryGuidance,
      }),
    projectOutput: (output) => output,
  });
}
