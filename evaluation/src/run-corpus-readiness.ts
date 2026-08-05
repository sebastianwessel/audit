import { z } from 'zod';
import {
  writeJsonArtifact,
  writeMarkdownArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { loadRuntimeConfiguration } from '../../src/platform/configuration/environment.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import { isEvaluationHelpRequest, parseEvaluationOptionPairs } from './command-arguments.js';
import { loadCorpusPack } from './corpus.js';
import { assessCorpusReadiness } from './corpus-readiness.js';
import { CorpusReadinessReportSchema } from './corpus-readiness.schema.js';
import { renderCorpusReadinessReport } from './corpus-readiness-report.js';

const CorpusReadinessArgumentsSchema = z.strictObject({
  corpus: z.string().trim().min(1).max(1_024).optional(),
  output: z.string().trim().min(1).max(1_024).optional(),
});

export const corpusReadinessUsage =
  'Usage: bun run eval:corpus:readiness [--corpus <local-corpus-root>] [--output <evaluation-output-root>]';

export type CorpusReadinessArguments = z.output<typeof CorpusReadinessArgumentsSchema>;

/** Parses the closed local-only readiness command surface before any configuration or I/O. */
export function parseCorpusReadinessArguments(argv: readonly string[]): CorpusReadinessArguments {
  const parsed = CorpusReadinessArgumentsSchema.safeParse(parseEvaluationOptionPairs(argv));
  if (!parsed.success) {
    throw new AuditRuntimeError(
      'invalid-input',
      `Invalid corpus-readiness options. ${corpusReadinessUsage}`,
    );
  }
  return parsed.data;
}

export async function runCorpusReadinessCommand(argv: readonly string[]): Promise<number> {
  if (isEvaluationHelpRequest(argv)) {
    process.stdout.write(`${corpusReadinessUsage}\n`);
    return 0;
  }
  const options = parseCorpusReadinessArguments(argv);
  const runtime = await loadRuntimeConfiguration();
  const corpusRoot = options.corpus ?? runtime.configuration.evaluationCorpusRoot;
  const outputRoot = options.output ?? runtime.configuration.evaluationOutputRoot;
  const pack = await loadCorpusPack(corpusRoot);
  const runId = `corpus-readiness-${crypto.randomUUID()}`;
  const readiness = assessCorpusReadiness(pack, new Date().toISOString());
  await writeJsonArtifact(
    outputRoot,
    `${runId}/readiness.json`,
    CorpusReadinessReportSchema,
    readiness,
  );
  await writeMarkdownArtifact(
    outputRoot,
    `${runId}/readiness.md`,
    renderCorpusReadinessReport(readiness),
  );
  process.stdout.write(`${JSON.stringify(readiness)}\n`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await runCorpusReadinessCommand(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected corpus-readiness failure.';
    process.stderr.write(`audit corpus readiness: ${message}\n`);
    process.exitCode = 2;
  }
}
