import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../src/platform/filesystem/index.js';

import { runDeterministicStageConformance } from './stage-conformance.js';

export async function runStageConformanceEvaluation(argv: readonly string[]): Promise<number> {
  if (argv.length !== 0) {
    throw new Error('The deterministic stage-conformance command accepts no options.');
  }
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-stage-conformance-'));
  try {
    await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
    const run = await runDeterministicStageConformance(
      await createJailedReadOnlyFilesystem({ targetRoot }),
    );
    process.stdout.write(`${JSON.stringify(run)}\n`);
    return 0;
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runStageConformanceEvaluation(Bun.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected stage-conformance failure.';
    process.stderr.write(`audit stage conformance: ${message}\n`);
    process.exitCode = 2;
  }
}
