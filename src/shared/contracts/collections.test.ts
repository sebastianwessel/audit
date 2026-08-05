import { expect, test } from 'bun:test';
import { uniqueSorted } from './collections.js';

test('deduplicates and deterministically orders string values', () => {
  expect(uniqueSorted(['zeta', 'alpha', 'zeta', 'beta'])).toEqual(['alpha', 'beta', 'zeta']);
});

test('preserves the declared string subtype', () => {
  const values = uniqueSorted(['accepted', 'needs-review', 'accepted'] as const);
  expect(values).toEqual(['accepted', 'needs-review']);
});
