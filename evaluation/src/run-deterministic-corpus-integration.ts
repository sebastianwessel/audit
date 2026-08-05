import { z } from 'zod';
import { reviewWorkflowPromptProtocolFingerprint } from '../../src/features/review-workflow/prompt-protocol.js';
import { loadRuntimeConfiguration } from '../../src/platform/configuration/environment.js';
import { HarnessExecutionConfigurationSchema } from '../../src/platform/harness/audit-harness.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
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
  return parsed.data.corpus ?? configuredCorpusRoot ?? 'evaluation/data/corpora';
}

export async function runDeterministicCorpusIntegration(argv: readonly string[]): Promise<number> {
  // This offline integration check deliberately has no provider or developer-runtime
  // configuration dependency. It must remain reproducible in CI and when a local
  // `.env` is incomplete or configured for a separate provider experiment.
  const runtime = await loadRuntimeConfiguration({ environment: {}, loadDotEnv: false });
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

function deterministicUsage(message: string): AuditRuntimeError {
  return new AuditRuntimeError(
    'invalid-input',
    `${message} Usage: bun run eval:corpus:integration -- [--corpus evaluation/data/corpora]`,
  );
}

if (import.meta.main) {
  try {
    process.exitCode = await runDeterministicCorpusIntegration(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected evaluator failure.';
    process.stderr.write(`audit evaluation: ${message}\n`);
    process.exitCode = 2;
  }
}
