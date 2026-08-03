import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';

import type { RuntimeConfiguration } from '../../platform/configuration/environment.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { ProviderEvaluationCheckpointSchema } from './corpus.schema.js';
import { readProviderEvaluationCheckpoint } from './real-world-artifacts.js';
import {
  parseProviderEvaluationArguments,
  primaryModelPricingForEvaluation,
  runProviderEvaluation,
  terminalProviderEvaluationCheckpoint,
  validateHoldoutAttestationOptions,
  validateMeasurementScope,
} from './run-provider.js';

const providerCheckpoint = ProviderEvaluationCheckpointSchema.parse({
  schemaVersion: 7,
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
  planProfile: 'generated-plan',
  measurementScope: 'full-workflow',
  executionBudget: {
    modelTimeoutMs: 120_000,
    runTimeoutMs: 150_000,
    modelRetry: 'default',
  },
  maxParallelVectors: 1,
  status: 'running',
  errorCode: null,
  startedAt: '2026-08-03T12:00:00.000Z',
  updatedAt: '2026-08-03T12:00:00.000Z',
  trials: [],
});

const evaluationRuntime: RuntimeConfiguration = {
  provider: 'openai',
  model: 'gpt-5.3-codex',
  artifactDirectory: '.security-review-artifacts',
  evaluationCorpusRoot: 'evaluation/corpora',
  evaluationOutputRoot: 'evaluation/runs',
  maxParallelVectors: 1,
  modelPricing: {},
  verificationMode: 'same-route',
};

test('requires an explicit provider and model and permits a single diagnostic provider trial', () => {
  expect(() => parseProviderEvaluationArguments([])).toThrow('Invalid provider evaluation options');
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example',
      '--repetitions',
      '1',
    ]),
  ).toMatchObject({ repetitions: 1 });
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'anthropic',
      '--model',
      'example-model',
      '--split',
      'test',
      '--repetitions',
      '5',
    ]),
  ).toMatchObject({
    provider: 'anthropic',
    model: 'example-model',
    split: 'test',
    repetitions: 5,
    executionBudget: {
      modelTimeoutMs: 120_000,
      runTimeoutMs: 150_000,
      modelRetry: 'default',
    },
    planProfile: 'generated-plan',
    measurementScope: 'full-workflow',
  });
});

test('requires an explicit run identity for provider resume and unfinished recovery', () => {
  expect(() =>
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--resume',
      'true',
    ]),
  ).toThrow('requires an explicit --run-id');
  expect(() =>
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--retry-unfinished',
      'true',
    ]),
  ).toThrow('requires --resume true');
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
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

test('persists a source-free terminal checkpoint state when evaluator orchestration stops', () => {
  expect(
    terminalProviderEvaluationCheckpoint(
      providerCheckpoint,
      new Error('The report writer failed after trial persistence.'),
      '2026-08-03T12:01:00.000Z',
    ),
  ).toMatchObject({
    status: 'failed',
    errorCode: 'evaluation-run-failed',
    updatedAt: '2026-08-03T12:01:00.000Z',
    trials: [],
  });
  expect(
    terminalProviderEvaluationCheckpoint(
      providerCheckpoint,
      new SecurityReviewerError('provider-cancelled', 'The provider cancelled this run.'),
      '2026-08-03T12:01:00.000Z',
    ),
  ).toMatchObject({ status: 'cancelled', errorCode: 'provider-cancelled' });
});

test('closes the persisted command checkpoint when report orchestration fails after trials', async () => {
  const output = await mkdtemp(join(tmpdir(), 'security-reviewer-provider-evaluation-failure-'));
  const options = parseProviderEvaluationArguments([
    '--provider',
    'openai',
    '--model',
    'gpt-5.3-codex',
    '--case-id',
    'ossf-cve-2018-16492',
    '--plan-profile',
    'reviewed-plan',
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
    errorCode: 'evaluation-run-failed',
    trials: expect.arrayContaining([
      expect.objectContaining({ trial: expect.objectContaining({ status: 'failed' }) }),
    ]),
  });
});

test('parses and restricts the generated-plan-only measurement scope', () => {
  const options = parseProviderEvaluationArguments([
    '--provider',
    'openai',
    '--model',
    'example-model',
    '--measurement-scope',
    'planning-only',
  ]);
  expect(options.measurementScope).toBe('planning-only');
  expect(() =>
    validateMeasurementScope({ ...options, planProfile: 'reviewed-plan' }, 'same-route'),
  ).toThrow('requires --plan-profile generated-plan');
  expect(() => validateMeasurementScope(options, 'independent-route')).toThrow(
    'cannot configure an independent verifier route',
  );
});

test('uses local runtime defaults when provider and model flags are omitted', () => {
  expect(
    parseProviderEvaluationArguments([], {
      provider: 'openai',
      model: 'configured-model',
      artifactDirectory: '.security-review-artifacts',
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
      modelTimeoutMs: 120_000,
      runTimeoutMs: 150_000,
      modelRetry: 'default',
    },
    planProfile: 'generated-plan',
  });
});

test('does not apply the seed baseline to an explicitly selected custom corpus', () => {
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--corpus',
      'evaluation/research-corpora/private-mixed-language-v1',
    ]),
  ).toMatchObject({ baseline: undefined });
});

test('requires an explicit baseline instead of silently comparing a new provider run', () => {
  expect(
    parseProviderEvaluationArguments(['--provider', 'openai', '--model', 'example-model']),
  ).toMatchObject({ baseline: undefined });
});

test('accepts an explicit baseline for a separately selected corpus', () => {
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--corpus',
      'evaluation/research-corpora/private-mixed-language-v1',
      '--baseline',
      'evaluation/baselines/private-research.json',
    ]),
  ).toMatchObject({ baseline: 'evaluation/baselines/private-research.json' });
});

test('accepts reviewed-plan audit measurement as an explicit profile', () => {
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--plan-profile',
      'reviewed-plan',
    ]),
  ).toMatchObject({ planProfile: 'reviewed-plan' });
});

test('accepts one evaluator-owned case selector for a bounded provider probe', () => {
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--case-id',
      'ossf-cve-2018-16492',
      '--plan-profile',
      'reviewed-plan',
    ]),
  ).toMatchObject({
    caseIdFilter: 'ossf-cve-2018-16492',
    planProfile: 'reviewed-plan',
  });
});

test('accepts an observed-cost ceiling for provider evaluation without accepting price input', () => {
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--max-estimated-cost-usd',
      '2.5',
    ]),
  ).toMatchObject({ 'max-estimated-cost-usd': 2.5 });
});

test('accepts an explicit verification route override for a reproducible evaluation', () => {
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
      '--verification-mode',
      'same-route',
    ]),
  ).toMatchObject({ 'verification-mode': 'same-route' });
});

test('accepts detached private-holdout attestation paths without treating them as credentials', () => {
  expect(
    parseProviderEvaluationArguments([
      '--provider',
      'openai',
      '--model',
      'example-model',
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
  const privateOptions = parseProviderEvaluationArguments([
    '--provider',
    'openai',
    '--model',
    'example-model',
    '--split',
    'private-holdout',
  ]);
  expect(() => validateHoldoutAttestationOptions(privateOptions)).toThrow(
    'Private-holdout provider evaluation requires',
  );
  const developmentOptions = parseProviderEvaluationArguments([
    '--provider',
    'openai',
    '--model',
    'example-model',
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
