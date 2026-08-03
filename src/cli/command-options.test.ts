import { expect, test } from 'bun:test';

import { assertValidCommandOptions } from './command-options.js';

test('accepts only the declared option set for each CLI command', () => {
  expect(() =>
    assertValidCommandOptions('plan', {
      target: 'target',
      output: 'output',
      provider: 'openai',
    }),
  ).not.toThrow();
  expect(() =>
    assertValidCommandOptions('audit', {
      target: 'target',
      plan: 'plans/plan.json',
      resume: 'true',
      'retry-unfinished': 'false',
    }),
  ).not.toThrow();
  expect(() => assertValidCommandOptions('report', { report: 'reports/audit.json' })).not.toThrow();
  expect(() =>
    assertValidCommandOptions('lineage', {
      previous: 'reports/previous.json',
      current: 'reports/current.json',
    }),
  ).not.toThrow();
  expect(() =>
    assertValidCommandOptions('plan-draft', {
      plan: 'plans/plan.json',
      draft: 'plan-drafts/review.json',
    }),
  ).not.toThrow();
  expect(() =>
    assertValidCommandOptions('plan-reseal', {
      plan: 'plans/plan.json',
      draft: 'plan-drafts/review.json',
    }),
  ).not.toThrow();
});

test('rejects unknown and command-incompatible CLI options before I/O', () => {
  expect(() => assertValidCommandOptions('plan', { target: 'target', typo: 'value' })).toThrow(
    'Invalid options',
  );
  expect(() => assertValidCommandOptions('audit', { target: 'target' })).toThrow('Invalid options');
  expect(() =>
    assertValidCommandOptions('report', { report: 'reports/audit.json', provider: 'openai' }),
  ).toThrow('Invalid options');
  expect(() =>
    assertValidCommandOptions('lineage', {
      previous: 'reports/previous.json',
      current: 'reports/current.json',
      resume: 'true',
    }),
  ).toThrow('Invalid options');
  expect(() => assertValidCommandOptions('plan-draft', { plan: 'plans/plan.json' })).toThrow(
    'Invalid options',
  );
  expect(() =>
    assertValidCommandOptions('plan-reseal', {
      plan: 'plans/plan.json',
      draft: 'plan-drafts/review.json',
      provider: 'openai',
    }),
  ).toThrow('Invalid options');
});
