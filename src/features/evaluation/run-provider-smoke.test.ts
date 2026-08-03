import { expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';

import { acquireProviderEvaluationLock } from './real-world-artifacts.js';
import { parseProviderSmokeArguments, runProviderSmoke } from './run-provider-smoke.js';

const runtime = {
  provider: 'openai' as const,
  model: 'gpt-5.3-codex',
  artifactDirectory: '.security-review-artifacts',
  evaluationCorpusRoot: 'custom-corpus',
  evaluationOutputRoot: 'custom-runs',
  maxParallelVectors: 1,
  maxEstimatedCostUsd: 2,
  modelPricing: {},
  verificationMode: 'same-route' as const,
};

test('accepts exactly one development case, variant, and observed-cost ceiling', () => {
  expect(
    parseProviderSmokeArguments(
      ['--case', 'ossf-cve-2018-16492', '--variant', 'vulnerable'],
      runtime,
    ),
  ).toMatchObject({
    provider: 'openai',
    model: 'gpt-5.3-codex',
    case: 'ossf-cve-2018-16492',
    variant: 'vulnerable',
    corpus: 'custom-corpus',
    output: 'custom-runs',
    'max-estimated-cost-usd': 2,
    executionBudget: { modelTimeoutMs: 120_000, runTimeoutMs: 150_000, modelRetry: 'default' },
  });
});

test('rejects a smoke without the required one-case inputs or observed-cost ceiling', () => {
  expect(() => parseProviderSmokeArguments(['--variant', 'vulnerable'], runtime)).toThrow(
    'Invalid provider smoke options',
  );
  expect(() =>
    parseProviderSmokeArguments([
      '--provider',
      'openai',
      '--model',
      'gpt-5.3-codex',
      '--case',
      'ossf-cve-2018-16492',
      '--variant',
      'vulnerable',
    ]),
  ).toThrow('observed-cost ceiling');
});

test('writes a source-free terminal artifact from an in-process provider without an answer key', async () => {
  const output = await mkdtemp(join(tmpdir(), 'security-reviewer-provider-smoke-'));
  const provider = new FakeModelProvider();
  const terminal = {
    object: {
      facts: [],
      controlCoverage: [],
      unansweredPlanObligations: [],
      limitations: ['The scripted smoke response did not inspect source.'],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop' as const,
  };
  provider.enqueueObject(terminal);
  provider.enqueueObject(terminal);
  const options = parseProviderSmokeArguments([
    '--provider',
    'openai',
    '--model',
    'gpt-5.3-codex',
    '--case',
    'ossf-cve-2018-16492',
    '--variant',
    'vulnerable',
    '--max-estimated-cost-usd',
    '0.5',
    '--output',
    output,
  ]);

  const run = await runProviderSmoke({ options, environment: {}, modelProvider: provider });
  const artifact = await readFile(join(output, 'smokes', `${options.runId}.json`), 'utf8');
  const duplicateProvider = new FakeModelProvider();
  const duplicateOptions = parseProviderSmokeArguments([
    '--provider',
    'openai',
    '--model',
    'gpt-5.3-codex',
    '--case',
    'ossf-cve-2018-16492',
    '--variant',
    'vulnerable',
    '--max-estimated-cost-usd',
    '0.5',
    '--output',
    output,
    '--run-id',
    options.runId,
  ]);
  await expect(
    runProviderSmoke({
      options: duplicateOptions,
      environment: {},
      modelProvider: duplicateProvider,
    }),
  ).rejects.toThrow('checkpoint already exists');
  expect(duplicateProvider.requests).toHaveLength(0);
  const resumedProvider = new FakeModelProvider();
  const resumedOptions = parseProviderSmokeArguments([
    '--provider',
    'openai',
    '--model',
    'gpt-5.3-codex',
    '--case',
    'ossf-cve-2018-16492',
    '--variant',
    'vulnerable',
    '--max-estimated-cost-usd',
    '0.5',
    '--output',
    output,
    '--run-id',
    options.runId,
    '--resume',
    'true',
  ]);
  const resumed = await runProviderSmoke({
    options: resumedOptions,
    environment: {},
    modelProvider: resumedProvider,
  });

  expect(run).toMatchObject({ status: 'failed', planProfile: 'reviewed-plan' });
  expect(resumed.status).toBe('failed');
  expect(resumedProvider.requests).toHaveLength(0);
  expect(artifact).not.toContain('answerKey');
  expect(artifact).not.toContain('request.input');
});

test('rejects a resumed smoke when its immutable target identity changes', async () => {
  const output = await mkdtemp(join(tmpdir(), 'security-reviewer-provider-smoke-identity-'));
  const provider = new FakeModelProvider();
  const terminal = {
    object: {
      facts: [],
      controlCoverage: [],
      unansweredPlanObligations: [],
      limitations: ['The scripted smoke response did not inspect source.'],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop' as const,
  };
  provider.enqueueObject(terminal);
  provider.enqueueObject(terminal);
  const first = parseProviderSmokeArguments([
    '--provider',
    'openai',
    '--model',
    'gpt-5.3-codex',
    '--case',
    'ossf-cve-2018-16492',
    '--variant',
    'vulnerable',
    '--max-estimated-cost-usd',
    '0.5',
    '--output',
    output,
    '--run-id',
    'smoke-identity-fixture',
  ]);
  await runProviderSmoke({ options: first, environment: {}, modelProvider: provider });

  const changed = parseProviderSmokeArguments([
    '--provider',
    'openai',
    '--model',
    'gpt-5.3-codex',
    '--case',
    'ossf-cve-2018-16492',
    '--variant',
    'patched',
    '--max-estimated-cost-usd',
    '0.5',
    '--output',
    output,
    '--run-id',
    'smoke-identity-fixture',
    '--resume',
    'true',
  ]);
  const resumedProvider = new FakeModelProvider();
  await expect(
    runProviderSmoke({ options: changed, environment: {}, modelProvider: resumedProvider }),
  ).rejects.toThrow('identity does not match');
  expect(resumedProvider.requests).toHaveLength(0);
});

test('fails closed when another evaluator owns the same smoke run id', async () => {
  const output = await mkdtemp(join(tmpdir(), 'security-reviewer-provider-smoke-lock-'));
  const options = parseProviderSmokeArguments([
    '--provider',
    'openai',
    '--model',
    'gpt-5.3-codex',
    '--case',
    'ossf-cve-2018-16492',
    '--variant',
    'vulnerable',
    '--max-estimated-cost-usd',
    '0.5',
    '--output',
    output,
    '--run-id',
    'smoke-lock-fixture',
  ]);
  const lock = await acquireProviderEvaluationLock(output, options.runId);
  try {
    await expect(
      runProviderSmoke({
        options,
        environment: {},
        modelProvider: new FakeModelProvider(),
      }),
    ).rejects.toMatchObject({ code: 'artifact-lease-unavailable' });
  } finally {
    await lock.release();
  }
});
