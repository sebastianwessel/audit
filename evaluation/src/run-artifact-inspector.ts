import { z } from 'zod';

import { parseEvaluationOptionPairs } from './command-arguments.js';
import { inspectEvaluationArtifacts } from './evaluation-artifact-inspector.js';

const ArgumentsSchema = z.strictObject({
  output: z.string().trim().min(1).max(1_024),
  'benchmark-protocol-fingerprint': z.string().regex(/^[a-f0-9]{64}$/u),
});

export function parseEvaluationArtifactInspectorArguments(argv: readonly string[]) {
  const parsed = ArgumentsSchema.safeParse(parseEvaluationOptionPairs(argv));
  if (!parsed.success) {
    throw new Error(
      'Usage: bun run --bun evaluation/src/run-artifact-inspector.ts --output <evaluation-output-root> --benchmark-protocol-fingerprint <sha256>',
    );
  }
  return parsed.data;
}

if (import.meta.main) {
  try {
    const options = parseEvaluationArtifactInspectorArguments(Bun.argv.slice(2));
    const inspection = await inspectEvaluationArtifacts({
      outputRoot: options.output,
      expectedBenchmarkProtocolFingerprint: options['benchmark-protocol-fingerprint'],
    });
    process.stdout.write(`${JSON.stringify(inspection)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Evaluation artifact inspection failed.'}\n`,
    );
    process.exitCode = 2;
  }
}
