import { expect, test } from 'bun:test';

import { assertWorkflowBunScripts, assertWorkflowBunVersion } from './check-ci-scripts.js';

test('accepts a CI Bun version that matches the exact package-manager declaration', () => {
  expect(() => assertWorkflowBunVersion("bun-version: '1.3.14'\n", 'bun@1.3.14')).not.toThrow();
});

test('rejects a missing or non-exact Bun package-manager declaration', () => {
  expect(() => assertWorkflowBunVersion("bun-version: '1.3.14'\n", undefined)).toThrow(
    'package.json must declare an exact Bun packageManager version',
  );
  expect(() => assertWorkflowBunVersion("bun-version: '1.3.14'\n", 'bun@>=1.3.14')).toThrow(
    'package.json must declare an exact Bun packageManager version',
  );
});

test('rejects a CI Bun version that drifts from package.json', () => {
  expect(() => assertWorkflowBunVersion("bun-version: '1.3.13'\n", 'bun@1.3.14')).toThrow(
    '.github/workflows/ci.yml must install Bun 1.3.14 from package.json',
  );
});

test('accepts literal CI Bun scripts declared by package.json', () => {
  expect(() =>
    assertWorkflowBunScripts('steps:\n  - run: bun run typecheck\n', { typecheck: 'tsc --noEmit' }),
  ).not.toThrow();
});

test('rejects a literal CI Bun script absent from package.json', () => {
  expect(() => assertWorkflowBunScripts('steps:\n  - run: bun run missing\n', {})).toThrow(
    'references missing package script: missing',
  );
});

test('rejects dynamic CI Bun script invocation instead of guessing it', () => {
  expect(() => assertWorkflowBunScripts('steps:\n  - run: bun run $CHECK\n', {})).toThrow(
    'contains a non-literal bun run command',
  );
});

test('identifies the workflow that contains an invalid script reference', () => {
  expect(() =>
    assertWorkflowBunScripts(
      'steps:\n  - run: bun run release:check\n',
      {},
      '.github/workflows/release.yml',
    ),
  ).toThrow('.github/workflows/release.yml references missing package script: release:check');
});
