import { expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';

import { acquireProviderEvaluationLock } from './real-world-artifacts.js';
import { parseProviderSmokeArguments, runProviderSmoke } from './run-provider-smoke.js';

test('uses controlled exit-code assignment instead of direct process termination', async () => {
  const source = await readFile(new URL('./run-provider-smoke.ts', import.meta.url), 'utf8');

  expect(source).toContain('process.exitCode = await runProviderSmokeCommand');
  expect(source).not.toContain('process.exit(');
});

test('validates structured-output compatibility before loading the smoke corpus or acquiring a lock', async () => {
  const source = await readFile(new URL('./run-provider-smoke.ts', import.meta.url), 'utf8');

  expect(source.indexOf('assertAuditWorkflowStructuredOutputCompatibility(')).toBeGreaterThan(-1);
  expect(source.indexOf('assertAuditWorkflowStructuredOutputCompatibility(')).toBeLessThan(
    source.indexOf('const smoke = await loadCorpusSmokeCase('),
  );
  expect(source.indexOf('assertAuditWorkflowStructuredOutputCompatibility(')).toBeLessThan(
    source.indexOf('const lock = await acquireProviderEvaluationLock('),
  );
});

const runtime = {
  provider: 'openai' as const,
  model: 'gpt-5.3-codex',
  publicArtifactDirectory: '.audit-artifacts',
  privateWorkDirectory: '.audit-work',
  evaluationCorpusRoot: 'evaluation/data/corpora',
  evaluationOutputRoot: 'custom-runs',
  maxParallelVectors: 1,
  modelPricing: {},
  verificationMode: 'same-route' as const,
};

test('accepts exactly one development case and variant', () => {
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
    corpus: 'evaluation/data/corpora',
    output: 'custom-runs',
    executionBudget: { modelTimeoutMs: 0, runTimeoutMs: 0, modelRetry: 'default' },
  });
});

test('rejects a smoke without the required one-case inputs', () => {
  expect(() => parseProviderSmokeArguments(['--variant', 'vulnerable'], runtime)).toThrow(
    'Invalid provider smoke options',
  );
});

test('rejects retired runtime-configuration flags', () => {
  for (const flag of ['--provider', '--model', '--api-key-env', '--max-estimated-cost-usd']) {
    expect(() =>
      parseProviderSmokeArguments(
        ['--case', 'ossf-cve-2018-16492', '--variant', 'vulnerable', flag, 'value'],
        runtime,
      ),
    ).toThrow('Invalid provider smoke options');
  }
});

test('writes a source-free terminal artifact from an in-process provider without an answer key', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-smoke-'));
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
  const options = parseProviderSmokeArguments(
    [
      '--case',
      'ossf-cve-2018-16492',
      '--variant',
      'vulnerable',
      '--output',
      output,
      '--debug-diagnostics',
      'true',
    ],
    runtime,
  );

  const run = await runProviderSmoke({
    options,
    runtime,
    environment: {},
    modelProvider: provider,
  });
  const artifact = await readFile(join(output, 'smokes', `${options.runId}.json`), 'utf8');
  const diagnosticDirectory = join(
    output,
    '.provider-evaluations',
    options.runId,
    'work',
    'diagnostics',
  );
  const diagnostics = await readdir(diagnosticDirectory);
  const diagnostic = await readFile(join(diagnosticDirectory, diagnostics.at(0) ?? ''), 'utf8');
  const duplicateProvider = new FakeModelProvider();
  const duplicateOptions = parseProviderSmokeArguments(
    [
      '--case',
      'ossf-cve-2018-16492',
      '--variant',
      'vulnerable',
      '--output',
      output,
      '--run-id',
      options.runId,
    ],
    runtime,
  );
  await expect(
    runProviderSmoke({
      options: duplicateOptions,
      runtime,
      environment: {},
      modelProvider: duplicateProvider,
    }),
  ).rejects.toThrow('checkpoint already exists');
  expect(duplicateProvider.requests).toHaveLength(0);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostic).toContain('coverage-incomplete');
  expect(diagnostic).not.toContain('scripted smoke response');
  expect(artifact).not.toContain('scripted smoke response');
  const resumedProvider = new FakeModelProvider();
  const resumedOptions = parseProviderSmokeArguments(
    [
      '--case',
      'ossf-cve-2018-16492',
      '--variant',
      'vulnerable',
      '--output',
      output,
      '--run-id',
      options.runId,
      '--resume',
      'true',
    ],
    runtime,
  );
  const resumed = await runProviderSmoke({
    options: resumedOptions,
    runtime,
    environment: {},
    modelProvider: resumedProvider,
  });

  expect(run).toMatchObject({ status: 'failed', planProfile: 'audit-reviewed-plan' });
  expect(run.errors).toEqual([
    { code: 'coverage-incomplete', stage: 'evidence-mapping', retryable: false },
  ]);
  expect(resumed.status).toBe('failed');
  expect(resumedProvider.requests).toHaveLength(0);
  expect(artifact).not.toContain('answerKey');
  expect(artifact).not.toContain('request.input');
});

test('rejects a resumed smoke when its immutable target identity changes', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-smoke-identity-'));
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
  const first = parseProviderSmokeArguments(
    [
      '--case',
      'ossf-cve-2018-16492',
      '--variant',
      'vulnerable',
      '--output',
      output,
      '--run-id',
      'smoke-identity-fixture',
    ],
    runtime,
  );
  await runProviderSmoke({ options: first, runtime, environment: {}, modelProvider: provider });

  const changed = parseProviderSmokeArguments(
    [
      '--case',
      'ossf-cve-2018-16492',
      '--variant',
      'patched',
      '--output',
      output,
      '--run-id',
      'smoke-identity-fixture',
      '--resume',
      'true',
    ],
    runtime,
  );
  const resumedProvider = new FakeModelProvider();
  await expect(
    runProviderSmoke({
      options: changed,
      runtime,
      environment: {},
      modelProvider: resumedProvider,
    }),
  ).rejects.toThrow('identity does not match');
  expect(resumedProvider.requests).toHaveLength(0);
});

test('fails closed when another evaluator owns the same smoke run id', async () => {
  const output = await mkdtemp(join(tmpdir(), 'audit-provider-smoke-lock-'));
  const options = parseProviderSmokeArguments(
    [
      '--case',
      'ossf-cve-2018-16492',
      '--variant',
      'vulnerable',
      '--output',
      output,
      '--run-id',
      'smoke-lock-fixture',
    ],
    runtime,
  );
  const lock = await acquireProviderEvaluationLock(output, options.runId);
  try {
    await expect(
      runProviderSmoke({
        options,
        runtime,
        environment: {},
        modelProvider: new FakeModelProvider(),
      }),
    ).rejects.toMatchObject({ code: 'artifact-lease-unavailable' });
  } finally {
    await lock.release();
  }
});
