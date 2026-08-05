import { expect, test } from 'bun:test';

import { validateProviderStructuredOutputs } from '../../src/platform/harness/structured-output-compatibility.js';

import {
  planSemanticStructuredOutputRegistry,
  providerEvaluationStructuredOutputRegistry,
  stageIsolatedStructuredOutputRegistry,
} from './structured-output-registry.js';

test('declares every evaluator-only model output through the shared provider profile validator', () => {
  for (const registry of [
    planSemanticStructuredOutputRegistry,
    stageIsolatedStructuredOutputRegistry,
    providerEvaluationStructuredOutputRegistry(true),
  ]) {
    const compatibility = validateProviderStructuredOutputs({
      provider: 'openai',
      outputs: registry.outputs,
    });
    expect(compatibility.compatible).toBeTrue();
    expect(compatibility.outputs).toHaveLength(registry.outputs.length);
  }
});
