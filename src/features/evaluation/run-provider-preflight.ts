import { loadRuntimeConfiguration } from '../../platform/configuration/environment.js';
import { parseProviderEvaluationArguments, preflightProviderEvaluation } from './run-provider.js';

async function main(argv: readonly string[]): Promise<number> {
  const runtime = await loadRuntimeConfiguration();
  const options = parseProviderEvaluationArguments(argv, runtime.configuration);
  const preflight = await preflightProviderEvaluation({
    options,
    runtime: runtime.configuration,
    environment: runtime.environment,
  });
  process.stdout.write(`${JSON.stringify(preflight)}\n`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(Bun.argv.slice(2)));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected evaluator preflight failure.';
    process.stderr.write(`security-reviewer provider evaluation preflight: ${message}\n`);
    process.exit(2);
  }
}
