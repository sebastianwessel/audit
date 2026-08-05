import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../src/platform/filesystem/index.js';

import { runDeterministicStageConformance } from './stage-conformance.js';

test('exercises every source-deciding stage with only scoped read tools and no external provider', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-stage-conformance-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');

  const result = await runDeterministicStageConformance(
    await createJailedReadOnlyFilesystem({ targetRoot }),
  );

  expect(result).toMatchObject({
    mode: 'deterministic-stage-conformance',
    provider: 'in-process-scripted-fixture',
    stages: [
      { stage: 'candidate-grounding', outcome: 'inspected', scopePreserved: true },
      { stage: 'countercheck', outcome: 'inspected', scopePreserved: true },
      { stage: 'evidence-mapping', outcome: 'retry-safe', scopePreserved: true },
      { stage: 'investigation', outcome: 'inspected', scopePreserved: true },
      { stage: 'planning', outcome: 'inspected', scopePreserved: true },
      { stage: 'source-posture', outcome: 'inspected', scopePreserved: true },
      { stage: 'verification', outcome: 'inspected', scopePreserved: true },
    ],
  });
  for (const stage of result.stages) {
    expect(stage.toolUsage.grepFilesCallCount).toBeGreaterThan(0);
    expect(stage.toolUsage.rejectedCallCount).toBe(0);
  }
});
