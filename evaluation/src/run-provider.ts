import type { ModelProvider } from '@purista/harness';
import { z } from 'zod';
import {
  ModelCostCeilingStateSchema,
  ModelCostCeilingUsdSchema,
} from '../../src/features/model-operations/model-operations.schema.js';
import { catalogueModelPricing } from '../../src/features/model-operations/model-pricing-catalogue.js';
import { reviewWorkflowPromptProtocolFingerprint } from '../../src/features/review-workflow/prompt-protocol.js';
import {
  createVerificationRouteFingerprint,
  type ResolvedVerificationRoute,
} from '../../src/features/review-workflow/runtime/verification-route.js';
import { ArtifactStoreError } from '../../src/platform/artifact-store/json-artifact-store.js';
import {
  loadRuntimeConfiguration,
  ProviderNameSchema,
  type RuntimeConfiguration,
  RuntimeConfigurationDefaults,
  VerificationModeSchema,
} from '../../src/platform/configuration/environment.js';
import {
  assertLiveHarnessStructuredOutputCompatibility,
  HarnessExecutionConfigurationSchema,
  TimeoutMillisecondsOptionSchema,
} from '../../src/platform/harness/audit-harness.js';
import {
  configuredProviderCredentialState,
  createConfiguredModelRoute,
  providerCacheRoutingKey,
} from '../../src/platform/harness/provider.js';
import { ProviderStructuredOutputCompatibilitySchema } from '../../src/platform/harness/structured-output-compatibility.js';
import {
  canonicalJson,
  createStableId,
  IdentifierSchema,
  sha256,
} from '../../src/shared/contracts/core.js';
import { ModelIdentifierSchema } from '../../src/shared/contracts/model-identity.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import { compareEvaluationBaseline, loadEvaluationBaseline } from './baseline.js';
import { isEvaluationHelpRequest, parseEvaluationOptionPairs } from './command-arguments.js';
import { type LoadedCorpusPack, loadCorpusPack } from './corpus.js';
import {
  CorpusSplitSchema,
  PlanEvaluationProfileSchema,
  type ProviderEvaluationCheckpoint,
  ProviderEvaluationCheckpointSchema,
  type ProviderEvaluationFailureDomain,
  type RealWorldEvaluationRun,
} from './corpus.schema.js';
import {
  evaluationBenchmarkProtocolFingerprint,
  evaluationPopulationDigest,
} from './evaluation-identity.js';
import {
  createEvaluatorFailureDiagnosticSink,
  createEvaluatorFailureDiagnosticsStore,
} from './evaluator-failure-diagnostics.js';
import { verifyHoldoutAttestation } from './holdout-attestation.js';
import type { HoldoutAttestationReference } from './holdout-attestation.schema.js';
import { planSemanticAgentProtocolFingerprint } from './plan-semantic-agent.instructions.js';
import { evaluateGeneratedPlanSemantics } from './plan-semantic-agent.js';
import { runPlanSemanticEvaluationOperation } from './plan-semantic-operation.js';
import {
  acquireProviderEvaluationLock,
  archivePublishedProviderEvaluationArtifacts,
  createEvaluationAuditCheckpointStore,
  createEvaluationExpectedEvidenceTraceCheckpointStore,
  createEvaluationPlanningCheckpointStore,
  evaluationPlanSemanticCheckpointPath,
  inspectProviderEvaluationLock,
  ProviderEvaluationPublicationError,
  providerEvaluationStagingArtifactsExist,
  providerEvaluationTerminalArtifactsExist,
  publishProviderEvaluationArtifacts,
  readProviderEvaluationCheckpoint,
  releaseProviderEvaluationLock,
  validatePublishedProviderEvaluationArtifacts,
  writeProviderEvaluationCheckpoint,
} from './real-world-artifacts.js';
import { renderRealWorldEvaluationReport } from './real-world-report.js';
import {
  runCorpusEvaluation,
  selectCasesForEvaluation,
  selectedTrialPopulationForEvaluation,
} from './real-world-runner.js';
import { providerEvaluationStructuredOutputRegistry } from './structured-output-registry.js';

const ProviderEvaluationArgumentsSchema = z.strictObject({
  split: CorpusSplitSchema.default('development'),
  repetitions: z.coerce.number().int().positive().default(1),
  'plan-profile': PlanEvaluationProfileSchema.default('end-to-end-generated'),
  'case-id': IdentifierSchema.optional(),
  corpus: z.string().trim().min(1).optional(),
  output: z.string().trim().min(1).optional(),
  baseline: z.string().trim().min(1).optional(),
  'model-timeout-ms': TimeoutMillisecondsOptionSchema.default(0),
  'run-timeout-ms': TimeoutMillisecondsOptionSchema.default(0),
  'run-id': IdentifierSchema.optional(),
  resume: z.enum(['true', 'false']).default('false'),
  'retry-unfinished': z.enum(['true', 'false']).default('false'),
  'holdout-attestation': z.string().trim().min(1).max(1_024).optional(),
  'holdout-public-key': z.string().trim().min(1).max(1_024).optional(),
  'debug-diagnostics': z.enum(['true', 'false']).default('false'),
});

const ProviderEvaluationOptionsSchema = ProviderEvaluationArgumentsSchema.extend({
  provider: ProviderNameSchema,
  model: ModelIdentifierSchema,
  corpus: z.string().trim().min(1),
  output: z.string().trim().min(1),
  'max-estimated-cost-usd': ModelCostCeilingUsdSchema.optional(),
  executionBudget: HarnessExecutionConfigurationSchema,
  runId: IdentifierSchema,
  resume: z.boolean(),
  retryUnfinished: z.boolean(),
  planProfile: PlanEvaluationProfileSchema,
  caseIdFilter: IdentifierSchema.optional(),
  debugDiagnostics: z.boolean(),
});

export type ProviderEvaluationOptions = z.output<typeof ProviderEvaluationOptionsSchema>;

const ProviderEvaluationLockInspectArgumentsSchema = z.strictObject({
  output: z.string().trim().min(1),
  'run-id': IdentifierSchema,
});

const ProviderEvaluationLockReleaseArgumentsSchema =
  ProviderEvaluationLockInspectArgumentsSchema.extend({
    'attempt-id': IdentifierSchema,
    'checkpoint-fingerprint': z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict();

const ProviderEvaluationRouteReadinessSchema = z.strictObject({
  provider: ProviderNameSchema,
  model: ModelIdentifierSchema,
  apiKeyEnvironmentVariable: z.string().trim().min(1).max(160),
  credentialConfigured: z.boolean(),
  exactCataloguePricing: z.boolean(),
  structuredOutputCompatibility: ProviderStructuredOutputCompatibilitySchema,
});

/** Content-free, no-network readiness result for one exact provider evaluation invocation. */
export const ProviderEvaluationPreflightSchema = z.strictObject({
  primaryRoute: ProviderEvaluationRouteReadinessSchema,
  verificationMode: VerificationModeSchema,
  independentVerifierRoute: ProviderEvaluationRouteReadinessSchema.nullable(),
  corpus: z.strictObject({
    packId: IdentifierSchema,
    packVersion: z.string().trim().min(1).max(160),
    manifestDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    selectedCaseCount: z.number().int().positive(),
  }),
  split: CorpusSplitSchema,
  repetitions: z.number().int().positive(),
  planProfile: PlanEvaluationProfileSchema,
  populationDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  benchmarkProtocolFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  configFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  holdoutAttestationVerified: z.boolean(),
});
export type ProviderEvaluationPreflight = z.output<typeof ProviderEvaluationPreflightSchema>;

type ProviderEvaluationCheckpointPhase =
  | 'checkpoint'
  | 'audit-work'
  | 'finalization'
  | 'publication'
  | 'shutdown';

type ProviderEvaluationAttemptBaseline = Readonly<{
  modelDispatchCount: number;
  stageCount: number;
  estimatedCostUsd: number | null;
  modelDurationMs: number;
}>;

/** Marks a command-checkpoint write boundary without retaining the triggering payload. */
class ProviderEvaluationCheckpointPersistenceError extends Error {
  public constructor() {
    super('Provider evaluation checkpoint persistence failed.');
    this.name = 'ProviderEvaluationCheckpointPersistenceError';
  }
}

/** Resolves the configured primary route through the bundled exact-model catalogue. */
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
    provider: runtime?.provider,
    model: runtime?.model,
    corpus:
      parsedArguments.data.corpus ??
      runtime?.evaluationCorpusRoot ??
      RuntimeConfigurationDefaults.evaluationCorpusRoot,
    output:
      parsedArguments.data.output ??
      runtime?.evaluationOutputRoot ??
      RuntimeConfigurationDefaults.evaluationOutputRoot,
    baseline: parsedArguments.data.baseline,
    'max-estimated-cost-usd': runtime?.maxEstimatedCostUsd,
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
    caseIdFilter: parsedArguments.data['case-id'],
    debugDiagnostics: parsedArguments.data['debug-diagnostics'] === 'true',
  });
  if (!parsed.success) throw usage('Invalid provider evaluation options.');
  return parsed.data;
}

async function main(argv: readonly string[]): Promise<number> {
  if (isEvaluationHelpRequest(argv)) {
    process.stdout.write(`${providerEvaluationUsage}\n`);
    return 0;
  }
  if (argv[0] === 'inspect-lock' || argv[0] === 'release-lock') {
    const result = await runProviderEvaluationLockCommand(argv);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
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

/** Runs a source-free provider-evaluation lock inspection or exact-confirmed release. */
export async function runProviderEvaluationLockCommand(argv: readonly string[]): Promise<
  Readonly<{
    operation: 'inspect-lock' | 'release-lock';
    inspection: Awaited<ReturnType<typeof inspectProviderEvaluationLock>>;
  }>
> {
  const [operation, ...optionArguments] = argv;
  const values = parseEvaluationOptionPairs(optionArguments);
  if (operation === 'inspect-lock') {
    const parsed = ProviderEvaluationLockInspectArgumentsSchema.safeParse(values);
    if (!parsed.success) throw lockUsage('Invalid provider evaluation lock inspection options.');
    return {
      operation,
      inspection: await inspectProviderEvaluationLock({
        outputRoot: parsed.data.output,
        runId: parsed.data['run-id'],
      }),
    };
  }
  if (operation === 'release-lock') {
    const parsed = ProviderEvaluationLockReleaseArgumentsSchema.safeParse(values);
    if (!parsed.success) throw lockUsage('Invalid provider evaluation lock release options.');
    await releaseProviderEvaluationLock({
      outputRoot: parsed.data.output,
      runId: parsed.data['run-id'],
      attemptId: parsed.data['attempt-id'],
      checkpointFingerprint: parsed.data['checkpoint-fingerprint'],
    });
    return {
      operation,
      inspection: await inspectProviderEvaluationLock({
        outputRoot: parsed.data.output,
        runId: parsed.data['run-id'],
      }),
    };
  }
  throw lockUsage('Expected inspect-lock or release-lock.');
}

/**
 * Validates every provider-free prerequisite for an exact evaluation invocation.
 * It does not construct a provider, send source, create an output artifact, or make a network call.
 */
export async function preflightProviderEvaluation(input: {
  options: ProviderEvaluationOptions;
  runtime: RuntimeConfiguration;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<ProviderEvaluationPreflight> {
  return (await prepareProviderEvaluation({ ...input, requirePrimaryCredential: true })).summary;
}

/** Executes an explicitly configured provider evaluation; tests may supply an in-process provider. */
export async function runProviderEvaluation(input: {
  options: ProviderEvaluationOptions;
  runtime: RuntimeConfiguration;
  environment: Readonly<Record<string, string | undefined>>;
  modelProvider?: ModelProvider;
  /**
   * Application-owned checkpoint persistence port. The command validates a
   * stable read beneath its exclusive lease before it makes any run decision.
   */
  checkpointReader?: (
    outputRoot: string,
    runId: string,
  ) => Promise<ProviderEvaluationCheckpoint | undefined>;
  checkpointWriter?: (
    outputRoot: string,
    checkpoint: ProviderEvaluationCheckpoint,
  ) => Promise<void>;
}): Promise<{
  run: RealWorldEvaluationRun;
  report: string;
  paths: Readonly<{
    jsonPath: string;
    markdownPath: string;
    trialTracePath: string;
    manifestPath: string;
  }>;
  exitCode: number;
}> {
  const { options } = input;
  const checkpointWriter = input.checkpointWriter ?? writeProviderEvaluationCheckpoint;
  const prepared = await prepareProviderEvaluation({
    options,
    runtime: input.runtime,
    environment: input.environment,
    requirePrimaryCredential: input.modelProvider === undefined,
  });
  const {
    verificationMode,
    pack,
    populationDigest,
    benchmarkProtocolFingerprint,
    configFingerprint,
    semanticPlanEvaluator,
  } = prepared;
  const { verificationRouteFingerprint, holdoutAttestation } = prepared;
  const selectedTrialPopulation = selectedTrialPopulationForEvaluation(
    pack,
    options.split,
    options.caseIdFilter,
    options.repetitions,
  );
  const startedAt = new Date().toISOString();
  const {
    checkpoint: existingBeforeLock,
    lock,
    attempt: lockAttempt,
  } = await acquireStableProviderEvaluationOwnership({
    outputRoot: options.output,
    runId: options.runId,
    configFingerprint,
    startedAt,
    retryUnfinished: options.retryUnfinished,
    checkpointReader: input.checkpointReader ?? readProviderEvaluationCheckpoint,
  });
  let persistedCheckpoint: ProviderEvaluationCheckpoint | undefined;
  let attemptBaseline: ProviderEvaluationAttemptBaseline | undefined;
  let phase: ProviderEvaluationCheckpointPhase = 'checkpoint';
  try {
    const existing = existingBeforeLock;
    if (existing === undefined && options.resume) {
      throw usage('Cannot resume because no checkpoint exists for this run id.');
    }
    if (existing !== undefined && !options.resume) {
      throw usage(
        'A checkpoint already exists for this run id; pass --resume true to continue it.',
      );
    }
    if (
      existing === undefined &&
      (await providerEvaluationTerminalArtifactsExist({
        outputRoot: options.output,
        runId: options.runId,
      }))
    ) {
      throw usage(
        'Terminal evaluation artifacts already exist for this run id; choose a new run id or recover its checkpoint.',
      );
    }
    if (
      existing === undefined &&
      (await providerEvaluationStagingArtifactsExist({
        outputRoot: options.output,
        runId: options.runId,
      }))
    ) {
      throw usage(
        'Provider evaluation staging artifacts already exist for this run id; resolve them before starting a fresh run.',
      );
    }
    const retryFinalizedUnfinished = canRetryFinalizedUnfinishedEvaluation(existing, options);
    if (existing?.status === 'completed' && !retryFinalizedUnfinished) {
      throw usage(
        'A completed provider evaluation cannot be resumed unless --retry-unfinished true selects retained unfinished trials.',
      );
    }
    assertFinalizationRecoveryIsAutomaticOnlyForRenameFailure(existing);
    if (existing !== undefined && existing.configFingerprint !== configFingerprint) {
      throw usage('The checkpoint configuration does not match this provider evaluation.');
    }
    if (
      existing !== undefined &&
      canonicalJson(existing.selectedTrialPopulation) !== canonicalJson(selectedTrialPopulation)
    ) {
      throw usage(
        'The checkpoint selected trial population does not match this provider evaluation.',
      );
    }
    let checkpoint: ProviderEvaluationCheckpoint = existing ?? {
      schemaVersion: 15,
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
      semanticPlanEvaluator,
      executionBudget: options.executionBudget,
      maxParallelVectors: input.runtime.maxParallelVectors,
      modelCostCeilingState: initialModelCostCeilingState(options['max-estimated-cost-usd']),
      status: 'created',
      failure: null,
      startedAt,
      updatedAt: startedAt,
      selectedTrialPopulation,
      trials: [],
      activeAttempt: null,
      attempts: [],
      finalization: null,
    };
    if (retryFinalizedUnfinished) {
      try {
        await validatePublishedProviderEvaluationArtifacts({
          outputRoot: options.output,
          checkpoint,
        });
      } catch (error) {
        if (!(error instanceof ArtifactStoreError) || error.code !== 'artifact-not-found')
          throw error;
      }
      await archivePublishedProviderEvaluationArtifacts({
        outputRoot: options.output,
        runId: checkpoint.runId,
        publishedAttemptId: checkpoint.attempts.at(-1)?.attemptId ?? lockAttempt.attemptId,
      });
      checkpoint = ProviderEvaluationCheckpointSchema.parse({
        ...checkpoint,
        status: 'created',
        failure: null,
        updatedAt: startedAt,
        activeAttempt: null,
        finalization: null,
      });
    }
    const attempt = lockAttempt;
    attemptBaseline = providerEvaluationAttemptBaseline(checkpoint);
    const resumeFinalization = checkpoint.finalization !== null;
    checkpoint = {
      ...checkpoint,
      status: resumeFinalization ? 'finalizing' : 'running',
      failure: null,
      updatedAt: startedAt,
      activeAttempt: attempt,
    };
    persistedCheckpoint = checkpoint;
    await persistProviderEvaluationCheckpoint(checkpointWriter, options.output, checkpoint);
    if (resumeFinalization) {
      const finalization = checkpoint.finalization;
      if (finalization === null) throw new Error('Provider finalization was lost.');
      phase = 'publication';
      const finalizationStartedAt = performance.now();
      const paths = await recoverOrPublishProviderEvaluationArtifacts({
        outputRoot: options.output,
        checkpoint,
        attemptId: attempt.attemptId,
      });
      checkpoint = completeProviderEvaluationCheckpoint({
        checkpoint,
        attempt,
        attemptBaseline,
        finalizationDurationMs: Math.round(performance.now() - finalizationStartedAt),
      });
      persistedCheckpoint = checkpoint;
      await persistProviderEvaluationCheckpoint(checkpointWriter, options.output, checkpoint);
      return {
        run: finalization.run,
        report: finalization.report,
        paths,
        exitCode: finalization.run.diagnosticGatePassed ? 0 : 1,
      };
    }

    const modelProvider =
      input.modelProvider ??
      createConfiguredModelRoute({
        provider: options.provider,
        model: options.model,
        apiKeyEnvironmentVariable: input.runtime.apiKeyEnvironmentVariable,
        modelPricing: prepared.primaryModelPricing,
        environment: input.environment,
        requestTimeoutMs: options.executionBudget.modelTimeoutMs,
      }).modelProvider;
    const independentVerifierRoute =
      prepared.independentVerifierConfiguration === undefined
        ? undefined
        : createIndependentVerifierRoute(
            prepared.independentVerifierConfiguration,
            input.environment,
            options.executionBudget.modelTimeoutMs,
          );
    const modelCacheRoutingKey = providerCacheRoutingKey({
      provider: options.provider,
      model: options.model,
    });
    const evaluatorFailureDiagnosticsStore = options.debugDiagnostics
      ? createEvaluatorFailureDiagnosticsStore({
          outputRoot: options.output,
          evaluationRunId: options.runId,
          privateWorkPath: `.provider-evaluations/${options.runId}/work`,
        })
      : undefined;
    const auditFailureDiagnosticSink =
      evaluatorFailureDiagnosticsStore === undefined
        ? undefined
        : createEvaluatorFailureDiagnosticSink({
            store: evaluatorFailureDiagnosticsStore,
            evaluationRunId: options.runId,
            protocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
            now: () => new Date().toISOString(),
          });
    const semanticPlanFailureDiagnosticSink =
      evaluatorFailureDiagnosticsStore === undefined
        ? undefined
        : createEvaluatorFailureDiagnosticSink({
            store: evaluatorFailureDiagnosticsStore,
            evaluationRunId: options.runId,
            protocolFingerprint: planSemanticAgentProtocolFingerprint,
            now: () => new Date().toISOString(),
          });
    phase = 'audit-work';
    const run = await runCorpusEvaluation({
      pack,
      modelProvider,
      provider: options.provider,
      model: options.model,
      split: options.split,
      ...(options.caseIdFilter === undefined ? {} : { caseIdFilter: options.caseIdFilter }),
      repetitions: options.repetitions,
      planProfile: options.planProfile,
      runId: options.runId,
      startedAt: checkpoint.startedAt,
      mode: 'provider',
      executionBudget: options.executionBudget,
      maxParallelVectors: input.runtime.maxParallelVectors,
      ...(options['max-estimated-cost-usd'] === undefined
        ? {}
        : { maxEstimatedCostUsd: options['max-estimated-cost-usd'] }),
      modelPricing: prepared.primaryModelPricing,
      modelCacheRoutingKey,
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
      ...(auditFailureDiagnosticSink === undefined
        ? {}
        : { evaluatorFailureDiagnosticSink: auditFailureDiagnosticSink }),
      ...(options.planProfile === 'audit-reviewed-plan'
        ? {}
        : {
            semanticPlanEvaluator: {
              evaluate: ({ binding, plan, answerKey, retryUnfinished, modelCostCeiling }) =>
                runPlanSemanticEvaluationOperation({
                  outputRoot: options.output,
                  checkpointPath: evaluationPlanSemanticCheckpointPath(
                    options.runId,
                    binding.trialId,
                  ),
                  binding,
                  plan,
                  answerKey,
                  retry: retryUnfinished,
                  now: () => new Date().toISOString(),
                  modelCostCeiling,
                  invokeEvaluator: () =>
                    evaluateGeneratedPlanSemantics({
                      provider: options.provider,
                      modelProvider,
                      modelName: options.model,
                      execution: options.executionBudget,
                      sessionId: `plan-semantic-${binding.trialId}`,
                      binding,
                      plan,
                      answerKey,
                      reviewer: 'plan-semantic-evaluator',
                      reviewedAt: new Date().toISOString(),
                      modelPricing: prepared.primaryModelPricing,
                      ...(semanticPlanFailureDiagnosticSink === undefined
                        ? {}
                        : { evaluatorFailureDiagnosticSink: semanticPlanFailureDiagnosticSink }),
                      ...(modelCacheRoutingKey === undefined ? {} : { modelCacheRoutingKey }),
                      ...(modelCostCeiling === undefined ? {} : { modelCostCeiling }),
                    }),
                }),
            },
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
        await persistProviderEvaluationCheckpoint(checkpointWriter, options.output, checkpoint);
      },
    });
    const comparison =
      options.baseline === undefined
        ? undefined
        : compareEvaluationBaseline(await loadEvaluationBaseline(options.baseline), run);
    const report = renderRealWorldEvaluationReport(pack, run, comparison);
    phase = 'finalization';
    checkpoint = ProviderEvaluationCheckpointSchema.parse({
      ...checkpoint,
      status: 'finalizing',
      failure: null,
      updatedAt: new Date().toISOString(),
      modelCostCeilingState: run.modelCostCeilingState,
      finalization: {
        run,
        report,
        aggregateDigest: sha256(canonicalJson(run)),
        frozenAt: new Date().toISOString(),
      },
    });
    persistedCheckpoint = checkpoint;
    await persistProviderEvaluationCheckpoint(checkpointWriter, options.output, checkpoint);
    phase = 'publication';
    const finalizationStartedAt = performance.now();
    const paths = await recoverOrPublishProviderEvaluationArtifacts({
      outputRoot: options.output,
      checkpoint,
      attemptId: attempt.attemptId,
    });
    checkpoint = completeProviderEvaluationCheckpoint({
      checkpoint,
      attempt,
      attemptBaseline,
      finalizationDurationMs: Math.round(performance.now() - finalizationStartedAt),
    });
    persistedCheckpoint = checkpoint;
    await persistProviderEvaluationCheckpoint(checkpointWriter, options.output, checkpoint);
    return {
      run,
      report,
      paths,
      exitCode: run.diagnosticGatePassed && (comparison?.passed ?? true) ? 0 : 1,
    };
  } catch (error) {
    if (persistedCheckpoint !== undefined) {
      phase = phase === 'checkpoint' ? 'checkpoint' : phase;
      await persistProviderEvaluationCheckpoint(
        checkpointWriter,
        options.output,
        terminalProviderEvaluationCheckpoint(
          persistedCheckpoint,
          error,
          new Date().toISOString(),
          phase,
          attemptBaseline,
        ),
      );
    }
    throw error;
  } finally {
    await lock.release();
  }
}

async function persistProviderEvaluationCheckpoint(
  checkpointWriter: (outputRoot: string, checkpoint: ProviderEvaluationCheckpoint) => Promise<void>,
  outputRoot: string,
  checkpoint: ProviderEvaluationCheckpoint,
): Promise<void> {
  try {
    await checkpointWriter(outputRoot, checkpoint);
  } catch {
    throw new ProviderEvaluationCheckpointPersistenceError();
  }
}

async function prepareProviderEvaluation(input: {
  options: ProviderEvaluationOptions;
  runtime: RuntimeConfiguration;
  environment: Readonly<Record<string, string | undefined>>;
  requirePrimaryCredential: boolean;
}) {
  const { options, runtime, environment } = input;
  const primaryStructuredOutputCompatibility = providerEvaluationStructuredOutputCompatibility({
    provider: options.provider,
    planProfile: options.planProfile,
  });
  const primaryModelPricing = primaryModelPricingForEvaluation(options);
  requireExactCataloguePricing(primaryModelPricing, 'primary provider route');
  const primaryCredential = configuredProviderCredentialState({
    provider: options.provider,
    apiKeyEnvironmentVariable: runtime.apiKeyEnvironmentVariable,
    environment,
  });
  if (input.requirePrimaryCredential && !primaryCredential.configured) {
    throw usage(
      `The configured primary API key environment variable ${primaryCredential.environmentVariable} is not set.`,
    );
  }
  const verificationMode = runtime.verificationMode;
  validatePlanningProfile(options, verificationMode);
  const independentVerifierConfiguration = resolveIndependentVerifierConfiguration(
    runtime,
    { provider: options.provider, model: options.model },
    verificationMode,
  );
  const independentStructuredOutputCompatibility =
    independentVerifierConfiguration === undefined
      ? undefined
      : providerEvaluationStructuredOutputCompatibility({
          provider: independentVerifierConfiguration.provider,
          planProfile: options.planProfile,
        });
  const independentCredential =
    independentVerifierConfiguration === undefined
      ? undefined
      : configuredProviderCredentialState({
          provider: independentVerifierConfiguration.provider,
          apiKeyEnvironmentVariable: independentVerifierConfiguration.apiKeyEnvironmentVariable,
          environment,
        });
  if (
    input.requirePrimaryCredential &&
    independentCredential !== undefined &&
    !independentCredential.configured
  ) {
    throw usage(
      `The configured verifier API key environment variable ${independentCredential.environmentVariable} is not set.`,
    );
  }
  if (independentVerifierConfiguration !== undefined) {
    requireExactCataloguePricing(
      independentVerifierConfiguration.modelPricing,
      'independent verifier route',
    );
  }
  const verificationRouteFingerprint =
    independentVerifierConfiguration === undefined
      ? createVerificationRouteFingerprint({
          route: 'primary',
          provider: options.provider,
          model: options.model,
        })
      : createVerificationRouteFingerprint({
          route: 'independent',
          provider: independentVerifierConfiguration.provider,
          model: independentVerifierConfiguration.model,
        });
  const semanticPlanEvaluator = semanticPlanEvaluatorForProfile(options.planProfile);
  const pack = await loadCorpusPack(options.corpus);
  const selectedCases = selectCasesForEvaluation(pack, options.split, options.caseIdFilter);
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
    executionBudget: options.executionBudget,
    maxParallelVectors: runtime.maxParallelVectors,
    promptProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    semanticPlanEvaluator,
  });
  const holdoutAttestation = await resolveHoldoutAttestation(
    options,
    pack,
    benchmarkProtocolFingerprint,
  );
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
        providerCacheRoutingKey({ provider: options.provider, model: options.model }) !== undefined,
      primaryStructuredOutputCompatibility:
        primaryStructuredOutputCompatibility.compatibilityFingerprint,
      independentStructuredOutputCompatibility:
        independentStructuredOutputCompatibility?.compatibilityFingerprint ?? null,
      holdoutAttestation: holdoutAttestation ?? null,
    }),
  );
  const summary = ProviderEvaluationPreflightSchema.parse({
    primaryRoute: {
      provider: options.provider,
      model: options.model,
      apiKeyEnvironmentVariable: primaryCredential.environmentVariable,
      credentialConfigured: primaryCredential.configured,
      exactCataloguePricing: true,
      structuredOutputCompatibility: primaryStructuredOutputCompatibility,
    },
    verificationMode,
    independentVerifierRoute:
      independentVerifierConfiguration === undefined ||
      independentCredential === undefined ||
      independentStructuredOutputCompatibility === undefined
        ? null
        : {
            provider: independentVerifierConfiguration.provider,
            model: independentVerifierConfiguration.model,
            apiKeyEnvironmentVariable: independentCredential.environmentVariable,
            credentialConfigured: independentCredential.configured,
            exactCataloguePricing: true,
            structuredOutputCompatibility: independentStructuredOutputCompatibility,
          },
    corpus: {
      packId: pack.manifest.packId,
      packVersion: pack.manifest.packVersion,
      manifestDigest: pack.manifest.manifestDigest,
      selectedCaseCount: selectedCases.length,
    },
    split: options.split,
    repetitions: options.repetitions,
    planProfile: options.planProfile,
    populationDigest,
    benchmarkProtocolFingerprint,
    configFingerprint,
    holdoutAttestationVerified: holdoutAttestation !== undefined,
  });
  return Object.freeze({
    summary,
    pack,
    primaryModelPricing,
    verificationMode,
    verificationRouteFingerprint,
    holdoutAttestation,
    independentVerifierConfiguration,
    semanticPlanEvaluator,
    populationDigest,
    benchmarkProtocolFingerprint,
    configFingerprint,
  });
}

/**
 * One evaluation route has every product output contract, plus the evaluator
 * plan-semantic contract when that selected profile dispatches it. This runs
 * before corpus access, checkpoints, providers, or target inventory.
 */
function providerEvaluationStructuredOutputCompatibility(input: {
  provider: string;
  planProfile: z.output<typeof PlanEvaluationProfileSchema>;
}) {
  return assertLiveHarnessStructuredOutputCompatibility({
    provider: input.provider,
    registry: providerEvaluationStructuredOutputRegistry(
      input.planProfile !== 'audit-reviewed-plan',
    ),
  });
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
  phase: ProviderEvaluationCheckpointPhase = 'audit-work',
  attemptBaseline: ProviderEvaluationAttemptBaseline | undefined = undefined,
): ProviderEvaluationCheckpoint {
  const cancelled = error instanceof AuditRuntimeError && error.code === 'provider-cancelled';
  const failureDomain = providerEvaluationFailureDomain({ error, cancelled, phase });
  const recoveryDisposition = providerEvaluationRecoveryDisposition({
    checkpoint,
    error,
    failureDomain,
    phase,
  });
  const activeAttempt = checkpoint.activeAttempt;
  const attempt = activeAttempt ?? {
    attemptId: createStableId(
      'provider-evaluation-recovery-attempt',
      `${checkpoint.runId}\0${updatedAt}\0${checkpoint.attempts.length}`,
    ),
    mode: checkpoint.finalization === null ? 'resume-work' : 'resume-finalization',
    startedAt: updatedAt,
    startingStatus: checkpoint.status,
  };
  const baseline = attemptBaseline ?? providerEvaluationAttemptBaseline(checkpoint);
  return ProviderEvaluationCheckpointSchema.parse({
    ...checkpoint,
    status: cancelled ? 'cancelled' : 'failed',
    failure: {
      domain: failureDomain,
      code: cancelled ? 'provider-cancelled' : `provider-evaluation-${phase}-failed`,
      publicationReason: providerEvaluationPublicationReason({ error, failureDomain }),
      phase,
      attemptId: attempt.attemptId,
      affectedTrialIds: [],
      affectedStageIds: [],
      recoveryDisposition,
    },
    updatedAt,
    activeAttempt: null,
    attempts: [
      ...checkpoint.attempts,
      completedProviderEvaluationAttempt({
        checkpoint,
        attempt,
        baseline,
        endedAt: updatedAt,
        outcome: cancelled ? 'cancelled' : 'failed',
        failureCodes: [cancelled ? 'provider-cancelled' : `provider-evaluation-${phase}-failed`],
        finalizationDurationMs: 0,
      }),
    ],
  });
}

/**
 * Claims the run lease around an unchanged checkpoint snapshot. Reading before
 * and after ownership prevents a just-finished command from being overwritten
 * or charged again by a contender that observed an older checkpoint.
 */
async function acquireStableProviderEvaluationOwnership(input: {
  outputRoot: string;
  runId: string;
  configFingerprint: string;
  startedAt: string;
  retryUnfinished: boolean;
  checkpointReader: (
    outputRoot: string,
    runId: string,
  ) => Promise<ProviderEvaluationCheckpoint | undefined>;
}): Promise<
  Readonly<{
    checkpoint: ProviderEvaluationCheckpoint | undefined;
    lock: Awaited<ReturnType<typeof acquireProviderEvaluationLock>>;
    attempt: ReturnType<typeof createProviderEvaluationActiveAttempt>;
  }>
> {
  for (;;) {
    const candidate = await input.checkpointReader(input.outputRoot, input.runId);
    const attempt = createProviderEvaluationActiveAttempt({
      checkpoint:
        candidate ??
        ({
          runId: input.runId,
          status: 'created',
          finalization: null,
          attempts: [],
        } satisfies Pick<
          ProviderEvaluationCheckpoint,
          'runId' | 'status' | 'finalization' | 'attempts'
        >),
      startedAt: input.startedAt,
      retryUnfinished: input.retryUnfinished,
    });
    const lock = await acquireProviderEvaluationLock(input.outputRoot, input.runId, {
      attemptId: attempt.attemptId,
      checkpointFingerprint: candidate?.configFingerprint ?? input.configFingerprint,
      createdAt: input.startedAt,
      commandMode: attempt.mode,
    });
    try {
      const observed = await input.checkpointReader(input.outputRoot, input.runId);
      if (sameProviderEvaluationCheckpoint(candidate, observed)) {
        return { checkpoint: observed, lock, attempt };
      }
    } catch (error) {
      await lock.release();
      throw error;
    }
    await lock.release();
  }
}

function sameProviderEvaluationCheckpoint(
  left: ProviderEvaluationCheckpoint | undefined,
  right: ProviderEvaluationCheckpoint | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(z.json().parse(left)) === canonicalJson(z.json().parse(right));
}

function createProviderEvaluationActiveAttempt(input: {
  checkpoint: Pick<ProviderEvaluationCheckpoint, 'runId' | 'status' | 'finalization' | 'attempts'>;
  startedAt: string;
  retryUnfinished: boolean;
}) {
  const mode =
    input.checkpoint.status === 'completed' &&
    input.retryUnfinished &&
    finalizedEvaluationHasUnfinishedTrials(input.checkpoint)
      ? 'resume-work'
      : input.checkpoint.finalization !== null
        ? 'resume-finalization'
        : input.checkpoint.status === 'created'
          ? 'fresh'
          : 'resume-work';
  return {
    attemptId: createStableId(
      'provider-evaluation-attempt',
      `${input.checkpoint.runId}\0${input.startedAt}\0${input.checkpoint.attempts.length}\0${mode}`,
    ),
    mode,
    startedAt: input.startedAt,
    startingStatus: input.checkpoint.status,
  } as const;
}

/** A published diagnostic remains immutable unless the operator explicitly retries only its gaps. */
function canRetryFinalizedUnfinishedEvaluation(
  checkpoint: ProviderEvaluationCheckpoint | undefined,
  options: Pick<ProviderEvaluationOptions, 'resume' | 'retryUnfinished'>,
): checkpoint is ProviderEvaluationCheckpoint {
  return (
    checkpoint?.status === 'completed' &&
    options.resume &&
    options.retryUnfinished &&
    finalizedEvaluationHasUnfinishedTrials(checkpoint)
  );
}

function finalizedEvaluationHasUnfinishedTrials(
  checkpoint: Pick<ProviderEvaluationCheckpoint, 'finalization'>,
): boolean {
  return checkpoint.finalization?.run.trials.some((trial) => trial.status !== 'completed') ?? false;
}

function providerEvaluationAttemptBaseline(
  checkpoint: ProviderEvaluationCheckpoint,
): ProviderEvaluationAttemptBaseline {
  return providerEvaluationTrialStats(checkpoint.trials.map((entry) => entry.trial));
}

function providerEvaluationTrialStats(
  trials: readonly ProviderEvaluationCheckpoint['trials'][number]['trial'][],
): ProviderEvaluationAttemptBaseline {
  let modelDispatchCount = 0;
  let stageCount = 0;
  let estimatedCostUsd = 0;
  let modelDurationMs = 0;
  let unavailableCost = false;
  for (const trial of trials) {
    const observation = trial.modelObservation;
    if (observation === null || observation === undefined) continue;
    for (const stage of observation.stages) {
      stageCount += 1;
      modelDispatchCount += stage.usage.modelCallCount;
      modelDurationMs += stage.durationMs;
      if (stage.cost.estimatedCostUsd === null) unavailableCost = true;
      else estimatedCostUsd += stage.cost.estimatedCostUsd;
    }
  }
  return {
    modelDispatchCount,
    stageCount,
    estimatedCostUsd: unavailableCost ? null : estimatedCostUsd,
    modelDurationMs,
  };
}

function completeProviderEvaluationCheckpoint(input: {
  checkpoint: ProviderEvaluationCheckpoint;
  attempt: NonNullable<ProviderEvaluationCheckpoint['activeAttempt']>;
  attemptBaseline: ProviderEvaluationAttemptBaseline;
  finalizationDurationMs: number;
}): ProviderEvaluationCheckpoint {
  const updatedAt = new Date().toISOString();
  return ProviderEvaluationCheckpointSchema.parse({
    ...input.checkpoint,
    status: 'completed',
    failure: null,
    updatedAt,
    activeAttempt: null,
    attempts: [
      ...input.checkpoint.attempts,
      completedProviderEvaluationAttempt({
        checkpoint: input.checkpoint,
        attempt: input.attempt,
        baseline: input.attemptBaseline,
        endedAt: updatedAt,
        outcome: 'completed',
        failureCodes: [],
        finalizationDurationMs: input.finalizationDurationMs,
      }),
    ],
  });
}

function completedProviderEvaluationAttempt(input: {
  checkpoint: ProviderEvaluationCheckpoint;
  attempt: NonNullable<ProviderEvaluationCheckpoint['activeAttempt']>;
  baseline: ProviderEvaluationAttemptBaseline;
  endedAt: string;
  outcome: 'completed' | 'failed' | 'cancelled';
  failureCodes: readonly string[];
  finalizationDurationMs: number;
}) {
  const current = providerEvaluationAttemptBaseline(input.checkpoint);
  const latestAttemptWallDurationMs = Math.max(
    0,
    Date.parse(input.endedAt) - Date.parse(input.attempt.startedAt),
  );
  const priorActiveDurationMs = input.checkpoint.attempts.reduce(
    (total, attempt) => total + attempt.metrics.latestAttemptWallDurationMs,
    0,
  );
  const newEstimatedCostUsd =
    current.estimatedCostUsd === null || input.baseline.estimatedCostUsd === null
      ? null
      : Math.max(0, current.estimatedCostUsd - input.baseline.estimatedCostUsd);
  return {
    ...input.attempt,
    endedAt: input.endedAt,
    endingStatus:
      input.outcome === 'completed'
        ? 'completed'
        : input.outcome === 'cancelled'
          ? 'cancelled'
          : 'failed',
    outcome: input.outcome,
    metrics: {
      modelDispatchCount: Math.max(
        0,
        current.modelDispatchCount - input.baseline.modelDispatchCount,
      ),
      reusedStageCount: input.baseline.stageCount,
      newEstimatedCostUsd,
      cumulativeEstimatedCostUsd: current.estimatedCostUsd,
      latestAttemptWallDurationMs,
      cumulativeActiveWallDurationMs: priorActiveDurationMs + latestAttemptWallDurationMs,
      summedModelDurationMs: Math.max(0, current.modelDurationMs - input.baseline.modelDurationMs),
      finalizationDurationMs: input.finalizationDurationMs,
    },
    failureCodes: [...input.failureCodes],
  };
}

async function recoverOrPublishProviderEvaluationArtifacts(input: {
  outputRoot: string;
  checkpoint: ProviderEvaluationCheckpoint;
  attemptId: string;
}): Promise<
  Readonly<{
    jsonPath: string;
    markdownPath: string;
    trialTracePath: string;
    manifestPath: string;
  }>
> {
  const paths = {
    jsonPath: `${input.checkpoint.runId}/evaluation-run.json`,
    markdownPath: `${input.checkpoint.runId}/evaluation-report.md`,
    trialTracePath: `${input.checkpoint.runId}/case-results.jsonl`,
    manifestPath: `${input.checkpoint.runId}/terminal-manifest.json`,
  };
  try {
    await validatePublishedProviderEvaluationArtifacts({
      outputRoot: input.outputRoot,
      checkpoint: input.checkpoint,
    });
    return paths;
  } catch (error) {
    if (!(error instanceof ArtifactStoreError) || error.code !== 'artifact-not-found') throw error;
  }
  return publishProviderEvaluationArtifacts({
    outputRoot: input.outputRoot,
    checkpoint: input.checkpoint,
    attemptId: input.attemptId,
    publishedAt: new Date().toISOString(),
  });
}

function providerEvaluationFailureDomain(input: {
  error: unknown;
  cancelled: boolean;
  phase: ProviderEvaluationCheckpointPhase;
}) {
  if (input.cancelled) return 'provider-cancelled' as const;
  if (input.error instanceof ProviderEvaluationCheckpointPersistenceError) {
    return 'checkpoint-persistence' as const;
  }
  if (input.error instanceof AuditRuntimeError) {
    if (input.error.code === 'provider-response-invalid') return 'model-contract' as const;
    if (input.error.code.startsWith('provider-')) return 'provider' as const;
  }
  if (input.error instanceof ArtifactStoreError) {
    if (input.phase === 'publication' && input.error.code === 'artifact-schema-invalid') {
      return 'artifact-validation' as const;
    }
    if (input.phase === 'publication') return 'artifact-publication' as const;
    if (input.phase === 'finalization') return 'artifact-validation' as const;
  }
  switch (input.phase) {
    case 'checkpoint':
      return 'checkpoint-persistence' as const;
    case 'finalization':
      return 'artifact-validation' as const;
    case 'publication':
      return 'artifact-publication' as const;
    case 'shutdown':
      return 'operator-stop' as const;
    case 'audit-work':
      return 'audit-workflow' as const;
  }
}

function providerEvaluationPublicationReason(input: {
  error: unknown;
  failureDomain: ProviderEvaluationFailureDomain;
}) {
  if (input.failureDomain !== 'artifact-publication') return null;
  if (input.error instanceof ProviderEvaluationPublicationError) {
    return input.error.publicationReason;
  }
  return 'publication-unknown' as const;
}

function providerEvaluationRecoveryDisposition(input: {
  checkpoint: ProviderEvaluationCheckpoint;
  error: unknown;
  failureDomain: ProviderEvaluationFailureDomain;
  phase: ProviderEvaluationCheckpointPhase;
}) {
  if (input.phase !== 'publication') {
    return input.checkpoint.finalization === null ? 'resume-work' : 'resume-finalization';
  }
  if (input.failureDomain === 'artifact-publication') {
    return input.error instanceof ProviderEvaluationPublicationError &&
      input.error.publicationReason === 'rename-failed'
      ? ('resume-finalization' as const)
      : ('operator-action-required' as const);
  }
  return input.failureDomain === 'artifact-validation'
    ? ('operator-action-required' as const)
    : ('resume-finalization' as const);
}

/**
 * A frozen finalization is normally safe to publish after an interrupted
 * process. A terminal failure is different: only the atomic-rename failure
 * has a defined, idempotent recovery operation. All other stopped
 * finalizations deliberately remain untouched for operator inspection.
 */
function assertFinalizationRecoveryIsAutomaticOnlyForRenameFailure(
  checkpoint: ProviderEvaluationCheckpoint | undefined,
): void {
  if (checkpoint?.finalization === null || checkpoint?.finalization === undefined) return;
  const failure = checkpoint.failure;
  if (failure === null) return;
  const canResume =
    checkpoint.status === 'failed' &&
    failure.domain === 'artifact-publication' &&
    failure.phase === 'publication' &&
    failure.publicationReason === 'rename-failed' &&
    failure.recoveryDisposition === 'resume-finalization';
  if (canResume) return;
  throw new AuditRuntimeError(
    'artifact-invalid',
    'This provider evaluation finalization requires operator action; only a rename-failed publication checkpoint may resume automatically.',
  );
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

export function validatePlanningProfile(
  options: ProviderEvaluationOptions,
  verificationMode: z.output<typeof VerificationModeSchema>,
): void {
  if (options.planProfile !== 'planning-generated') return;
  if (verificationMode !== 'same-route') {
    throw usage('Planning-generated evaluation cannot configure an independent verifier route.');
  }
  if (options.split === 'private-holdout') {
    throw usage('Planning-generated evaluation is limited to development or test splits.');
  }
}

function semanticPlanEvaluatorForProfile(
  planProfile: z.output<typeof PlanEvaluationProfileSchema>,
) {
  return planProfile === 'audit-reviewed-plan'
    ? null
    : {
        protocolFingerprint: planSemanticAgentProtocolFingerprint,
        route: 'primary' as const,
      };
}

function resolveIndependentVerifierConfiguration(
  runtime: RuntimeConfiguration,
  primary: Readonly<{ provider: string; model: string }>,
  verificationMode: z.output<typeof VerificationModeSchema>,
): NonNullable<RuntimeConfiguration['independentVerifierRoute']> | undefined {
  if (verificationMode === 'same-route') return undefined;
  const configured = runtime.independentVerifierRoute;
  if (configured === undefined) throw usage('Independent verifier route is incomplete.');
  if (
    configured.provider === primary.provider &&
    configured.model.trim().toLowerCase() === primary.model.trim().toLowerCase()
  ) {
    throw usage('Independent verifier route must use another provider/model pair.');
  }
  return configured;
}

function createIndependentVerifierRoute(
  configured: NonNullable<RuntimeConfiguration['independentVerifierRoute']>,
  environment: Readonly<Record<string, string | undefined>>,
  requestTimeoutMs: number,
): ResolvedVerificationRoute {
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

function requireExactCataloguePricing(
  pricing: ReturnType<typeof primaryModelPricingForEvaluation>,
  route: string,
): void {
  if (
    pricing.source !== 'catalogue' ||
    pricing.inputPerMillion === undefined ||
    pricing.outputPerMillion === undefined
  ) {
    throw usage(`The ${route} has no exact bundled model-price record.`);
  }
}

export const providerEvaluationUsage =
  'Usage: bun run eval:provider [--split development] [--case-id <id>] [--repetitions 1] [--plan-profile planning-generated|audit-reviewed-plan|end-to-end-generated] [--corpus evaluation/data/corpora] [--baseline <exhaustive-baseline.json>] [--output evaluation/runs] [--run-id id --resume true --retry-unfinished true] [--debug-diagnostics true] [--holdout-attestation <file> --holdout-public-key <pem-file>]';

function usage(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `${message} ${providerEvaluationUsage}`);
}

function lockUsage(message: string): AuditRuntimeError {
  return new AuditRuntimeError(
    'invalid-input',
    `${message} Usage: bun run eval:provider:lock:inspect --output <evaluation-runs> --run-id <id> | bun run eval:provider:lock:release --output <evaluation-runs> --run-id <id> --attempt-id <id> --checkpoint-fingerprint <sha256>.`,
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
  let exitCode: number;
  try {
    exitCode = await main(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected evaluator failure.';
    process.stderr.write(`audit provider evaluation: ${message}\n`);
    exitCode = 2;
  }
  process.exitCode = exitCode;
}
