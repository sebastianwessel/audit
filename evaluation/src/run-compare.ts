import { z } from 'zod';

import {
  compareEvaluationRuns,
  loadEvaluationRunForComparison,
  renderEvaluationRunComparison,
} from './comparison.js';
import { EvaluationComparisonKindSchema } from './comparison.schema.js';

const ArgumentsSchema = z.strictObject({
  baseline: z.string().trim().min(1).max(1_024),
  candidate: z.string().trim().min(1).max(1_024),
  kind: EvaluationComparisonKindSchema.default('same-route-regression'),
});

function parseArguments(argv: readonly string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      key === undefined ||
      value === undefined ||
      !key.startsWith('--') ||
      values[key.slice(2)] !== undefined
    ) {
      throw new Error(
        'Usage: bun run eval:compare --baseline <evaluation-run.json> --candidate <evaluation-run.json> [--kind same-route-regression|primary-model-experiment]',
      );
    }
    values[key.slice(2)] = value;
  }
  const parsed = ArgumentsSchema.safeParse(values);
  if (!parsed.success) {
    throw new Error(
      'Usage: bun run eval:compare --baseline <evaluation-run.json> --candidate <evaluation-run.json> [--kind same-route-regression|primary-model-experiment]',
    );
  }
  return parsed.data;
}

if (import.meta.main) {
  try {
    const options = parseArguments(Bun.argv.slice(2));
    const comparison = compareEvaluationRuns(
      await loadEvaluationRunForComparison(options.baseline),
      await loadEvaluationRunForComparison(options.candidate),
      options.kind,
    );
    process.stdout.write(renderEvaluationRunComparison(comparison));
    process.exitCode = comparison.comparable ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Evaluation comparison failed.'}\n`,
    );
    process.exitCode = 2;
  }
}
