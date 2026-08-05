import { z } from 'zod';

import { Sha256Schema, sha256 } from '../../shared/contracts/core.js';

/**
 * Provider transport profiles are intentionally versioned. A route without a
 * declared profile is incompatible until the adapter capability is reviewed.
 */
export const ProviderStructuredOutputProfileSchema = z.enum([
  'openai-responses-v1',
  'anthropic-tool-v1',
]);

export const ProviderStructuredOutputIncompatibilityReasonSchema = z.enum([
  'profile-undeclared',
  'root-not-object',
  'root-composition',
]);

export const ProviderStructuredOutputCompatibilityFailureSchema = z.strictObject({
  code: z.literal('provider-output-schema-incompatible'),
  reason: ProviderStructuredOutputIncompatibilityReasonSchema,
});

export const ProviderStructuredOutputCompatibilityOutputSchema = z
  .strictObject({
    outputId: z.string().trim().min(1),
    schemaFingerprint: Sha256Schema,
    compatible: z.boolean(),
    failure: ProviderStructuredOutputCompatibilityFailureSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.compatible === (value.failure !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Compatibility and failure must agree.',
      });
    }
  });

/** Content-free transport readiness for one provider route and output set. */
export const ProviderStructuredOutputCompatibilitySchema = z.strictObject({
  profile: ProviderStructuredOutputProfileSchema.nullable(),
  compatibilityFingerprint: Sha256Schema,
  compatible: z.boolean(),
  outputs: z.array(ProviderStructuredOutputCompatibilityOutputSchema),
});

export type ProviderStructuredOutputProfile = z.infer<typeof ProviderStructuredOutputProfileSchema>;
export type ProviderStructuredOutputCompatibility = z.infer<
  typeof ProviderStructuredOutputCompatibilitySchema
>;

/**
 * Stable identity for the provider-profile rules. The selected provider is
 * persisted separately with a checkpoint; this value makes local capability
 * rule changes invalidate old workflow protocol bindings.
 */
export const providerStructuredOutputCompatibilityProtocolFingerprint = sha256(
  JSON.stringify({
    version: 1,
    profiles: {
      'openai-responses-v1': {
        rootType: 'object',
        forbiddenRootComposition: ['oneOf', 'anyOf', 'allOf'],
      },
      'anthropic-tool-v1': {
        rootType: 'object',
        forbiddenRootComposition: [],
      },
    },
  }),
);

/** One live harness output contract. Its Zod schema is never persisted or reported. */
export type StructuredOutputContract = Readonly<{
  outputId: string;
  schema: z.ZodType;
}>;

/**
 * One feature-owned declaration of every output a live harness can dispatch.
 * The platform owns validation and identity; feature modules retain their
 * canonical schemas and register them at the harness boundary.
 */
export type StructuredOutputContractRegistry = Readonly<{
  registryId: string;
  outputs: readonly StructuredOutputContract[];
}>;

export function defineStructuredOutputContractRegistry(input: {
  registryId: string;
  outputs: readonly StructuredOutputContract[];
}): StructuredOutputContractRegistry {
  const registryId = input.registryId.trim();
  if (registryId.length === 0) throw new Error('A structured-output registry needs an identifier.');
  if (input.outputs.length === 0) throw new Error('A structured-output registry cannot be empty.');
  const outputs = input.outputs.map((output) => Object.freeze({ ...output }));
  if (new Set(outputs.map((output) => output.outputId)).size !== outputs.length) {
    throw new Error('A structured-output registry cannot declare an output more than once.');
  }
  return Object.freeze({ registryId, outputs: Object.freeze(outputs) });
}

/**
 * Resolves the adapter profile without constructing a provider or reading any
 * model configuration. Unknown providers intentionally have no profile.
 */
export function providerStructuredOutputProfile(
  provider: string,
): ProviderStructuredOutputProfile | undefined {
  if (provider === 'openai') return 'openai-responses-v1';
  if (provider === 'anthropic') return 'anthropic-tool-v1';
  return undefined;
}

/**
 * Serializes exactly as Purista's default agent loop does before passing an
 * object request to an adapter: `z.toJSONSchema(outputSchema)`.
 */
export function serializeHarnessStructuredOutput(schema: z.ZodType) {
  return z.toJSONSchema(schema);
}

/** Binds a workflow protocol to its exact dispatchable transport contracts. */
export function structuredOutputContractsFingerprint(
  outputs: readonly StructuredOutputContract[],
): string {
  return sha256(
    JSON.stringify({
      providerStructuredOutputCompatibilityProtocolFingerprint,
      outputs: outputs.map((output) => ({
        outputId: output.outputId,
        schemaFingerprint: schemaFingerprint(serializeHarnessStructuredOutput(output.schema)),
      })),
    }),
  );
}

/** Stable exact identity of a named live-harness output registry. */
export function structuredOutputContractRegistryFingerprint(
  registry: StructuredOutputContractRegistry,
): string {
  return sha256(
    JSON.stringify({
      registryId: registry.registryId,
      contractsFingerprint: structuredOutputContractsFingerprint(registry.outputs),
    }),
  );
}

/**
 * Checks only provider JSON-Schema transport constraints. It does not inspect
 * model data, source files, prompts, providers, or the network.
 */
export function validateProviderStructuredOutputs(input: {
  provider: string;
  outputs: readonly StructuredOutputContract[];
}): ProviderStructuredOutputCompatibility {
  const profile = providerStructuredOutputProfile(input.provider);
  const outputs = input.outputs.map((output) => {
    const schema = serializeHarnessStructuredOutput(output.schema);
    const failure = structuredOutputCompatibilityFailure(profile, schema);
    return ProviderStructuredOutputCompatibilityOutputSchema.parse({
      outputId: output.outputId,
      schemaFingerprint: schemaFingerprint(schema),
      compatible: failure === null,
      failure,
    });
  });
  const compatible = outputs.every((output) => output.compatible);
  return ProviderStructuredOutputCompatibilitySchema.parse({
    profile: profile ?? null,
    compatibilityFingerprint: sha256(
      JSON.stringify({
        profile: profile ?? null,
        outputs: outputs.map((output) => ({
          outputId: output.outputId,
          schemaFingerprint: output.schemaFingerprint,
          compatible: output.compatible,
          failure: output.failure,
        })),
      }),
    ),
    compatible,
    outputs,
  });
}

/** Rejects a route before any source, target, provider, or artifact operation. */
export function assertProviderStructuredOutputCompatibility(input: {
  provider: string;
  outputs: readonly StructuredOutputContract[];
}): ProviderStructuredOutputCompatibility {
  const compatibility = validateProviderStructuredOutputs(input);
  if (!compatibility.compatible) {
    throw new ProviderStructuredOutputCompatibilityError(compatibility);
  }
  return compatibility;
}

/** The single registry-aware compatibility gate used by every live harness. */
export function assertProviderStructuredOutputRegistryCompatibility(input: {
  provider: string;
  registry: StructuredOutputContractRegistry;
}): ProviderStructuredOutputCompatibility {
  return assertProviderStructuredOutputCompatibility({
    provider: input.provider,
    outputs: input.registry.outputs,
  });
}

/** Content-free failure used at the configuration/preflight boundary. */
export class ProviderStructuredOutputCompatibilityError extends Error {
  public readonly code = 'provider-output-schema-incompatible';
  public readonly compatibility: ProviderStructuredOutputCompatibility;

  public constructor(compatibility: ProviderStructuredOutputCompatibility) {
    super('The configured provider route cannot accept one or more structured output schemas.');
    this.name = 'ProviderStructuredOutputCompatibilityError';
    this.compatibility = compatibility;
  }
}

function structuredOutputCompatibilityFailure(
  profile: ProviderStructuredOutputProfile | undefined,
  schema: ReturnType<typeof serializeHarnessStructuredOutput>,
): z.infer<typeof ProviderStructuredOutputCompatibilityFailureSchema> | null {
  if (profile === undefined) {
    return { code: 'provider-output-schema-incompatible', reason: 'profile-undeclared' };
  }
  if (
    profile === 'openai-responses-v1' &&
    (schema.oneOf !== undefined || schema.anyOf !== undefined || schema.allOf !== undefined)
  ) {
    return { code: 'provider-output-schema-incompatible', reason: 'root-composition' };
  }
  if (schema.type !== 'object') {
    return { code: 'provider-output-schema-incompatible', reason: 'root-not-object' };
  }
  return null;
}

function schemaFingerprint(schema: ReturnType<typeof serializeHarnessStructuredOutput>): string {
  const serialized = JSON.stringify(schema);
  if (serialized === undefined) throw new Error('A Zod JSON schema must be serializable.');
  return sha256(serialized);
}
