import { auditWorkflowStructuredOutputRegistry } from '../../src/platform/harness/audit-harness.js';
import { defineStructuredOutputContractRegistry } from '../../src/platform/harness/structured-output-compatibility.js';

import { PlanSemanticModelOutputSchema } from './plan-semantic-agent.contract.js';
import { StageIsolatedAdjudicationModelOutputSchema } from './stage-isolated-adjudication-agent.contract.js';

export const planSemanticStructuredOutputRegistry = defineStructuredOutputContractRegistry({
  registryId: 'audit-plan-semantic-evaluator',
  outputs: [{ outputId: 'plan-semantic-adjudication', schema: PlanSemanticModelOutputSchema }],
});

export const stageIsolatedStructuredOutputRegistry = defineStructuredOutputContractRegistry({
  registryId: 'audit-stage-isolated-evaluator',
  outputs: [
    {
      outputId: 'stage-isolated-adjudication',
      schema: StageIsolatedAdjudicationModelOutputSchema,
    },
  ],
});

export function providerEvaluationStructuredOutputRegistry(includePlanSemanticEvaluator: boolean) {
  if (!includePlanSemanticEvaluator) return auditWorkflowStructuredOutputRegistry;
  return defineStructuredOutputContractRegistry({
    registryId: 'audit-provider-evaluation-with-plan-semantics',
    outputs: [
      ...auditWorkflowStructuredOutputRegistry.outputs,
      ...planSemanticStructuredOutputRegistry.outputs,
    ],
  });
}
