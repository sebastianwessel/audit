import { readFile } from 'node:fs/promises';

import type { ModelProvider } from '@purista/harness';
import { z } from 'zod';
import { ModelStageObservationSchema } from '../../src/features/model-operations/model-operations.schema.js';
import { catalogueModelPricing } from '../../src/features/model-operations/model-pricing-catalogue.js';
import {
  ArtifactStoreError,
  readJsonArtifact,
  writeJsonArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { ensureSafeOutputRoot } from '../../src/platform/artifact-store/root-topology.js';
import {
  loadRuntimeConfiguration,
  type RuntimeConfiguration,
} from '../../src/platform/configuration/environment.js';
import { assertLiveHarnessStructuredOutputCompatibility } from '../../src/platform/harness/audit-harness.js';
import {
  createConfiguredModelRoute,
  providerCacheRoutingKey,
} from '../../src/platform/harness/provider.js';
import { canonicalJson, createStableId, sha256 } from '../../src/shared/contracts/core.js';
import {
  ModelIdentifierSchema,
  ModelProviderIdentifierSchema,
} from '../../src/shared/contracts/model-identity.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import { isEvaluationHelpRequest, parseEvaluationOptionPairs } from './command-arguments.js';
import { createEvaluatorFailureDiagnosticsStore } from './evaluator-failure-diagnostics.js';
import { StageIsolatedEvaluationStagePackSchema } from './stage-isolated.schema.js';
import {
  type StageIsolatedAdjudicationModelInput,
  validateStageIsolatedAdjudicationResponse,
} from './stage-isolated-adjudication-agent.contract.js';
import { adjudicateIsolatedStage } from './stage-isolated-adjudication-agent.js';
import {
  type StageSemanticEvaluatorPack,
  StageSemanticEvaluatorPackSchema,
} from './stage-semantic-pack.schema.js';
import { stageIsolatedStructuredOutputRegistry } from './structured-output-registry.js';

const ArgumentsSchema = z.strictObject({
  pack: z.string().trim().min(1).max(1_024),
  output: z.string().trim().min(1).max(1_024),
  resume: z.enum(['true']).optional(),
  'debug-diagnostics': z.enum(['true', 'false']).default('false'),
});

export type StageSemanticCommand = z.infer<typeof ArgumentsSchema>;

const StageSemanticBindingSchema = z.strictObject({
  packFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  canonicalInputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  productProjectionFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  rubricFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  evaluatorProtocolFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  evaluatorProvider: ModelProviderIdentifierSchema,
  evaluatorModel: ModelIdentifierSchema,
  evaluatorRoute: z.literal('primary'),
});

const StageSemanticCountsSchema = z.strictObject({
  matchedExpectedOutcomeCount: z.int().nonnegative(),
  missingExpectedOutcomeCount: z.int().nonnegative(),
  notApplicableExpectedOutcomeCount: z.int().nonnegative(),
  unexpectedProductOutputCount: z.int().nonnegative(),
  roleLocalizationCount: z.int().nonnegative(),
});

const StageSemanticTerminalSchema = z.strictObject({
  status: z.enum(['completed', 'incomplete', 'failed', 'cancelled']),
  errorCode: z.string().trim().min(1).nullable(),
  evaluatorObservation: ModelStageObservationSchema,
  counts: StageSemanticCountsSchema,
});

export const StageSemanticCheckpointSchema = z.discriminatedUnion('status', [
  StageSemanticBindingSchema.extend({
    status: z.literal('running'),
    startedAt: z.iso.datetime({ offset: true }),
  }),
  StageSemanticBindingSchema.extend({
    status: z.literal('completed'),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    terminal: StageSemanticTerminalSchema,
  }),
  StageSemanticBindingSchema.extend({
    status: z.literal('incomplete'),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    terminal: StageSemanticTerminalSchema,
  }),
  StageSemanticBindingSchema.extend({
    status: z.literal('failed'),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    terminal: StageSemanticTerminalSchema,
  }),
  StageSemanticBindingSchema.extend({
    status: z.literal('cancelled'),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }),
    terminal: StageSemanticTerminalSchema,
  }),
]);

export const StageSemanticPublicReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  qualification: z.literal('single-ai-assisted-development-review'),
  stage: StageIsolatedEvaluationStagePackSchema.shape.stage,
  planProfile: StageIsolatedEvaluationStagePackSchema.shape.planProfile,
  terminal: StageSemanticTerminalSchema,
});

type RuntimeConfigurationLoader = () => Promise<
  Readonly<{
    configuration: RuntimeConfiguration;
    environment: Readonly<Record<string, string | undefined>>;
  }>
>;

type StageSemanticCommandDependencies = Readonly<{
  loadPack?: (path: string) => Promise<StageSemanticEvaluatorPack>;
  loadRuntimeConfiguration?: RuntimeConfigurationLoader;
  modelProvider?: ModelProvider;
  now?: () => string;
}>;

export function parseStageSemanticArguments(argv: readonly string[]): StageSemanticCommand {
  const parsed = ArgumentsSchema.safeParse(parseEvaluationOptionPairs(argv));
  if (!parsed.success) throw usage('Invalid stage-semantic evaluation options.');
  return parsed.data;
}

/**
 * Evaluates only a completed product projection. The product stage is never
 * imported, constructed, or dispatched here; an explicit resume therefore
 * retries the evaluator operation only.
 */
export async function runStageSemanticEvaluation(
  argv: readonly string[],
  dependencies: StageSemanticCommandDependencies = {},
): Promise<number> {
  const options = parseStageSemanticArguments(argv);
  const runtime = await (dependencies.loadRuntimeConfiguration ?? loadRuntimeConfiguration)();
  const configuredProvider = runtime.configuration.provider;
  if (configuredProvider === undefined) {
    throw usage('Stage-semantic evaluation requires an explicit configured provider and model.');
  }
  // This must precede evaluator-pack access and output-root work. A selected
  // live route may never reach evaluator-owned input, persistence, or provider
  // construction with an incompatible structured-output transport contract.
  assertLiveHarnessStructuredOutputCompatibility({
    provider: configuredProvider,
    registry: stageIsolatedStructuredOutputRegistry,
  });
  const evaluatorPack = await (dependencies.loadPack ?? loadStageSemanticEvaluatorPack)(
    options.pack,
  );
  const binding = bindingFor(evaluatorPack);
  const outputRoot = await ensureSafeOutputRoot(options.output);
  const checkpointPath = `stage-semantic/${evaluatorPack.pack.packId}.checkpoint.json`;
  const reportPath = `stage-semantic/${evaluatorPack.pack.packId}.json`;
  const existing = await readOptionalCheckpoint(outputRoot, checkpointPath);

  if (existing !== undefined) {
    assertExactBinding(existing, binding);
    if (existing.status === 'completed') {
      await writeJsonArtifact(
        outputRoot,
        reportPath,
        StageSemanticPublicReportSchema,
        publicReport(evaluatorPack, existing.terminal),
      );
      return 0;
    }
    if (options.resume !== 'true') {
      throw usage(
        'A prior stage-semantic attempt exists; pass --resume true to retry the evaluator only.',
      );
    }
  } else if (options.resume === 'true') {
    throw usage('No matching stage-semantic checkpoint exists for --resume true.');
  }

  const startedAt = (dependencies.now ?? (() => new Date().toISOString()))();
  if (existing === undefined) {
    await writeJsonArtifact(outputRoot, checkpointPath, StageSemanticCheckpointSchema, {
      ...binding,
      status: 'running',
      startedAt,
    });
  }

  // Compatibility, binding validation, and checkpoint checks all precede provider construction.
  const route = resolveEvaluatorRoute({
    evaluatorPack,
    runtime,
    modelProvider: dependencies.modelProvider,
  });
  const request: StageIsolatedAdjudicationModelInput = {
    expectedOutcomeRubric: evaluatorPack.rubric,
    productStageOutput: evaluatorPack.productStageOutput,
  };
  const diagnosticRunId = stageSemanticDiagnosticRunId(evaluatorPack);
  const operation = await adjudicateIsolatedStage({
    provider: configuredProvider,
    modelProvider: route.modelProvider,
    modelName: route.model,
    execution: { modelRetry: 'default', modelTimeoutMs: 0, runTimeoutMs: 0 },
    sessionId: `stage-semantic-${evaluatorPack.pack.packId}`,
    request,
    route: evaluatorPack.pack.evaluatorRoute,
    stageId: evaluatorPack.pack.packId,
    modelPricing: route.modelPricing,
    cacheRoutingEnabled: route.modelCacheRoutingKey !== undefined,
    scopeFingerprint: binding.productProjectionFingerprint,
    ...(options['debug-diagnostics'] === 'true'
      ? {
          evaluatorFailureDiagnosticSink: {
            evaluationRunId: diagnosticRunId,
            protocolFingerprint: evaluatorPack.pack.evaluatorProtocolFingerprint,
            now: dependencies.now ?? (() => new Date().toISOString()),
            write: createEvaluatorFailureDiagnosticsStore({
              outputRoot,
              evaluationRunId: diagnosticRunId,
              privateWorkPath: `stage-semantic/${evaluatorPack.pack.packId}.work`,
            }).save,
          },
        }
      : {}),
    ...(route.modelCacheRoutingKey === undefined
      ? {}
      : { modelCacheRoutingKey: route.modelCacheRoutingKey }),
  });
  const terminal = terminalFor(operation, request);
  const completedAt = (dependencies.now ?? (() => new Date().toISOString()))();
  await writeJsonArtifact(outputRoot, checkpointPath, StageSemanticCheckpointSchema, {
    ...binding,
    status: terminal.status,
    startedAt: existing?.startedAt ?? startedAt,
    completedAt,
    terminal,
  });
  await writeJsonArtifact(
    outputRoot,
    reportPath,
    StageSemanticPublicReportSchema,
    publicReport(evaluatorPack, terminal),
  );
  return terminal.status === 'completed' ? 0 : 3;
}

/** Strict factory for local evaluator tooling; it retains the packet only in caller memory. */
export function createStageSemanticEvaluatorPack(
  input: StageSemanticEvaluatorPack,
): StageSemanticEvaluatorPack {
  return StageSemanticEvaluatorPackSchema.parse(input);
}

async function loadStageSemanticEvaluatorPack(path: string): Promise<StageSemanticEvaluatorPack> {
  try {
    return StageSemanticEvaluatorPackSchema.parse(
      z.json().parse(JSON.parse(await readFile(path, 'utf8'))),
    );
  } catch {
    throw usage('The evaluator-private stage pack is missing or invalid.');
  }
}

function bindingFor(pack: StageSemanticEvaluatorPack) {
  if (pack.pack.evaluatorRoute !== 'primary') {
    throw usage('Stage-semantic evaluation supports only the sealed primary evaluator route.');
  }
  return StageSemanticBindingSchema.parse({
    packFingerprint: sha256(canonicalJson(pack.pack)),
    canonicalInputFingerprint: pack.canonicalInputFingerprint,
    productProjectionFingerprint: pack.productStageOutput.stageResultFingerprint,
    rubricFingerprint: pack.rubric.rubricFingerprint,
    evaluatorProtocolFingerprint: pack.pack.evaluatorProtocolFingerprint,
    evaluatorProvider: pack.pack.evaluatorProvider,
    evaluatorModel: pack.pack.evaluatorModel,
    evaluatorRoute: pack.pack.evaluatorRoute,
  });
}

function stageSemanticDiagnosticRunId(pack: StageSemanticEvaluatorPack): string {
  return createStableId('stage-semantic-evaluation', pack.pack.packId);
}

function resolveEvaluatorRoute(input: {
  evaluatorPack: StageSemanticEvaluatorPack;
  runtime: Awaited<ReturnType<RuntimeConfigurationLoader>>;
  modelProvider: ModelProvider | undefined;
}) {
  const provider = input.runtime.configuration.provider;
  const model = input.runtime.configuration.model;
  if (provider === undefined || model === undefined) {
    throw usage('Stage-semantic evaluation requires an explicit configured provider and model.');
  }
  if (
    provider !== input.evaluatorPack.pack.evaluatorProvider ||
    model !== input.evaluatorPack.pack.evaluatorModel
  ) {
    throw usage('The configured evaluator route does not match the sealed evaluator pack.');
  }
  const modelPricing = catalogueModelPricing({ provider, model });
  if (input.modelProvider !== undefined) {
    return {
      modelProvider: input.modelProvider,
      model,
      modelPricing,
      modelCacheRoutingKey: providerCacheRoutingKey({ provider, model }),
    };
  }
  return createConfiguredModelRoute({
    provider,
    model,
    modelPricing,
    environment: input.runtime.environment,
    apiKeyEnvironmentVariable: input.runtime.configuration.apiKeyEnvironmentVariable,
  });
}

function terminalFor(
  operation: Awaited<ReturnType<typeof adjudicateIsolatedStage>>,
  request: StageIsolatedAdjudicationModelInput,
) {
  if (operation.status === 'completed') {
    const response = validateStageIsolatedAdjudicationResponse({
      request,
      response: operation.output,
    });
    const matched = response.expectedOutcomes.filter((entry) => entry.disposition === 'matched');
    return StageSemanticTerminalSchema.parse({
      status: 'completed',
      errorCode: null,
      evaluatorObservation: operation.modelObservation,
      counts: {
        matchedExpectedOutcomeCount: matched.length,
        missingExpectedOutcomeCount: response.expectedOutcomes.filter(
          (entry) => entry.disposition === 'missing',
        ).length,
        notApplicableExpectedOutcomeCount: response.expectedOutcomes.filter(
          (entry) => entry.disposition === 'not-applicable',
        ).length,
        unexpectedProductOutputCount: response.unexpectedProductOutputIds.length,
        roleLocalizationCount: matched.reduce(
          (total, entry) =>
            total +
            entry.roleLocalizations.reduce(
              (roleTotal, role) => roleTotal + role.localizationIds.length,
              0,
            ),
          0,
        ),
      },
    });
  }
  const status =
    operation.errorCode === 'provider-cancelled'
      ? 'cancelled'
      : operation.errorCode === 'provider-context-overflow'
        ? 'incomplete'
        : 'failed';
  return StageSemanticTerminalSchema.parse({
    status,
    errorCode: operation.errorCode,
    evaluatorObservation: operation.modelObservation,
    counts: {
      matchedExpectedOutcomeCount: 0,
      missingExpectedOutcomeCount: 0,
      notApplicableExpectedOutcomeCount: 0,
      unexpectedProductOutputCount: 0,
      roleLocalizationCount: 0,
    },
  });
}

function publicReport(
  pack: StageSemanticEvaluatorPack,
  terminal: z.output<typeof StageSemanticTerminalSchema>,
) {
  return StageSemanticPublicReportSchema.parse({
    schemaVersion: 1,
    qualification: 'single-ai-assisted-development-review',
    stage: pack.pack.stage,
    planProfile: pack.pack.planProfile,
    terminal,
  });
}

async function readOptionalCheckpoint(outputRoot: string, path: string) {
  try {
    return await readJsonArtifact(outputRoot, path, StageSemanticCheckpointSchema);
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}

function assertExactBinding(
  checkpoint: z.output<typeof StageSemanticCheckpointSchema>,
  binding: z.output<typeof StageSemanticBindingSchema>,
): void {
  const persisted = StageSemanticBindingSchema.parse({
    packFingerprint: checkpoint.packFingerprint,
    canonicalInputFingerprint: checkpoint.canonicalInputFingerprint,
    productProjectionFingerprint: checkpoint.productProjectionFingerprint,
    rubricFingerprint: checkpoint.rubricFingerprint,
    evaluatorProtocolFingerprint: checkpoint.evaluatorProtocolFingerprint,
    evaluatorProvider: checkpoint.evaluatorProvider,
    evaluatorModel: checkpoint.evaluatorModel,
    evaluatorRoute: checkpoint.evaluatorRoute,
  });
  if (canonicalJson(persisted) !== canonicalJson(binding)) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The stage-semantic checkpoint does not match the sealed evaluator pack.',
    );
  }
}

export const stageSemanticUsage =
  'Usage: bun run eval:stage-semantic --pack <evaluator-private-pack.json> --output <evaluation-output-root> [--resume true] [--debug-diagnostics true]';

function usage(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `${message} ${stageSemanticUsage}`);
}

if (import.meta.main) {
  try {
    const argv = Bun.argv.slice(2);
    if (isEvaluationHelpRequest(argv)) {
      process.stdout.write(`${stageSemanticUsage}\n`);
      process.exitCode = 0;
    } else {
      process.exitCode = await runStageSemanticEvaluation(argv);
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected semantic stage-evaluation failure.';
    process.stderr.write(`audit stage semantic evaluation: ${message}\n`);
    process.exitCode = 2;
  }
}
