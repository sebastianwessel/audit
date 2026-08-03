import { z } from 'zod';

import { loadRuntimeConfiguration } from '../../platform/configuration/environment.js';
import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { reviewWorkflowPromptProtocolFingerprint } from '../review-workflow/prompt-protocol.js';
import { parseEvaluationOptionPairs } from './command-arguments.js';
import { deterministicCorpusFixturePack, loadCorpusPack } from './corpus.js';
import { createDeterministicCorpusProvider } from './deterministic-provider.js';
import { writeRealWorldEvaluationArtifacts } from './real-world-artifacts.js';
import { renderRealWorldEvaluationReport } from './real-world-report.js';
import { runCorpusEvaluation } from './real-world-runner.js';

const split = 'development' as const;
const repetitions = 1;

const DeterministicCorpusArgumentsSchema = z.strictObject({
  corpus: z.string().trim().min(1).max(1_024).optional(),
});

export function parseDeterministicCorpusArguments(
  argv: readonly string[],
  configuredCorpusRoot?: string,
): string {
  const parsed = DeterministicCorpusArgumentsSchema.safeParse(parseEvaluationOptionPairs(argv));
  if (!parsed.success) {
    throw deterministicUsage('Invalid deterministic corpus integration options.');
  }
  return parsed.data.corpus ?? configuredCorpusRoot ?? 'evaluation/corpora';
}

export async function runDeterministicCorpusIntegration(argv: readonly string[]): Promise<number> {
  const runtime = await loadRuntimeConfiguration();
  const corpusRoot = parseDeterministicCorpusArguments(
    argv,
    runtime.configuration.evaluationCorpusRoot,
  );
  const pack = await loadCorpusPack(corpusRoot);
  const provider = await createDeterministicCorpusProvider(
    deterministicCorpusFixturePack(pack),
    split,
    repetitions,
  );
  const startedAt = new Date().toISOString();
  const run = await runCorpusEvaluation({
    pack,
    modelProvider: provider,
    provider: 'deterministic-golden-fixture',
    model: 'fake-model',
    split,
    repetitions,
    runId: `corpus-eval-${crypto.randomUUID()}`,
    startedAt,
    mode: 'deterministic',
    executionBudget: HarnessExecutionConfigurationSchema.parse({}),
    maxParallelVectors: runtime.configuration.maxParallelVectors,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  const report = renderRealWorldEvaluationReport(pack, run);
  const paths = await writeRealWorldEvaluationArtifacts(
    runtime.configuration.evaluationOutputRoot,
    run,
    report,
  );
  process.stdout.write(
    `${report}\nArtifacts: ${paths.jsonPath}, ${paths.markdownPath}, ${paths.trialTracePath}\n`,
  );
  // The deterministic corpus runner is an isolation, provenance, and artifact
  // integration check. Its golden responder intentionally makes no semantic
  // finding claim, so quality-gate failures stay visible in the report
  // without turning a successful integration check into a command failure.
  return run.safetyViolations > 0 ? 1 : 0;
}

function deterministicUsage(message: string): SecurityReviewerError {
  return new SecurityReviewerError(
    'invalid-input',
    `${message} Usage: bun run eval:corpus:integration -- [--corpus evaluation/corpora]`,
  );
}

if (import.meta.main) {
  try {
    process.exitCode = await runDeterministicCorpusIntegration(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected evaluator failure.';
    process.stderr.write(`security-reviewer evaluation: ${message}\n`);
    process.exitCode = 2;
  }
}
