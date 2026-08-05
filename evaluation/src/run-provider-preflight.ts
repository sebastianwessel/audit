import { loadRuntimeConfiguration } from '../../src/platform/configuration/environment.js';
import { isEvaluationHelpRequest } from './command-arguments.js';
import {
  parseProviderEvaluationArguments,
  preflightProviderEvaluation,
  providerEvaluationUsage,
} from './run-provider.js';

export async function runProviderPreflightCommand(argv: readonly string[]): Promise<number> {
  if (isEvaluationHelpRequest(argv)) {
    process.stdout.write(`${providerEvaluationUsage}\n`);
    return 0;
  }
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
    process.exitCode = await runProviderPreflightCommand(Bun.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected evaluator preflight failure.';
    process.stderr.write(`audit provider evaluation preflight: ${message}\n`);
    process.exitCode = 2;
  }
}
