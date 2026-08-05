import { expect, test } from 'bun:test';

import { CliCommandResultSchema, usesJsonResult } from './command-result.js';

test('accepts a source-free, jail-relative JSON command result only', () => {
  expect(
    CliCommandResultSchema.parse({
      schemaVersion: 1,
      command: 'plan',
      status: 'completed',
      exitCode: 0,
      exitMeaning: 'completed-no-accepted-findings',
      identifiers: { runId: 'plan-run-01', planId: 'plan-output-01' },
      artifacts: [
        { kind: 'plan-json', path: 'plans/plan-output-01.json' },
        { kind: 'plan-markdown', path: 'plans/plan-output-01.md' },
      ],
    }).artifacts,
  ).toHaveLength(2);
  expect(
    CliCommandResultSchema.safeParse({
      schemaVersion: 1,
      command: 'plan',
      status: 'completed',
      exitCode: 0,
      exitMeaning: 'completed-no-accepted-findings',
      identifiers: {},
      artifacts: [{ kind: 'plan-json', path: '../source.ts' }],
    }).success,
  ).toBe(false);
  expect(usesJsonResult({ 'result-format': 'json' })).toBe(true);
  expect(usesJsonResult({})).toBe(false);
});

test('accepts a source-free partial guidance recovery result', () => {
  expect(() =>
    CliCommandResultSchema.parse({
      schemaVersion: 1,
      command: 'guidance',
      status: 'partial',
      exitCode: 0,
      exitMeaning: 'completed-no-accepted-findings',
      identifiers: {
        runId: 'guidance-run-01',
        planId: 'plan-01',
        reportId: 'report-01',
        guidanceId: 'guidance-01',
      },
      artifacts: [
        {
          kind: 'guidance-checkpoint',
          path: 'guidance-checkpoints/guidance-01.json',
        },
      ],
    }),
  ).not.toThrow();
});
