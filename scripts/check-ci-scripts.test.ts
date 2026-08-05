import { expect, test } from 'bun:test';

import { assertWorkflowBunScripts } from './check-ci-scripts.js';

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
