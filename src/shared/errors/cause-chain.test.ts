import { expect, test } from 'bun:test';

import { errorCauseChain } from './cause-chain.js';

test('walks causes and every AggregateError member once', () => {
  const first = new Error('first');
  const second = new Error('second', { cause: first });
  const aggregate = new AggregateError([second, first], 'wrapped');

  expect(errorCauseChain(aggregate)).toEqual([aggregate, second, first]);
});
