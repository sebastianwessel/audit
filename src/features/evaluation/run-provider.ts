import type { ModelProvider } from '@purista/harness';
import { z } from 'zod';

import {
  loadRuntimeConfiguration,
  ProviderNameSchema,
  type RuntimeConfiguration,
  VerificationModeSchema,
} from '../../platform/configuration/environment.js';
import {
  createConfiguredModelRoute,
  providerCacheRoutingKey,
} from '../../platform/harness/provider.js';
import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import {
  canonicalJson,
  createStableId,
  IdentifierSchema,
  sha256,
} from '../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import {
  ModelCostCeilingStateSchema,
  ModelCostCeilingUsdSchema,
} from '../model-operations/model-operations.schema.js';
import { catalogueModelPricing } from '../model-operations/model-pricing-catalogue.js';
import { reviewWorkflowPromptProtocolFingerprint } from '../review-workflow/prompt-protocol.js';
import {
  createVerificationRouteFingerprint,
  type ResolvedVerificationRoute,
} from '../review-workflow/runtime/verification-route.js';
import { compareEvaluationBaseline, loadEvaluationBaseline } from './baseline.js';
import { parseEvaluationOptionPairs } from './command-arguments.js';
import { type LoadedCorpusPack, loadCorpusPack } from './corpus.js';
import {
  CorpusSplitSchema,
  EvaluationMeasurementScopeSchema,
  PlanEvaluationProfileSchema,
  type ProviderEvaluationCheckpoint,
  ProviderEvaluationCheckpointSchema,
  type RealWorldEvaluationRun,
} from './corpus.schema.js';
import {
  evaluationBenchmarkProtocolFingerprint,
  evaluationPopulationDigest,
} from './evaluation-identity.js';
import { verifyHoldoutAttestation } from './holdout-attestation.js';
import type { HoldoutAttestationReference } from './holdout-attestation.schema.js';
import {
  acquireProviderEvaluationLock,
  createEvaluationAuditCheckpointStore,
  createEvaluationExpectedEvidenceTraceCheckpointStore,
  createEvaluationPlanningCheckpointStore,
  readProviderEvaluationCheckpoint,
  writeProviderEvaluationCheckpoint,
  writeRealWorldEvaluationArtifacts,
} from './real-world-artifacts.js';
import { renderRealWorldEvaluationReport } from './real-world-report.js';
import { runCorpusEvaluation, selectCasesForEvaluation } from './real-world-runner.js';

const ProviderEvaluationArgumentsSchema = z.strictObject({
  provider: ProviderNameSchema.optional(),
  model: z.string().trim().min(1).max(160).optional(),
  split: CorpusSplitSchema.default('development'),
  repetitions: z.coerce.number().int().positive().default(1),
  'plan-profile': PlanEvaluationProfileSchema.default('generated-plan'),
  'measurement-scope': EvaluationMeasurementScopeSchema.default('full-workflow'),
  'case-id': IdentifierSchema.optional(),
  corpus: z.string().trim().min(1).optional(),
  output: z.string().trim().min(1).optional(),
  baseline: z.string().trim().min(1).optional(),
  'api-key-env': z.string().trim().min(1).max(160).optional(),
  'verification-mode': VerificationModeSchema.optional(),
  'model-timeout-ms': z.coerce.number().int().min(5_000).max(180_000).default(120_000),
  'run-timeout-ms': z.coerce.number().int().min(5_000).max(300_000).default(150_000),
  'run-id': IdentifierSchema.optional(),
  resume: z.enum(['true', 'false']).default('false'),
  'retry-unfinished': z.enum(['true', 'false']).default('false'),
  'max-estimated-cost-usd': z.coerce.number().pipe(ModelCostCeilingUsdSchema).optional(),
  'holdout-attestation': z.string().trim().min(1).max(1_024).optional(),
  'holdout-public-key': z.string().trim().min(1).max(1_024).optional(),
});

const ProviderEvaluationOptionsSchema = ProviderEvaluationArgumentsSchema.extend({
  provider: ProviderNameSchema,
  model: z.string().trim().min(1).max(160),
  corpus: z.string().trim().min(1),
  output: z.string().trim().min(1),
  executionBudget: HarnessExecutionConfigurationSchema,
  runId: IdentifierSchema,
  resume: z.boolean(),
  retryUnfinished: z.boolean(),
  planProfile: PlanEvaluationProfileSchema,
  measurementScope: EvaluationMeasurementScopeSchema,
  caseIdFilter: IdentifierSchema.optional(),
});

export type ProviderEvaluationOptions = z.output<typeof ProviderEvaluationOptionsSchema>;

/** Evaluation flags own their effective route, so their price lookup must not use runtime defaults. */
export function primaryModelPricingForEvaluation(input: { provider: string; model: string }) {
  return catalogueModelPricing(input);
}

export function parseProviderEvaluationArguments(
  argv: readonly string[],
  runtime?: RuntimeConfiguration,
): ProviderEvaluationOptions {
  const values = parseEvaluationOptionPairs(argv);
  const parsedArguments = ProviderEvaluationArgumentsSchema.safeParse(values);
  if (!parsedArguments.success) throw usage('Invalid provider evaluation options.');
  if (parsedArguments.data.resume === 'true' && parsedArguments.data['run-id'] === undefined) {
    throw usage('Resuming a provider evaluation requires an explicit --run-id.');
  }
  if (
    parsedArguments.data['retry-unfinished'] === 'true' &&
    parsedArguments.data.resume !== 'true'
  ) {
    throw usage('Retrying unfinished evaluation work requires --resume true.');
  }
  const parsed = ProviderEvaluationOptionsSchema.safeParse({
    ...parsedArguments.data,
    provider: parsedArguments.data.provider ?? runtime?.provider,
    model: parsedArguments.data.model ?? runtime?.model,
    corpus: parsedArguments.data.corpus ?? runtime?.evaluationCorpusRoot ?? 'evaluation/corpora',
    output: parsedArguments.data.output ?? runtime?.evaluationOutputRoot ?? 'evaluation/runs',
    baseline: parsedArguments.data.baseline,
    'api-key-env': parsedArguments.data['api-key-env'] ?? runtime?.apiKeyEnvironmentVariable,
    'max-estimated-cost-usd':
      parsedArguments.data['max-estimated-cost-usd'] ?? runtime?.maxEstimatedCostUsd,
    executionBudget: {
      modelTimeoutMs: parsedArguments.data['model-timeout-ms'],
      runTimeoutMs: parsedArguments.data['run-timeout-ms'],
      modelRetry: 'default',
    },
    runId:
      parsedArguments.data['run-id'] ??
      createStableId('provider-eval', `${String(Date.now())}\\0${crypto.randomUUID()}`),
    resume: parsedArguments.data.resume === 'true',
    retryUnfinished: parsedArguments.data['retry-unfinished'] === 'true',
    planProfile: parsedArguments.data['plan-profile'],
    measurementScope: parsedArguments.data['measurement-scope'],
    caseIdFilter: parsedArguments.data['case-id'],
  });
  if (!parsed.success) throw usage('Invalid provider evaluation options.');
  return parsed.data;
}

async function main(argv: readonly string[]): Promise<number> {
  const runtime = await loadRuntimeConfiguration();
  const options = parseProviderEvaluationArguments(argv, runtime.configuration);
  const execution = await runProviderEvaluation({
    options,
    runtime: runtime.configuration,
    environment: runtime.environment,
  });
  process.stdout.write(
    `${execution.report}\nArtifacts: ${execution.paths.jsonPath}, ${execution.paths.markdownPath}, ${execution.paths.trialTracePath}\n`,
  );
  return execution.exitCode;
}

/** Executes an explicitly configured provider evaluation; tests may supply an in-process provider. */
export async function runProviderEvaluation(input: {
  options: ProviderEvaluationOptions;
  runtime: RuntimeConfiguration;
  environment: Readonly<Record<string, string | undefined>>;
  modelProvider?: ModelProvider;
}): Promise<{
  run: RealWorldEvaluationRun;
  report: string;
  paths: Readonly<{ jsonPath: string; markdownPath: string; trialTracePath: string }>;
  exitCode: number;
}> {
  const { options, runtime } = input;
  const primaryModelPricing = primaryModelPricingForEvaluation(options);
  const verificationMode = options['verification-mode'] ?? runtime.verificationMode;
  validateMeasurementScope(options, verificationMode);
  const pack = await loadCorpusPack(options.corpus);
  selectCasesForEvaluation(pack, options.split, options.caseIdFilter);
  const modelProvider =
    input.modelProvider ??
    createConfiguredModelRoute({
      provider: options.provider,
      model: options.model,
      apiKeyEnvironmentVariable: options['api-key-env'],
      modelPricing: primaryModelPricing,
      environment: input.environment,
      requestTimeoutMs: options.executionBudget.modelTimeoutMs,
    }).modelProvider;
  const independentVerifierRoute = resolveIndependentVerifierRoute(
    runtime,
    input.environment,
    {
      provider: options.provider,
      model: options.model,
    },
    verificationMode,
    options.executionBudget.modelTimeoutMs,
  );
  const verificationRouteFingerprint =
    independentVerifierRoute?.fingerprint ??
    createVerificationRouteFingerprint({
      route: 'primary',
      provider: options.provider,
      model: options.model,
    });
  const populationDigest = evaluationPopulationDigest({
    pack,
    split: options.split,
    ...(options.caseIdFilter === undefined ? {} : { caseIdFilter: options.caseIdFilter }),
  });
  const benchmarkProtocolFingerprint = evaluationBenchmarkProtocolFingerprint({
    pack,
    split: options.split,
    ...(options.caseIdFilter === undefined ? {} : { caseIdFilter: options.caseIdFilter }),
    mode: 'provider',
    provider: options.provider,
    model: options.model,
    verificationMode,
    verificationRouteFingerprint,
    repetitions: options.repetitions,
    planProfile: options.planProfile,
    measurementScope: options.measurementScope,
    executionBudget: options.executionBudget,
    maxParallelVectors: runtime.maxParallelVectors,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
  });
  const holdoutAttestation = await resolveHoldoutAttestation(
    options,
    pack,
    benchmarkProtocolFingerprint,
  );
  const startedAt = new Date().toISOString();
  const configFingerprint = sha256(
    canonicalJson({
      benchmarkProtocolFingerprint,
      modelPricing: {
        inputPerMillion: primaryModelPricing.inputPerMillion ?? null,
        cachedInputPerMillion: primaryModelPricing.cachedInputPerMillion ?? null,
        outputPerMillion: primaryModelPricing.outputPerMillion ?? null,
        source: primaryModelPricing.source ?? null,
      },
      cacheRoutingEnabled:
        providerCacheRoutingKey({
          provider: options.provider,
          model: options.model,
        }) !== undefined,
      holdoutAttestation: holdoutAttestation ?? null,
    }),
  );
  const lock = await acquireProviderEvaluationLock(options.output, options.runId);
  let persistedCheckpoint: ProviderEvaluationCheckpoint | undefined;
  try {
    const existing = await readProviderEvaluationCheckpoint(options.output, options.runId);
    if (existing !== undefined && !options.resume) {
      throw usage(
        'A checkpoint already exists for this run id; pass --resume true to continue it.',
      );
    }
    if (existing !== undefined && existing.configFingerprint !== configFingerprint) {
      throw usage('The checkpoint configuration does not match this provider evaluation.');
    }
    let checkpoint: ProviderEvaluationCheckpoint = existing ?? {
      schemaVersion: 8,
      runId: options.runId,
      configFingerprint,
      packId: pack.manifest.packId,
      packVersion: pack.manifest.packVersion,
      corpusManifestDigest: pack.manifest.manifestDigest,
      populationDigest,
      benchmarkProtocolFingerprint,
      provider: options.provider,
      model: options.model,
      verificationMode,
      verificationRouteFingerprint,
      selectedSplit: options.split,
      ...(options.caseIdFilter === undefined ? {} : { caseIdFilter: options.caseIdFilter }),
      ...(holdoutAttestation === undefined ? {} : { holdoutAttestation }),
      repetitions: options.repetitions,
      planProfile: options.planProfile,
      measurementScope: options.measurementScope,
      executionBudget: options.executionBudget,
      maxParallelVectors: runtime.maxParallelVectors,
      modelCostCeilingState: initialModelCostCeilingState(options['max-estimated-cost-usd']),
      status: 'running',
      errorCode: null,
      startedAt,
      updatedAt: startedAt,
      trials: [],
    };
    checkpoint = {
      ...checkpoint,
      status: 'running',
      errorCode: null,
      updatedAt: startedAt,
    };
    persistedCheckpoint = checkpoint;
    await writeProviderEvaluationCheckpoint(options.output, checkpoint);
    const run = await runCorpusEvaluation({
      pack,
      modelProvider,
      provider: options.provider,
      model: options.model,
      split: options.split,
      ...(options.caseIdFilter === undefined ? {} : { caseIdFilter: options.caseIdFilter }),
      repetitions: options.repetitions,
      planProfile: options.planProfile,
      measurementScope: options.measurementScope,
      runId: options.runId,
      startedAt: checkpoint.startedAt,
      mode: 'provider',
      executionBudget: options.executionBudget,
      maxParallelVectors: runtime.maxParallelVectors,
      ...(options['max-estimated-cost-usd'] === undefined
        ? {}
        : { maxEstimatedCostUsd: options['max-estimated-cost-usd'] }),
      modelPricing: primaryModelPricing,
      modelCacheRoutingKey: providerCacheRoutingKey({
        provider: options.provider,
        model: options.model,
      }),
      verificationMode,
      verificationRouteFingerprint,
      ...(holdoutAttestation === undefined ? {} : { holdoutAttestation }),
      ...(independentVerifierRoute === undefined ? {} : { independentVerifierRoute }),
      priorTrials: checkpoint.trials.map((entry) => entry.trial),
      retryUnfinished: options.retryUnfinished,
      auditCheckpoints: createEvaluationAuditCheckpointStore({
        outputRoot: options.output,
        evaluationRunId: options.runId,
        candidateGroundingProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
        savedAt: () => new Date().toISOString(),
      }),
      planningCheckpoints: createEvaluationPlanningCheckpointStore({
        outputRoot: options.output,
        evaluationRunId: options.runId,
        configFingerprint,
        savedAt: () => new Date().toISOString(),
      }),
      expectedEvidenceTraceCheckpoints: createEvaluationExpectedEvidenceTraceCheckpointStore({
        outputRoot: options.output,
        evaluationRunId: options.runId,
        savedAt: () => new Date().toISOString(),
      }),
      promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
      onTrialComplete: async (trial) => {
        const prior = checkpoint.trials.find(
          (entry) =>
            entry.trial.caseId === trial.caseId &&
            entry.trial.variant === trial.variant &&
            entry.trial.repetition === trial.repetition,
        );
        checkpoint = {
          ...checkpoint,
          updatedAt: new Date().toISOString(),
          modelCostCeilingState: trial.modelCostCeilingState ?? checkpoint.modelCostCeilingState,
          trials: [
            ...checkpoint.trials.filter(
              (entry) =>
                entry.trial.caseId !== trial.caseId ||
                entry.trial.variant !== trial.variant ||
                entry.trial.repetition !== trial.repetition,
            ),
            { trial, attempts: (prior?.attempts ?? 0) + 1 },
          ],
        };
        persistedCheckpoint = checkpoint;
        await writeProviderEvaluationCheckpoint(options.output, checkpoint);
      },
    });
    checkpoint = {
      ...checkpoint,
      status: 'completed',
      errorCode: null,
      updatedAt: new Date().toISOString(),
      modelCostCeilingState: run.modelCostCeilingState,
    };
    persistedCheckpoint = checkpoint;
    await writeProviderEvaluationCheckpoint(options.output, checkpoint);
    const comparison =
      options.baseline === undefined
        ? undefined
        : compareEvaluationBaseline(await loadEvaluationBaseline(options.baseline), run);
    const report = renderRealWorldEvaluationReport(pack, run, comparison);
    const paths = await writeRealWorldEvaluationArtifacts(options.output, run, report);
    return {
      run,
      report,
      paths,
      exitCode: run.gatePassed && (comparison?.passed ?? true) ? 0 : 1,
    };
  } catch (error) {
    if (persistedCheckpoint !== undefined) {
      await writeProviderEvaluationCheckpoint(
        options.output,
        terminalProviderEvaluationCheckpoint(persistedCheckpoint, error, new Date().toISOString()),
      );
    }
    throw error;
  } finally {
    await lock.release();
  }
}

/**
 * Retains a source-free terminal command state when evaluation orchestration
 * fails after its resumable checkpoint has begun. Individual trial statuses
 * remain separate and are never reclassified here.
 */
export function terminalProviderEvaluationCheckpoint(
  checkpoint: ProviderEvaluationCheckpoint,
  error: unknown,
  updatedAt: string,
): ProviderEvaluationCheckpoint {
  const cancelled = error instanceof SecurityReviewerError && error.code === 'provider-cancelled';
  return ProviderEvaluationCheckpointSchema.parse({
    ...checkpoint,
    status: cancelled ? 'cancelled' : 'failed',
    errorCode: cancelled ? 'provider-cancelled' : 'evaluation-run-failed',
    updatedAt,
  });
}

async function resolveHoldoutAttestation(
  options: ProviderEvaluationOptions,
  pack: LoadedCorpusPack,
  benchmarkProtocolFingerprint: string,
): Promise<HoldoutAttestationReference | undefined> {
  validateHoldoutAttestationOptions(options);
  const attestationPath = options['holdout-attestation'];
  const publicKeyPath = options['holdout-public-key'];
  if (attestationPath === undefined || publicKeyPath === undefined) return undefined;
  return verifyHoldoutAttestation({
    attestationPath,
    publicKeyPath,
    pack,
    benchmarkProtocolFingerprint,
  });
}

export function validateHoldoutAttestationOptions(options: ProviderEvaluationOptions): void {
  const hasAttestation = options['holdout-attestation'] !== undefined;
  const hasPublicKey = options['holdout-public-key'] !== undefined;
  if (options.split === 'private-holdout' && (!hasAttestation || !hasPublicKey)) {
    throw usage(
      'Private-holdout provider evaluation requires --holdout-attestation and --holdout-public-key.',
    );
  }
  if (options.split !== 'private-holdout' && (hasAttestation || hasPublicKey)) {
    throw usage('Holdout attestation options require --split private-holdout.');
  }
}

export function validateMeasurementScope(
  options: ProviderEvaluationOptions,
  verificationMode: z.output<typeof VerificationModeSchema>,
): void {
  if (options.measurementScope !== 'planning-only') return;
  if (options.planProfile !== 'generated-plan') {
    throw usage('Planning-only evaluation requires --plan-profile generated-plan.');
  }
  if (options.baseline !== undefined) {
    throw usage('Planning-only evaluation cannot compare a finding baseline.');
  }
  if (verificationMode !== 'same-route') {
    throw usage('Planning-only evaluation cannot configure an independent verifier route.');
  }
  if (options.split === 'private-holdout') {
    throw usage('Planning-only evaluation is limited to development or test splits.');
  }
}

function resolveIndependentVerifierRoute(
  runtime: RuntimeConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
  primary: Readonly<{ provider: string; model: string }>,
  verificationMode: z.output<typeof VerificationModeSchema>,
  requestTimeoutMs: number,
): ResolvedVerificationRoute | undefined {
  if (verificationMode === 'same-route') return undefined;
  const configured = runtime.independentVerifierRoute;
  if (configured === undefined) throw usage('Independent verifier route is incomplete.');
  if (
    configured.provider === primary.provider &&
    configured.model.trim().toLowerCase() === primary.model.trim().toLowerCase()
  ) {
    throw usage('Independent verifier route must use another provider/model pair.');
  }
  const route = createConfiguredModelRoute({
    provider: configured.provider,
    model: configured.model,
    apiKeyEnvironmentVariable: configured.apiKeyEnvironmentVariable,
    modelPricing: configured.modelPricing,
    environment,
    requestTimeoutMs,
  });
  return Object.freeze({
    route: 'independent',
    modelProvider: route.modelProvider,
    modelName: route.model,
    modelPricing: route.modelPricing,
    modelCacheRoutingKey: route.modelCacheRoutingKey,
    cacheRoutingEnabled: route.modelCacheRoutingKey !== undefined,
    fingerprint: createVerificationRouteFingerprint({
      route: 'independent',
      provider: route.provider,
      model: route.model,
    }),
  });
}

function usage(message: string): SecurityReviewerError {
  return new SecurityReviewerError(
    'invalid-input',
    `${message} Usage: bun run eval:provider --provider <openai|anthropic> --model <name> [--split development] [--case-id <id>] [--repetitions 1] [--plan-profile generated-plan|reviewed-plan] [--verification-mode same-route|independent-route] [--corpus evaluation/corpora] [--baseline <exhaustive-baseline.json>] [--output evaluation/runs] [--run-id id --resume true --retry-unfinished true] [--holdout-attestation <file> --holdout-public-key <pem-file>]`,
  );
}

function initialModelCostCeilingState(configuredUsd: number | undefined) {
  return ModelCostCeilingStateSchema.parse({
    configuredUsd: configuredUsd ?? null,
    accumulatedEstimatedCostUsd: configuredUsd === undefined ? null : 0,
    reached: false,
  });
}

if (import.meta.main) {
  try {
    process.exitCode = await main(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected evaluator failure.';
    process.stderr.write(`security-reviewer provider evaluation: ${message}\n`);
    process.exitCode = 2;
  }
}
