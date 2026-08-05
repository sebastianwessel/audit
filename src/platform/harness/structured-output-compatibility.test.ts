import { expect, test } from 'bun:test';
import { z } from 'zod';

import { UnverifiedAuditVerificationResultSchema } from '../../features/audit-execution/verification/contract.js';
import {
  assertLiveHarnessStructuredOutputCompatibility,
  auditWorkflowStructuredOutputRegistry,
  auditWorkflowStructuredOutputs,
} from './audit-harness.js';
import {
  assertProviderStructuredOutputCompatibility,
  ProviderStructuredOutputCompatibilityError,
  serializeHarnessStructuredOutput,
  structuredOutputContractsFingerprint,
  validateProviderStructuredOutputs,
} from './structured-output-compatibility.js';

test('serializes every product workflow output exactly as the Purista agent loop does', () => {
  for (const output of auditWorkflowStructuredOutputs) {
    expect(serializeHarnessStructuredOutput(output.schema)).toEqual(z.toJSONSchema(output.schema));
  }
});

test('accepts every live product workflow output for declared OpenAI and Anthropic profiles', () => {
  for (const provider of ['openai', 'anthropic']) {
    const compatibility = validateProviderStructuredOutputs({
      provider,
      outputs: auditWorkflowStructuredOutputs,
    });
    expect(compatibility.compatible).toBeTrue();
    expect(compatibility.outputs).toHaveLength(auditWorkflowStructuredOutputs.length);
    expect(compatibility.outputs.every((output) => output.failure === null)).toBeTrue();
  }
});

test('validates a declared live output registry through the central platform gate', () => {
  for (const provider of ['openai', 'anthropic']) {
    const compatibility = assertLiveHarnessStructuredOutputCompatibility({
      provider,
      registry: auditWorkflowStructuredOutputRegistry,
    });
    expect(compatibility.compatible).toBeTrue();
    expect(compatibility.outputs.map((output) => output.outputId)).toContain('verification');
  }
});

test('rejects the former top-level verifier union as OpenAI root composition', () => {
  const compatibility = validateProviderStructuredOutputs({
    provider: 'openai',
    outputs: [
      { outputId: 'pre-envelope-verification', schema: UnverifiedAuditVerificationResultSchema },
    ],
  });

  expect(compatibility).toMatchObject({
    profile: 'openai-responses-v1',
    compatible: false,
    outputs: [
      {
        outputId: 'pre-envelope-verification',
        compatible: false,
        failure: {
          code: 'provider-output-schema-incompatible',
          reason: 'root-composition',
        },
      },
    ],
  });
});

test('rejects an undeclared route profile without attempting a provider operation', () => {
  const schema = z.strictObject({ result: z.string() });
  const compatibility = validateProviderStructuredOutputs({
    provider: 'undeclared-provider',
    outputs: [{ outputId: 'fixture-output', schema }],
  });

  expect(compatibility).toMatchObject({
    profile: null,
    compatible: false,
    outputs: [
      {
        failure: {
          code: 'provider-output-schema-incompatible',
          reason: 'profile-undeclared',
        },
      },
    ],
  });
  try {
    assertProviderStructuredOutputCompatibility({
      provider: 'undeclared-provider',
      outputs: [{ outputId: 'fixture-output', schema }],
    });
    throw new Error('Expected undeclared profile to fail closed.');
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderStructuredOutputCompatibilityError);
    if (!(error instanceof ProviderStructuredOutputCompatibilityError)) throw error;
    expect(error.code).toBe('provider-output-schema-incompatible');
  }
});

test('allows an OpenAI nested decision union inside an object root', () => {
  const compatibility = validateProviderStructuredOutputs({
    provider: 'openai',
    outputs: [
      {
        outputId: 'nested-union',
        schema: z.strictObject({ result: z.union([z.literal('accepted'), z.literal('rejected')]) }),
      },
    ],
  });

  expect(compatibility.compatible).toBeTrue();
});

test('changes the transport identity when a dispatchable output contract changes', () => {
  const first = structuredOutputContractsFingerprint([
    { outputId: 'fixture-output', schema: z.strictObject({ result: z.string() }) },
  ]);
  const second = structuredOutputContractsFingerprint([
    { outputId: 'fixture-output', schema: z.strictObject({ result: z.number() }) },
  ]);

  expect(first).not.toBe(second);
});
