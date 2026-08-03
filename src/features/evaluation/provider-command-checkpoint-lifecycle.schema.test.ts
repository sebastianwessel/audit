import { expect, test } from 'bun:test';
import { z } from 'zod';

import {
  ProviderCommandCheckpointStatusSchema,
  validateProviderCommandCheckpointLifecycle,
} from './provider-command-checkpoint-lifecycle.schema.js';

const lifecycleSchema = z
  .strictObject({
    status: ProviderCommandCheckpointStatusSchema,
    errorCode: z.enum(['provider-cancelled', 'fixture-failed']).nullable(),
  })
  .superRefine((checkpoint, context) =>
    validateProviderCommandCheckpointLifecycle(checkpoint, context, {
      cancelled: 'provider-cancelled',
      failed: 'fixture-failed',
    }),
  );

test('accepts only lifecycle states with their exact terminal error code', () => {
  expect(lifecycleSchema.parse({ status: 'running', errorCode: null })).toEqual({
    status: 'running',
    errorCode: null,
  });
  expect(lifecycleSchema.parse({ status: 'completed', errorCode: null })).toEqual({
    status: 'completed',
    errorCode: null,
  });
  expect(lifecycleSchema.parse({ status: 'cancelled', errorCode: 'provider-cancelled' })).toEqual({
    status: 'cancelled',
    errorCode: 'provider-cancelled',
  });
  expect(lifecycleSchema.parse({ status: 'failed', errorCode: 'fixture-failed' })).toEqual({
    status: 'failed',
    errorCode: 'fixture-failed',
  });
});

test('rejects missing, mismatched, or non-terminal checkpoint errors', () => {
  expect(() => lifecycleSchema.parse({ status: 'running', errorCode: 'fixture-failed' })).toThrow(
    'cannot carry a terminal error code',
  );
  expect(() => lifecycleSchema.parse({ status: 'cancelled', errorCode: 'fixture-failed' })).toThrow(
    'cancellation code',
  );
  expect(() => lifecycleSchema.parse({ status: 'failed', errorCode: null })).toThrow(
    'failure code',
  );
});
