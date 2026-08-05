import { z } from 'zod';

import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import { parseEvaluationOptionPairs } from './command-arguments.js';
import { acquiredSourcePairSummary, acquirePinnedSourcePair } from './source-pair-acquisition.js';

const AcquisitionArgumentsSchema = z.strictObject({
  registry: z.string().trim().min(1).max(1_024),
  candidate: z.string().trim().min(1).max(64),
  repository: z.string().trim().min(1).max(1_024),
  output: z.string().trim().min(1).max(1_024),
});

export async function runSourcePairAcquisition(argv: readonly string[]): Promise<void> {
  const parsed = AcquisitionArgumentsSchema.safeParse(parseEvaluationOptionPairs(argv));
  if (!parsed.success) throw usage('Invalid source-pair acquisition options.');
  const snapshot = await acquirePinnedSourcePair({
    registryPath: parsed.data.registry,
    candidateId: parsed.data.candidate,
    repositoryRoot: parsed.data.repository,
    outputRoot: parsed.data.output,
    capturedAt: new Date().toISOString(),
  });
  process.stdout.write(`${JSON.stringify(acquiredSourcePairSummary(snapshot))}\n`);
}

function usage(message: string): AuditRuntimeError {
  return new AuditRuntimeError(
    'invalid-input',
    `${message} Usage: bun run eval:acquire -- --registry <registry.json> --candidate <candidate-id> --repository <already-local-git-repository> --output <snapshot-root>`,
  );
}

if (import.meta.main) {
  try {
    await runSourcePairAcquisition(Bun.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected source-pair acquisition failure.';
    process.stderr.write(`audit source-pair acquisition: ${message}\n`);
    process.exitCode = 2;
  }
}
