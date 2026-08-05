import { expect, test } from 'bun:test';

import { MaxParallelVectorsSchema } from './concurrency.js';

test('accepts only the configured queue-capacity boundaries', () => {
  expect(MaxParallelVectorsSchema.safeParse(1).success).toBe(true);
  expect(MaxParallelVectorsSchema.safeParse(128).success).toBe(true);
  expect(MaxParallelVectorsSchema.safeParse(0).success).toBe(false);
  expect(MaxParallelVectorsSchema.safeParse(1.5).success).toBe(false);
});
