import { z } from 'zod';

/** `0` explicitly disables a harness deadline; positive values are milliseconds. */
export const TimeoutMillisecondsSchema = z.number().int().nonnegative();

/** CLI boundary companion for timeout values. Keep coercion out of persisted contracts. */
export const TimeoutMillisecondsOptionSchema = z.coerce.number().pipe(TimeoutMillisecondsSchema);

/**
 * Shared execution policy for all model-backed product and evaluator stages.
 * It is dependency-free so persisted evaluator contracts cannot initialize a
 * live harness while their schemas are loading.
 */
export const HarnessExecutionConfigurationSchema = z
  .strictObject({
    runTimeoutMs: TimeoutMillisecondsSchema.default(0),
    modelTimeoutMs: TimeoutMillisecondsSchema.default(0),
    modelRetry: z.enum(['default', 'disabled']).default('default'),
  })
  .superRefine((value, context) => {
    if (
      value.runTimeoutMs > 0 &&
      value.modelTimeoutMs > 0 &&
      value.runTimeoutMs < value.modelTimeoutMs
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runTimeoutMs'],
        message: 'runTimeoutMs must be at least modelTimeoutMs.',
      });
    }
  });

export type HarnessExecutionConfiguration = z.infer<typeof HarnessExecutionConfigurationSchema>;
