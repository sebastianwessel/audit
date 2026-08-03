import { z } from 'zod';

/** Shared source-free lifecycle for provider-backed evaluator command checkpoints. */
export const ProviderCommandCheckpointStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type ProviderCommandCheckpointStatus = z.infer<typeof ProviderCommandCheckpointStatusSchema>;

/** Applies the same terminal-state invariant to each feature-owned error-code vocabulary. */
export function validateProviderCommandCheckpointLifecycle<TErrorCode extends string>(
  input: Readonly<{
    status: ProviderCommandCheckpointStatus;
    errorCode: TErrorCode | null;
  }>,
  context: z.RefinementCtx,
  codes: Readonly<{
    cancelled: TErrorCode;
    failed: TErrorCode;
  }>,
): void {
  if ((input.status === 'running' || input.status === 'completed') && input.errorCode !== null) {
    context.addIssue({
      code: 'custom',
      path: ['errorCode'],
      message: 'Running and completed command checkpoints cannot carry a terminal error code.',
    });
  }
  if (input.status === 'cancelled' && input.errorCode !== codes.cancelled) {
    context.addIssue({
      code: 'custom',
      path: ['errorCode'],
      message: 'A cancelled command checkpoint requires its configured cancellation code.',
    });
  }
  if (input.status === 'failed' && input.errorCode !== codes.failed) {
    context.addIssue({
      code: 'custom',
      path: ['errorCode'],
      message: 'A failed command checkpoint requires its configured failure code.',
    });
  }
}
