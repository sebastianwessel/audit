import { expect, test } from 'bun:test';

import { runStageConformanceEvaluation } from './run-stage-conformance.js';

test('runs the deterministic stage-conformance command without provider configuration', async () => {
  expect(await runStageConformanceEvaluation([])).toBe(0);
});

test('rejects options because the conformance fixture has no operator-controlled scope', async () => {
  await expect(runStageConformanceEvaluation(['--target', 'elsewhere'])).rejects.toThrow(
    'accepts no options',
  );
});
