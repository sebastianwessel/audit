import { expect, test } from 'bun:test';

import { assertResumableRunOptions } from './input.js';

test('requires explicit resume before retrying unfinished work', () => {
  expect(() =>
    assertResumableRunOptions({
      resume: false,
      retryUnfinished: true,
      hasRunId: false,
      command: 'an audit',
    }),
  ).toThrow('Retrying unfinished an audit requires --resume true');
  expect(() =>
    assertResumableRunOptions({
      resume: true,
      retryUnfinished: false,
      hasRunId: false,
      command: 'an audit',
    }),
  ).toThrow('Resuming an audit requires an explicit --run-id');
  expect(() =>
    assertResumableRunOptions({
      resume: true,
      retryUnfinished: true,
      hasRunId: true,
      command: 'an audit',
    }),
  ).not.toThrow();
});
