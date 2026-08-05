import { z } from 'zod';

import { sha256 } from './core.js';

/** A static model-output schema path safe to expose in evaluator-only diagnostics. */
export const ModelOutputSchemaPathLabelSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]*$/u);

/** Content-free correction basis for one rejected model output shape. */
export const OutputValidationRetryGuidanceSchema = z.strictObject({
  kind: z.literal('output-validation'),
  signature: z.string().regex(/^validation-output-[a-f0-9]{64}$/u),
  schemaPathLabels: z.array(ModelOutputSchemaPathLabelSchema).min(1),
});

/** The single retry signal shape shared by model stages and evaluator diagnostics. */
export const ModelRetryGuidanceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('initial') }),
  OutputValidationRetryGuidanceSchema,
  z.strictObject({ kind: z.literal('source-inspection') }),
]);

export type ModelRetryGuidance = z.infer<typeof ModelRetryGuidanceSchema>;
export type OutputValidationRetryGuidance = z.infer<typeof OutputValidationRetryGuidanceSchema>;

/**
 * Canonicalizes every static schema label in the failure. The exact complete
 * set is hashed for retry identity, so a later omitted label can never turn a
 * new malformed response into a false no-progress terminal state.
 */
export function outputValidationGuidanceForPaths(
  schemaPathLabels: readonly string[],
): OutputValidationRetryGuidance {
  const normalized = [...new Set(schemaPathLabels)]
    .filter((path) => ModelOutputSchemaPathLabelSchema.safeParse(path).success)
    .sort((left, right) => left.localeCompare(right));
  if (normalized.length === 0) {
    throw new Error('Model output validation requires at least one safe schema-path label.');
  }
  return OutputValidationRetryGuidanceSchema.parse({
    kind: 'output-validation',
    signature: `validation-output-${sha256(normalized.join('\0'))}`,
    schemaPathLabels: normalized,
  });
}
