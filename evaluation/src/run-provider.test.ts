import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonValue, ObjectResponse, ToolCallSpec } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';
import { createPlan } from '../../src/features/attack-planning/index.js';
import {
  observeModelStage,
  summarizeModelStages,
} from '../../src/features/model-operations/model-operations.js';
import { createReviewService } from '../../src/features/review-workflow/service.js';
import { ArtifactStoreError } from '../../src/platform/artifact-store/json-artifact-store.js';
import type { RuntimeConfiguration } from '../../src/platform/configuration/environment.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import { loadCorpusPack, variantRoot } from './corpus.js';
import {
  ProviderEvaluationCheckpointSchema,
  ProviderEvaluationFailureSchema,
} from './corpus.schema.js';
import {
  acquireProviderEvaluationLock,
  ProviderEvaluationPublicationError,
  readProviderEvaluationCheckpoint,
  writeProviderEvaluationCheckpoint,
} from './real-world-artifacts.js';
import {
  parseProviderEvaluationArguments as parseProviderEvaluationArgumentsImplementation,
  preflightProviderEvaluation,
  primaryModelPricingForEvaluation,
  runProviderEvaluation,
  runProviderEvaluationLockCommand,
  terminalProviderEvaluationCheckpoint,
  validateHoldoutAttestationOptions,
  validatePlanningProfile,
} from './run-provider.js';

const providerCheckpoint = ProviderEvaluationCheckpointSchema.parse({
  schemaVersion: 15,
  runId: 'provider-checkpoint-terminal-fixture',
  configFingerprint: 'a'.repeat(64),
  packId: 'fixture-pack',
  packVersion: '1.0.0',
  corpusManifestDigest: 'b'.repeat(64),
  populationDigest: 'c'.repeat(64),
  benchmarkProtocolFingerprint: 'd'.repeat(64),
  provider: 'openai',
  model: 'fixture-model',
  verificationMode: 'same-route',
  verificationRouteFingerprint: 'e'.repeat(64),
  selectedSplit: 'development',
  repetitions: 1,
  planProfile: 'end-to-end-generated',
  semanticPlanEvaluator: {
    protocolFingerprint: 'f'.repeat(64),
    route: 'primary',
  },
  executionBudget: {
    modelTimeoutMs: 120_000,
    runTimeoutMs: 150_000,
    modelRetry: 'default',
  },
  maxParallelVectors: 1,
  modelCostCeilingState: { configuredUsd: null, accumulatedEstimatedCostUsd: null, reached: false },
  status: 'running',
  failure: null,
  startedAt: '2026-08-03T12:00:00.000Z',
  updatedAt: '2026-08-03T12:00:00.000Z',
  selectedTrialPopulation: [
    { caseId: 'provider-checkpoint-case', variant: 'vulnerable', repetition: 1 },
  ],
  trials: [],
  activeAttempt: {
    attemptId: 'provider-checkpoint-attempt-01',
    mode: 'resume-work',
    startedAt: '2026-08-03T12:00:00.000Z',
    startingStatus: 'running',
  },
  attempts: [],
  finalization: null,
});

const evaluationRuntime: RuntimeConfiguration = {
  provider: 'openai',
  model: 'gpt-5.3-codex',
  publicArtifactDirectory: '.audit-artifacts',
  privateWorkDirectory: '.audit-work',
  evaluationCorpusRoot: 'evaluation/data/corpora',
  evaluationOutputRoot: 'evaluation/runs',
  maxParallelVectors: 1,
  modelPricing: {},
  verificationMode: 'same-route',
};

function parseProviderEvaluationArguments(
  arguments_: readonly string[],
  runtime: RuntimeConfiguration = evaluationRuntime,
) {
  return parseProviderEvaluationArgumentsImplementation(arguments_, runtime);
}

function configuredRuntime(overrides: Partial<RuntimeConfiguration>): RuntimeConfiguration {
  return { ...evaluationRuntime, ...overrides };
}

test('requires a configured provider route and permits a single diagnostic provider trial', () => {
  expect(() => parseProviderEvaluationArgumentsImplementation([])).toThrow(
    'Invalid provider evaluation options',
  );
  expect(parseProviderEvaluationArguments(['--repetitions', '1'])).toMatchObject({
    repetitions: 1,
  });
  expect(
    parseProviderEvaluationArguments(
      ['--split', 'test', '--repetitions', '5'],
      configuredRuntime({ provider: 'anthropic', model: 'example-model' }),
    ),
  ).toMatchObject({
    provider: 'anthropic',
    model: 'example-model',
    split: 'test',
    repetitions: 5,
    executionBudget: {
      modelTimeoutMs: 0,
      runTimeoutMs: 0,
      modelRetry: 'default',
    },
    planProfile: 'end-to-end-generated',
  });
});

test('rejects a provider checkpoint without its immutable selected trial population', () => {
  expect(
    ProviderEvaluationCheckpointSchema.safeParse({
      ...providerCheckpoint,
      selectedTrialPopulation: undefined,
    }).success,
  ).toBe(false);
});

test('requires an explicit run identity for provider resume and unfinished recovery', () => {
  expect(() => parseProviderEvaluationArguments(['--resume', 'true'])).toThrow(
    'requires an explicit --run-id',
  );
  expect(() => parseProviderEvaluationArguments(['--retry-unfinished', 'true'])).toThrow(
    'requires --resume true',
  );
  expect(
    parseProviderEvaluationArguments([
      '--run-id',
      'provider-resume-fixture',
      '--resume',
      'true',
      '--retry-unfinished',
      'true',
    ]),
  ).toMatchObject({
    runId: 'provider-resume-fixture',
    resume: true,
    retryUnfinished: true,
  });
});

test('retries only retained unfinished trials from a published diagnostic evaluation', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-retry-'));
  const runId = 'provider-published-unfinished-retry-fixture';
  const initialOptions = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--output',
    output,
    '--run-id',
    runId,
  ]);
  await runProviderEvaluation({
    options: initialOptions,
    runtime: evaluationRuntime,
    environment: {},
    modelProvider: new FakeModelProvider(),
  });
  const initial = await readProviderEvaluationCheckpoint(output, runId);
  if (initial === undefined) throw new Error('The initial diagnostic checkpoint must exist.');
  const initialAttemptId = initial.attempts.at(-1)?.attemptId;
  if (initialAttemptId === undefined) throw new Error('The initial attempt must be retained.');
  expect(initial).toMatchObject({ status: 'completed' });
  expect(initial.finalization?.run.trials.some((trial) => trial.status !== 'completed')).toBe(true);

  const resumedOptions = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--output',
    output,
    '--run-id',
    runId,
    '--resume',
    'true',
    '--retry-unfinished',
    'true',
  ]);
  await runProviderEvaluation({
    options: resumedOptions,
    runtime: evaluationRuntime,
    environment: {},
    modelProvider: new FakeModelProvider(),
  });

  await expect(readProviderEvaluationCheckpoint(output, runId)).resolves.toMatchObject({
    status: 'completed',
    attempts: [
      expect.objectContaining({ mode: 'fresh' }),
      expect.objectContaining({ mode: 'resume-work' }),
    ],
  });
  await expect(
    Bun.file(
      join(
        output,
        '.provider-evaluations',
        runId,
        'published-attempts',
        initialAttemptId,
        'evaluation-run.json',
      ),
    ).exists(),
  ).resolves.toBe(true);
  await expect(Bun.file(join(output, runId, 'evaluation-run.json')).exists()).resolves.toBe(true);
});

test('provides provider-free lock inspection and exact-confirmed release commands', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-lock-command-'));
  const runId = 'provider-lock-command-run';
  const attemptId = 'provider-lock-command-attempt';
  const checkpointFingerprint = 'b'.repeat(64);
  await acquireProviderEvaluationLock(output, runId, {
    attemptId,
    checkpointFingerprint,
    createdAt: '2026-08-03T12:00:00.000Z',
    commandMode: 'fresh',
  });

  await expect(
    runProviderEvaluationLockCommand(['inspect-lock', '--output', output, '--run-id', runId]),
  ).resolves.toMatchObject({
    operation: 'inspect-lock',
    inspection: { lock: { runId, attemptId, checkpointFingerprint }, checkpoint: null },
  });
  await expect(
    runProviderEvaluationLockCommand([
      'release-lock',
      '--output',
      output,
      '--run-id',
      runId,
      '--attempt-id',
      attemptId,
      '--checkpoint-fingerprint',
      'c'.repeat(64),
    ]),
  ).rejects.toThrow('does not match the supplied run, attempt, and checkpoint fingerprint');
  await expect(
    runProviderEvaluationLockCommand([
      'release-lock',
      '--output',
      output,
      '--run-id',
      runId,
      '--attempt-id',
      attemptId,
      '--checkpoint-fingerprint',
      checkpointFingerprint,
    ]),
  ).resolves.toMatchObject({ operation: 'release-lock', inspection: { lock: null } });
  await expect(
    runProviderEvaluationLockCommand(['inspect-lock', '--output', output]),
  ).rejects.toThrow('Invalid provider evaluation lock inspection options');
});

test('persists a source-free terminal checkpoint state when evaluator orchestration stops', () => {
  expect(
    terminalProviderEvaluationCheckpoint(
      providerCheckpoint,
      new Error('The report writer failed after trial persistence.'),
      '2026-08-03T12:01:00.000Z',
    ),
  ).toMatchObject({
    status: 'failed',
    failure: {
      code: 'provider-evaluation-audit-work-failed',
      domain: 'audit-workflow',
    },
    updatedAt: '2026-08-03T12:01:00.000Z',
    trials: [],
  });
  expect(
    terminalProviderEvaluationCheckpoint(
      providerCheckpoint,
      new ArtifactStoreError('artifact-write-failed', 'Checkpoint persistence failed.'),
      '2026-08-03T12:01:00.000Z',
      'checkpoint',
    ),
  ).toMatchObject({
    status: 'failed',
    failure: {
      code: 'provider-evaluation-checkpoint-failed',
      domain: 'checkpoint-persistence',
      publicationReason: null,
    },
  });
  expect(
    terminalProviderEvaluationCheckpoint(
      providerCheckpoint,
      new AuditRuntimeError('provider-cancelled', 'The provider cancelled this run.'),
      '2026-08-03T12:01:00.000Z',
    ),
  ).toMatchObject({
    status: 'cancelled',
    failure: { code: 'provider-cancelled', domain: 'provider-cancelled' },
  });
});

test('attributes model work to the failed attempt that reached publication', () => {
  const pricing = { inputPerMillion: 1, outputPerMillion: 1, source: 'catalogue' } as const;
  const planningObservation = observeModelStage({
    stage: 'planning',
    route: 'primary',
    stageId: 'failed-publication-planning',
    status: 'completed',
    durationMs: 1,
    errorCode: null,
    requests: [
      {
        durationMs: 1,
        usage: {
          modelCallCount: 1,
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cachedInputTokens: 0,
          reasoningTokens: 0,
        },
      },
    ],
    pricing,
    cacheRoutingEnabled: false,
  });
  const checkpoint = ProviderEvaluationCheckpointSchema.parse({
    ...providerCheckpoint,
    trials: [
      {
        attempts: 1,
        trial: {
          caseId: 'provider-checkpoint-case',
          variant: 'vulnerable',
          repetition: 1,
          status: 'failed',
          reviewedPlanFingerprint: null,
          pathReachability: null,
          findingScore: null,
          planKeys: [],
          findingKeys: [],
          durationMs: 1,
          errorCode: 'artifact-write-failed',
          modelObservation: summarizeModelStages([planningObservation], pricing),
        },
      },
    ],
  });

  const terminal = terminalProviderEvaluationCheckpoint(
    checkpoint,
    new ArtifactStoreError('artifact-write-failed', 'Injected publication failure.'),
    '2026-08-03T12:01:00.000Z',
    'publication',
    { modelDispatchCount: 0, stageCount: 0, estimatedCostUsd: 0, modelDurationMs: 0 },
  );

  expect(terminal.attempts.at(-1)?.metrics).toMatchObject({
    modelDispatchCount: 1,
    reusedStageCount: 0,
    newEstimatedCostUsd: 2,
    cumulativeEstimatedCostUsd: 2,
    summedModelDurationMs: 1,
  });
});

test('retains a safe typed publication reason without persisting artifact paths', () => {
  const terminal = terminalProviderEvaluationCheckpoint(
    providerCheckpoint,
    new ProviderEvaluationPublicationError(
      'terminal-destination-occupied',
      'Provider terminal artifacts cannot be atomically published at this output path.',
    ),
    '2026-08-03T12:01:00.000Z',
    'publication',
  );

  expect(terminal.failure).toMatchObject({
    domain: 'artifact-publication',
    publicationReason: 'terminal-destination-occupied',
  });
  expect(JSON.stringify(terminal.failure)).not.toContain('evaluation/runs');
});

test('closes the persisted command checkpoint when report orchestration fails after trials', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-failure-'));
  const options = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--baseline',
    join(output, 'missing-baseline.json'),
    '--output',
    output,
    '--run-id',
    'provider-command-failure-fixture',
  ]);

  await expect(
    runProviderEvaluation({
      options,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
    }),
  ).rejects.toThrow();

  await expect(readProviderEvaluationCheckpoint(output, options.runId)).resolves.toMatchObject({
    status: 'failed',
    failure: { domain: 'audit-workflow' },
    trials: expect.arrayContaining([
      expect.objectContaining({ trial: expect.objectContaining({ status: 'failed' }) }),
    ]),
  });
});

test('classifies a checkpoint write interruption without dispatching a provider', async () => {
  const output = await mkdtemp(
    join(tmpdir(), 'audit-provider-evaluation-checkpoint-interruption-'),
  );
  const options = parseProviderEvaluationArguments([
    '--output',
    output,
    '--run-id',
    'provider-command-checkpoint-interruption-fixture',
  ]);
  let failFirstCheckpointWrite = true;

  await expect(
    runProviderEvaluation({
      options,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
      checkpointWriter: async (outputRoot, checkpoint) => {
        if (failFirstCheckpointWrite) {
          failFirstCheckpointWrite = false;
          throw new Error('Injected checkpoint interruption.');
        }
        await writeProviderEvaluationCheckpoint(outputRoot, checkpoint);
      },
    }),
  ).rejects.toThrow('Provider evaluation checkpoint persistence failed');

  await expect(readProviderEvaluationCheckpoint(output, options.runId)).resolves.toMatchObject({
    status: 'failed',
    failure: {
      domain: 'checkpoint-persistence',
      code: 'provider-evaluation-checkpoint-failed',
    },
    attempts: [expect.objectContaining({ outcome: 'failed' })],
  });
});

test('re-reads the checkpoint after acquiring ownership before deciding a fresh run', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-stable-ownership-'));
  const options = parseProviderEvaluationArguments([
    '--output',
    output,
    '--run-id',
    'provider-command-stable-ownership-fixture',
  ]);
  let reads = 0;

  await expect(
    runProviderEvaluation({
      options,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
      checkpointReader: async () => {
        reads += 1;
        return reads === 1
          ? undefined
          : ProviderEvaluationCheckpointSchema.parse({
              ...providerCheckpoint,
              runId: options.runId,
            });
      },
    }),
  ).rejects.toThrow('A checkpoint already exists for this run id');

  expect(reads).toBeGreaterThanOrEqual(2);
});

test('requires operator action for a blocked terminal publication', () => {
  const terminal = terminalProviderEvaluationCheckpoint(
    providerCheckpoint,
    new ProviderEvaluationPublicationError(
      'terminal-destination-occupied',
      'Provider terminal artifacts cannot be atomically published at this output path.',
    ),
    '2026-08-03T12:01:00.000Z',
    'publication',
  );

  expect(terminal.failure).toMatchObject({
    domain: 'artifact-publication',
    publicationReason: 'terminal-destination-occupied',
    recoveryDisposition: 'operator-action-required',
  });
});

test('preserves a non-recoverable finalization checkpoint instead of republishing it', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-blocked-finalization-'));
  const runId = 'provider-command-blocked-finalization-fixture';
  const initialOptions = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--output',
    output,
    '--run-id',
    runId,
  ]);
  await runProviderEvaluation({
    options: initialOptions,
    runtime: evaluationRuntime,
    environment: {},
    modelProvider: new FakeModelProvider(),
  });
  const completed = await readProviderEvaluationCheckpoint(output, runId);
  if (completed === undefined) throw new Error('The fixture must persist a completed checkpoint.');
  const blocked = ProviderEvaluationCheckpointSchema.parse({
    ...completed,
    status: 'failed',
    failure: {
      domain: 'artifact-publication',
      code: 'provider-evaluation-publication-failed',
      publicationReason: 'terminal-destination-occupied',
      phase: 'publication',
      attemptId: 'provider-command-blocked-finalization-attempt',
      affectedTrialIds: [],
      affectedStageIds: [],
      recoveryDisposition: 'operator-action-required',
    },
    activeAttempt: null,
  });
  await writeProviderEvaluationCheckpoint(output, blocked);
  const resumeOptions = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--output',
    output,
    '--run-id',
    runId,
    '--resume',
    'true',
  ]);

  await expect(
    runProviderEvaluation({
      options: resumeOptions,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
    }),
  ).rejects.toThrow('requires operator action');
  await expect(readProviderEvaluationCheckpoint(output, runId)).resolves.toEqual(blocked);
});

test('re-publishes only a rename-failed finalization without dispatching new audit work', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-rename-finalization-'));
  const runId = 'provider-command-rename-finalization-fixture';
  const initialOptions = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--output',
    output,
    '--run-id',
    runId,
  ]);
  await runProviderEvaluation({
    options: initialOptions,
    runtime: evaluationRuntime,
    environment: {},
    modelProvider: new FakeModelProvider(),
  });
  const completed = await readProviderEvaluationCheckpoint(output, runId);
  if (completed === undefined) throw new Error('The fixture must persist a completed checkpoint.');
  await writeProviderEvaluationCheckpoint(
    output,
    ProviderEvaluationCheckpointSchema.parse({
      ...completed,
      status: 'failed',
      failure: {
        domain: 'artifact-publication',
        code: 'provider-evaluation-publication-failed',
        publicationReason: 'rename-failed',
        phase: 'publication',
        attemptId: 'provider-command-rename-finalization-attempt',
        affectedTrialIds: [],
        affectedStageIds: [],
        recoveryDisposition: 'resume-finalization',
      },
      activeAttempt: null,
    }),
  );
  const resumeOptions = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--output',
    output,
    '--run-id',
    runId,
    '--resume',
    'true',
  ]);

  await expect(
    runProviderEvaluation({
      options: resumeOptions,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
    }),
  ).resolves.toMatchObject({ exitCode: expect.any(Number) });
  await expect(readProviderEvaluationCheckpoint(output, runId)).resolves.toMatchObject({
    status: 'completed',
    failure: null,
    attempts: [expect.anything(), expect.objectContaining({ mode: 'resume-finalization' })],
  });
});

test('rejects an unsafe publication recovery disposition in persisted failure state', () => {
  const baseFailure = {
    code: 'provider-evaluation-publication-failed',
    phase: 'publication' as const,
    attemptId: 'provider-publication-attempt-01',
    affectedTrialIds: [],
    affectedStageIds: [],
  };

  expect(
    ProviderEvaluationFailureSchema.safeParse({
      ...baseFailure,
      domain: 'artifact-publication',
      publicationReason: 'terminal-destination-occupied',
      recoveryDisposition: 'resume-finalization',
    }).success,
  ).toBe(false);
  expect(
    ProviderEvaluationFailureSchema.safeParse({
      ...baseFailure,
      domain: 'artifact-publication',
      publicationReason: 'rename-failed',
      recoveryDisposition: 'resume-finalization',
    }).success,
  ).toBe(true);
  expect(
    ProviderEvaluationFailureSchema.safeParse({
      ...baseFailure,
      domain: 'artifact-validation',
      publicationReason: null,
      recoveryDisposition: 'resume-finalization',
    }).success,
  ).toBe(false);
});

test('publishes one validated terminal artifact set before marking a run completed', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-publication-'));
  const options = parseProviderEvaluationArguments([
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'audit-reviewed-plan',
    '--output',
    output,
    '--run-id',
    'provider-command-publication-fixture',
  ]);

  const result = await runProviderEvaluation({
    options,
    runtime: evaluationRuntime,
    environment: {},
    modelProvider: new FakeModelProvider(),
  });

  expect(result.paths).toEqual({
    jsonPath: `${options.runId}/evaluation-run.json`,
    markdownPath: `${options.runId}/evaluation-report.md`,
    trialTracePath: `${options.runId}/case-results.jsonl`,
    manifestPath: `${options.runId}/terminal-manifest.json`,
  });
  await expect(access(join(output, options.runId, 'terminal-manifest.json'))).resolves.toBeNull();
  await expect(readProviderEvaluationCheckpoint(output, options.runId)).resolves.toMatchObject({
    status: 'completed',
    failure: null,
    activeAttempt: null,
    attempts: [
      expect.objectContaining({
        mode: 'fresh',
        outcome: 'completed',
        endingStatus: 'completed',
      }),
    ],
  });
});

test('publishes a planning-generated evaluation without exposing semantic checkpoints publicly', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-generated-publication-'));
  const caseId = 'ossf-cve-2018-16492';
  const options = parseProviderEvaluationArguments([
    '--case-id',
    caseId,
    '--plan-profile',
    'planning-generated',
    '--output',
    output,
    '--run-id',
    'provider-command-generated-publication-fixture',
  ]);
  const provider = new FakeModelProvider();
  await enqueuePlanningGeneratedPublicationResponses(provider, caseId);

  const result = await runProviderEvaluation({
    options,
    runtime: evaluationRuntime,
    environment: {},
    modelProvider: provider,
  });

  expect(result.run.planProfile).toBe('planning-generated');
  expect(result.run.trials).toHaveLength(2);
  expect(
    result.run.trials.every((trial) => trial.semanticPlanMeasurement?.status === 'completed'),
  ).toBe(true);
  await expect(
    access(
      join(output, '.provider-evaluations', options.runId, 'work', 'plan-semantic-evaluations'),
    ),
  ).resolves.toBeNull();
  await expect(access(join(output, options.runId, 'plan-semantic-evaluations'))).rejects.toThrow();
  await expect(readProviderEvaluationCheckpoint(output, options.runId)).resolves.toMatchObject({
    status: 'completed',
    finalization: expect.objectContaining({
      run: expect.objectContaining({ planProfile: 'planning-generated' }),
    }),
  });
});

test('rejects a missing resume target before a provider is dispatched', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-missing-resume-'));
  const options = parseProviderEvaluationArguments([
    '--output',
    output,
    '--run-id',
    'provider-command-missing-resume-fixture',
    '--resume',
    'true',
  ]);

  await expect(
    runProviderEvaluation({
      options,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
    }),
  ).rejects.toThrow('Cannot resume because no checkpoint exists');
  await expect(readProviderEvaluationCheckpoint(output, options.runId)).resolves.toBeUndefined();
});

test('rejects an orphaned terminal destination before a fresh provider dispatch', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-orphaned-terminal-'));
  const options = parseProviderEvaluationArguments([
    '--output',
    output,
    '--run-id',
    'provider-command-orphaned-terminal-fixture',
  ]);
  await mkdir(join(output, options.runId));

  await expect(
    runProviderEvaluation({
      options,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
    }),
  ).rejects.toThrow('Terminal evaluation artifacts already exist');
  await expect(readProviderEvaluationCheckpoint(output, options.runId)).resolves.toBeUndefined();
});

test('rejects abandoned staging artifacts before a fresh provider dispatch', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-evaluation-orphaned-staging-'));
  const options = parseProviderEvaluationArguments([
    '--output',
    output,
    '--run-id',
    'provider-command-orphaned-staging-fixture',
  ]);
  await mkdir(join(output, '.provider-evaluations', options.runId, 'staging-interrupted'), {
    recursive: true,
  });

  await expect(
    runProviderEvaluation({
      options,
      runtime: evaluationRuntime,
      environment: {},
      modelProvider: new FakeModelProvider(),
    }),
  ).rejects.toThrow('Provider evaluation staging artifacts already exist');
  await expect(readProviderEvaluationCheckpoint(output, options.runId)).resolves.toBeUndefined();
});

test('parses and restricts the planning-generated profile', () => {
  const options = parseProviderEvaluationArguments(['--plan-profile', 'planning-generated']);
  expect(options.planProfile).toBe('planning-generated');
  expect(() => validatePlanningProfile(options, 'independent-route')).toThrow(
    'cannot configure an independent verifier route',
  );
});

test('uses local runtime configuration for the provider route', () => {
  expect(
    parseProviderEvaluationArguments([], {
      provider: 'openai',
      model: 'configured-model',
      publicArtifactDirectory: '.audit-artifacts',
      privateWorkDirectory: '.audit-work',
      evaluationCorpusRoot: 'custom-corpus',
      evaluationOutputRoot: 'custom-runs',
      maxParallelVectors: 1,
      modelPricing: {},
      verificationMode: 'same-route',
    }),
  ).toMatchObject({
    provider: 'openai',
    model: 'configured-model',
    corpus: 'custom-corpus',
    output: 'custom-runs',
    repetitions: 1,
    executionBudget: {
      modelTimeoutMs: 0,
      runTimeoutMs: 0,
      modelRetry: 'default',
    },
    planProfile: 'end-to-end-generated',
  });
});

test('does not apply the seed baseline to an explicitly selected custom corpus', () => {
  expect(
    parseProviderEvaluationArguments([
      '--corpus',
      'evaluation/data/research-corpora/private-mixed-language-v1',
    ]),
  ).toMatchObject({ baseline: undefined });
});

test('requires an explicit baseline instead of silently comparing a new provider run', () => {
  expect(parseProviderEvaluationArguments([])).toMatchObject({ baseline: undefined });
});

test('accepts an explicit baseline for a separately selected corpus', () => {
  expect(
    parseProviderEvaluationArguments([
      '--corpus',
      'evaluation/data/research-corpora/private-mixed-language-v1',
      '--baseline',
      'evaluation/runs/private-research-baseline.json',
    ]),
  ).toMatchObject({ baseline: 'evaluation/runs/private-research-baseline.json' });
});

test('accepts audit-reviewed-plan audit measurement as an explicit profile', () => {
  expect(parseProviderEvaluationArguments(['--plan-profile', 'audit-reviewed-plan'])).toMatchObject(
    { planProfile: 'audit-reviewed-plan' },
  );
});

test('accepts one evaluator-owned case selector for a bounded provider probe', () => {
  expect(
    parseProviderEvaluationArguments([
      '--case-id',
      'ossf-cve-2018-16492',
      '--plan-profile',
      'audit-reviewed-plan',
    ]),
  ).toMatchObject({
    caseIdFilter: 'ossf-cve-2018-16492',
    planProfile: 'audit-reviewed-plan',
  });
});

test('uses the environment-configured observed-cost ceiling for provider evaluation', () => {
  expect(
    parseProviderEvaluationArguments([], configuredRuntime({ maxEstimatedCostUsd: 2.5 })),
  ).toMatchObject({ 'max-estimated-cost-usd': 2.5 });
});

test('rejects retired runtime-configuration flags', () => {
  for (const flag of [
    '--provider',
    '--model',
    '--api-key-env',
    '--verification-mode',
    '--max-estimated-cost-usd',
  ]) {
    expect(() => parseProviderEvaluationArguments([flag, 'value'])).toThrow(
      'Invalid provider evaluation options',
    );
  }
});

test('accepts detached private-holdout attestation paths without treating them as credentials', () => {
  expect(
    parseProviderEvaluationArguments([
      '--split',
      'private-holdout',
      '--holdout-attestation',
      'evaluation/private/attestation.json',
      '--holdout-public-key',
      'evaluation/keys/holdout-public.pem',
    ]),
  ).toMatchObject({
    split: 'private-holdout',
    'holdout-attestation': 'evaluation/private/attestation.json',
    'holdout-public-key': 'evaluation/keys/holdout-public.pem',
  });
});

test('requires the detached attestation pair only for a private-holdout run', () => {
  const privateOptions = parseProviderEvaluationArguments(['--split', 'private-holdout']);
  expect(() => validateHoldoutAttestationOptions(privateOptions)).toThrow(
    'Private-holdout provider evaluation requires',
  );
  const developmentOptions = parseProviderEvaluationArguments([
    '--holdout-attestation',
    'evaluation/private/attestation.json',
  ]);
  expect(() => validateHoldoutAttestationOptions(developmentOptions)).toThrow(
    'Holdout attestation options require',
  );
});

test('derives pricing from an explicitly selected evaluation route instead of runtime defaults', () => {
  expect(
    primaryModelPricingForEvaluation({
      provider: 'openai',
      model: 'gpt-5.3-codex',
    }),
  ).toMatchObject({
    source: 'catalogue',
    inputPerMillion: 1.75,
    outputPerMillion: 14,
  });
  expect(
    primaryModelPricingForEvaluation({
      provider: 'anthropic',
      model: 'not-catalogued',
    }),
  ).toEqual({});
});

test('preflights the exact provider evaluation without constructing a provider or writing artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-provider-preflight-'));
  const output = join(root, 'preflight-output');
  const options = parseProviderEvaluationArguments(
    [
      '--case-id',
      'ossf-cve-2018-16492',
      '--plan-profile',
      'audit-reviewed-plan',
      '--output',
      output,
    ],
    configuredRuntime({ model: 'gpt-5.6-terra' }),
  );
  await expect(
    preflightProviderEvaluation({
      options,
      runtime: evaluationRuntime,
      environment: { OPENAI_API_KEY: 'present-only-for-readiness-check' },
    }),
  ).resolves.toMatchObject({
    primaryRoute: {
      provider: 'openai',
      model: 'gpt-5.6-terra',
      apiKeyEnvironmentVariable: 'OPENAI_API_KEY',
      credentialConfigured: true,
      exactCataloguePricing: true,
      structuredOutputCompatibility: {
        profile: 'openai-responses-v1',
        compatible: true,
      },
    },
    verificationMode: 'same-route',
    independentVerifierRoute: null,
    corpus: { selectedCaseCount: 1 },
    planProfile: 'audit-reviewed-plan',
  });
  const preflight = await preflightProviderEvaluation({
    options,
    runtime: evaluationRuntime,
    environment: { OPENAI_API_KEY: 'present-only-for-readiness-check' },
  });
  expect(
    preflight.primaryRoute.structuredOutputCompatibility.outputs.map((output) => output.outputId),
  ).toEqual([
    'planning',
    'investigation',
    'evidence-map',
    'evidence-map-repair',
    'source-posture',
    'verification',
    'countercheck',
    'candidate-grounding',
    'developer-guidance',
  ]);
  expect(preflight.primaryRoute.structuredOutputCompatibility.outputs[0]).not.toHaveProperty(
    'schema',
  );
  await expect(access(output)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('fails an offline preflight before corpus access when a credential or exact price is unavailable', async () => {
  const missingCredential = parseProviderEvaluationArguments(
    [],
    configuredRuntime({ model: 'gpt-5.6-terra' }),
  );
  await expect(
    preflightProviderEvaluation({
      options: missingCredential,
      runtime: evaluationRuntime,
      environment: {},
    }),
  ).rejects.toThrow('primary API key environment variable OPENAI_API_KEY is not set');
  const unavailablePrice = parseProviderEvaluationArguments(
    [],
    configuredRuntime({ model: 'uncatalogued-model' }),
  );
  await expect(
    preflightProviderEvaluation({
      options: unavailablePrice,
      runtime: evaluationRuntime,
      environment: { OPENAI_API_KEY: 'present-only-for-readiness-check' },
    }),
  ).rejects.toThrow('has no exact bundled model-price record');
});

async function enqueuePlanningGeneratedPublicationResponses(
  provider: FakeModelProvider,
  caseId: string,
): Promise<void> {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const loaded = pack.cases.find((entry) => entry.case.caseId === caseId);
  if (loaded === undefined) throw new Error('Missing planning-generated publication fixture case.');
  const draft = {
    title: 'Evaluate bounded reviewed security evidence',
    rationale: 'Deterministic evaluation fixture covers an adjudicated source-bound risk.',
    enabled: true,
    scopeGlobs: ['**/*'],
    reviewObligations: [
      {
        obligationId: 'deterministic-obligation-01',
        riskStatement: 'A source-backed security risk may be present in the approved scope.',
        evidenceRequirement: 'The review must identify bounded source evidence for the risk.',
      },
    ],
    limitations: ['Deterministic fixture output; not a model-quality result.'],
  };
  const variants =
    loaded.case.sourceDirectories.patched === undefined
      ? (['vulnerable'] as const)
      : (['vulnerable', 'patched'] as const);
  const scenarioIds = loaded.answerKey.expectedPlanScenarios.map((scenario) => scenario.scenarioId);

  for (const variant of variants) {
    const service = createReviewService(new FakeModelProvider());
    const inventory = await service.inspectTarget({
      targetRoot: variantRoot(pack, loaded.case, variant),
      targetDisplayName: caseId,
    });
    const plan = createPlan({
      targetFingerprint: inventory.targetFingerprint,
      contextDigest: inventory.contextDigest,
      targetDisplayName: caseId,
      inventorySummary: inventory.summary,
      vectors: [draft],
      createdAt: '2026-08-04T12:00:00.000Z',
    });
    const vector = plan.vectors[0];
    if (vector === undefined) throw new Error('Planning-generated fixture needs one vector.');

    provider.enqueueObject(toolInspectionResponse());
    provider.enqueueObject(response({ vectors: [draft] }));
    provider.enqueueObject(
      response({
        scenarios: scenarioIds.map((scenarioId) => ({
          scenarioId,
          outcome: 'covered',
          vectorIds: [vector.vectorId],
        })),
        vectors: [
          {
            vectorId: vector.vectorId,
            outcome: 'relevant',
            scenarioIds,
          },
        ],
        observations: [],
      }),
    );
  }
}

function toolInspectionResponse(): ObjectResponse<JsonValue> {
  const toolCall: ToolCallSpec = {
    id: 'planning-generated-publication-inspection',
    name: 'repo_grep',
    arguments: {
      pattern: '__audit_planning_generated_publication_no_match__',
      mode: 'literal',
      caseSensitive: true,
    },
  };
  return { ...response({}), toolCalls: [toolCall] };
}

function response(object: JsonValue): ObjectResponse<JsonValue> {
  return {
    object,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  };
}
