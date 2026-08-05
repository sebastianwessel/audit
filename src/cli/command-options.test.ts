import { expect, test } from 'bun:test';

import { assertValidCommandOptions } from './command-options.js';

test('accepts only the declared option set for each CLI command', () => {
  expect(() =>
    assertValidCommandOptions('plan', {
      target: 'target',
    }),
  ).not.toThrow();
  expect(() =>
    assertValidCommandOptions('plan-reseal', {
      plan: 'plans/plan.json',
      draft: 'plan-drafts/review.json',
    }),
  ).not.toThrow();
  expect(() =>
    assertValidCommandOptions('plan', {
      'run-id': 'plan-recovery-01',
      resume: 'true',
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
  expect(() =>
    assertValidCommandOptions('guidance', {
      target: 'target',
      plan: 'plans/plan.json',
      report: 'reports/report.json',
      'run-id': 'guidance-run-001',
      resume: 'true',
      'retry-unfinished': 'true',
    }),
  ).not.toThrow();
  expect(() =>
    assertValidCommandOptions('report', {
      report: 'reports/audit.json',
    }),
  ).not.toThrow();
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
  expect(() => assertValidCommandOptions('plan', {})).toThrow('Invalid value for --target');
  expect(() =>
    assertValidCommandOptions('plan', {
      'run-id': 'plan-recovery-01',
      resume: 'true',
      target: 'x',
    }),
  ).toThrow('Invalid value for --target');
  expect(() =>
    assertValidCommandOptions('plan-reseal', {
      'run-id': 'plan-reseal-recovery-01',
      resume: 'true',
      plan: 'x',
    }),
  ).toThrow('Invalid value for --plan');
  expect(() =>
    assertValidCommandOptions('plan-reseal', {
      'run-id': 'plan-reseal-recovery-01',
      resume: 'true',
    }),
  ).not.toThrow();
  expect(() =>
    assertValidCommandOptions('discard', {
      plan: 'plans/plan.json',
      'run-id': 'audit-run-01',
    }),
  ).not.toThrow();
  expect(() => assertValidCommandOptions('lock', { 'run-id': 'audit-run-01' })).not.toThrow();
  expect(() =>
    assertValidCommandOptions('lock', {
      'run-id': 'audit-run-01',
      operation: 'audit',
      release: 'true',
    }),
  ).not.toThrow();
});

test('rejects unknown and command-incompatible CLI options before I/O', () => {
  expect(() => assertValidCommandOptions('plan', { target: 'target', typo: 'value' })).toThrow(
    'Unknown option --typo',
  );
  expect(() => assertValidCommandOptions('plan', { target: 'target', output: 'output' })).toThrow(
    'Unknown option --output',
  );
  for (const option of [
    'work',
    'public-output',
    'provider',
    'model',
    'api-key-env',
    'max-parallel-vectors',
    'max-estimated-cost-usd',
  ]) {
    expect(() =>
      assertValidCommandOptions('plan', {
        target: 'target',
        [option]: 'value',
      }),
    ).toThrow(`Unknown option --${option}`);
  }
  expect(() => assertValidCommandOptions('audit', { target: 'target' })).toThrow(
    'Missing required option --plan',
  );
  expect(() =>
    assertValidCommandOptions('report', {
      report: 'reports/audit.json',
      provider: 'openai',
    }),
  ).toThrow('Unknown option --provider');
  expect(() =>
    assertValidCommandOptions('lineage', {
      previous: 'reports/previous.json',
      current: 'reports/current.json',
      resume: 'true',
    }),
  ).toThrow('Unknown option --resume');
  expect(() => assertValidCommandOptions('plan-draft', { plan: 'plans/plan.json' })).toThrow(
    'Missing required option --draft',
  );
  expect(() =>
    assertValidCommandOptions('plan-draft', {
      plan: 'plans/plan.json',
      draft: 'plan-drafts/review.json',
      resume: 'true',
    }),
  ).toThrow('Unknown option --resume');
  expect(() =>
    assertValidCommandOptions('plan-reseal', {
      plan: 'plans/plan.json',
      draft: 'plan-drafts/review.json',
      provider: 'openai',
    }),
  ).toThrow('Unknown option --provider');
  expect(() =>
    assertValidCommandOptions('discard', {
      plan: 'plans/plan.json',
    }),
  ).toThrow('Missing required option --run-id');
  expect(() =>
    assertValidCommandOptions('discard', {
      target: 'target',
      plan: 'plans/plan.json',
      'run-id': 'audit-run-01',
    }),
  ).toThrow('Unknown option --target');
  expect(() => assertValidCommandOptions('lock', {})).toThrow('Missing required option --run-id');
  expect(() =>
    assertValidCommandOptions('lock', { 'run-id': 'audit-run-01', release: 'true' }),
  ).toThrow('Invalid value for --operation');
  expect(() =>
    assertValidCommandOptions('lock', { 'run-id': 'audit-run-01', operation: 'audit' }),
  ).toThrow('Invalid value for --release');
  expect(() =>
    assertValidCommandOptions('lock', { 'run-id': 'audit-run-01', 'private-work': 'elsewhere' }),
  ).toThrow('Unknown option --private-work');
});
