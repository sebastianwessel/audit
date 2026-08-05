#!/usr/bin/env bun

import type { ModelProvider } from '@purista/harness';
import {
  type LoadedRuntimeConfiguration,
  loadRuntimeConfiguration,
  type RuntimeConfiguration,
} from '../platform/configuration/environment.js';
import { assertAuditWorkflowStructuredOutputCompatibility } from '../platform/harness/audit-harness.js';
import { createConfiguredProvider, ProviderNameSchema } from '../platform/harness/provider.js';
import {
  AuditRuntimeError,
  isRetryableAuditRuntimeErrorCode,
} from '../shared/errors/audit-runtime-error.js';
import { isProductCliCommand, parseHelpRequest, renderCliHelp } from './command-catalog.js';
import { assertValidCommandOptions, type ProductCliCommand } from './command-options.js';
import { runAudit, runDiscard } from './commands/audit/index.js';
import { runGuidance } from './commands/guidance/index.js';
import {
  runPlan,
  runPlanDraft,
  runPlanPublicationRecovery,
  runPlanReseal,
} from './commands/planning/index.js';
import { runLineage, runReport } from './commands/reporting/index.js';
import {
  prepareConfiguredPrivateWorkRoot,
  prepareConfiguredProductRoots,
  prepareConfiguredPublicArtifactRoot,
} from './configured-roots.js';
import { booleanOption, requiredOption, requiredValue, usage } from './input.js';

export type CliCommand = Readonly<{
  command: ProductCliCommand;
  options: Readonly<Record<string, string>>;
}>;

type CliRuntimeDependencies = Readonly<{
  loadRuntimeConfiguration?: () => Promise<LoadedRuntimeConfiguration>;
}>;

/** Parses only the generic command boundary; command schemas validate options afterwards. */
export function parseCliArguments(argv: readonly string[]): CliCommand {
  const command = argv[0];
  if (command === undefined || !isProductCliCommand(command)) {
    throw usage(
      'Expected one of: plan, plan-draft, plan-reseal, audit, guidance, discard, report, lineage.',
    );
  }
  const options: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      key === undefined ||
      value === undefined ||
      !key.startsWith('--') ||
      key.length < 3 ||
      options[key.slice(2)] !== undefined
    ) {
      throw usage('Options must be unique --key value pairs.');
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliRuntimeDependencies = {},
): Promise<number> {
  const help = parseHelpRequest(argv);
  if (help !== undefined) {
    process.stdout.write(renderCliHelp(help));
    return 0;
  }
  const parsed = parseCliArguments(argv);
  assertValidCommandOptions(parsed.command, parsed.options);
  const runtime = await (dependencies.loadRuntimeConfiguration ?? loadRuntimeConfiguration)();
  if (parsed.command === 'discard')
    return runDiscard(
      parsed.options,
      await prepareConfiguredPrivateWorkRoot(runtime.configuration),
    );
  if (parsed.command === 'plan-draft')
    return runPlanDraft(
      parsed.options,
      await prepareConfiguredPrivateWorkRoot(runtime.configuration),
    );
  if (parsed.command === 'plan-reseal')
    return runPlanReseal(
      parsed.options,
      await prepareConfiguredPrivateWorkRoot(runtime.configuration),
    );
  if (parsed.command === 'report')
    return runReport(
      parsed.options,
      await prepareConfiguredPublicArtifactRoot(runtime.configuration),
    );
  if (parsed.command === 'lineage')
    return runLineage(
      parsed.options,
      await prepareConfiguredPublicArtifactRoot(runtime.configuration),
    );
  if (parsed.command === 'plan' && booleanOption(parsed.options, 'resume', false)) {
    return runPlanPublicationRecovery(
      parsed.options,
      await prepareConfiguredPrivateWorkRoot(runtime.configuration),
    );
  }
  if (runtime.configuration.verificationMode === 'independent-route') {
    throw usage(
      'The independent verifier route is evaluation-only and cannot run product commands.',
    );
  }
  const providerName = requiredValue(runtime.configuration.provider, 'provider');
  const model = requiredValue(runtime.configuration.model, 'model');
  assertAuditWorkflowStructuredOutputCompatibility(ProviderNameSchema.parse(providerName));
  const roots = await prepareConfiguredProductRoots({
    configuration: runtime.configuration,
    targetRoot: requiredOption(parsed.options, 'target'),
    contextRoot: parsed.options.context,
  });
  if (parsed.command === 'guidance') return runGuidance(parsed.options, runtime, roots);
  const provider = createProvider(runtime.configuration, runtime.environment, providerName);
  const commandDependencies = {
    runtime: runtime.configuration,
    provider,
    roots,
    providerName,
    model,
  };
  return parsed.command === 'plan'
    ? runPlan(parsed.options, commandDependencies)
    : runAudit(parsed.options, commandDependencies);
}

function createProvider(
  runtime: RuntimeConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
  providerName: string,
): ModelProvider {
  return createConfiguredProvider({
    provider: ProviderNameSchema.parse(providerName),
    apiKeyEnvironmentVariable: runtime.apiKeyEnvironmentVariable,
    environment,
  });
}

/** Maps failures that prevented a report to the documented operational CI class. */
export function cliFailureExitCode(error: unknown): 2 | 4 {
  if (
    error instanceof AuditRuntimeError &&
    (isRetryableAuditRuntimeErrorCode(error.code) ||
      error.code === 'provider-http-error' ||
      error.code === 'provider-response-invalid' ||
      error.code === 'provider-cancelled' ||
      error.code === 'provider-context-overflow' ||
      error.code === 'agent-loop-budget-exceeded')
  )
    return 4;
  return 2;
}

if (import.meta.main) {
  try {
    process.exitCode = await runCli(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    process.stderr.write(`audit: ${message}\n`);
    process.exitCode = cliFailureExitCode(error);
  }
}
