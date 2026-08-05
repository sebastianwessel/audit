import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRuntimeConfiguration, parseDotEnv } from './environment.js';

test('loads project-local .env values over the inherited environment without exposing secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-env-'));
  await writeFile(
    join(root, '.env'),
    ['AUDIT_PROVIDER=anthropic', 'AUDIT_MODEL=claude-test'].join('\n'),
    'utf8',
  );
  const loaded = await loadRuntimeConfiguration({
    cwd: root,
    environment: { AUDIT_PROVIDER: 'openai', OPENAI_API_KEY: 'inherited-secret' },
  });
  expect(loaded.configuration).toMatchObject({
    provider: 'anthropic',
    model: 'claude-test',
    modelPricing: {},
  });
  expect(loaded.environment.OPENAI_API_KEY).toBe('inherited-secret');
});

test('rejects removed local pricing variables', async () => {
  await expect(
    loadRuntimeConfiguration({
      environment: { AUDIT_COST_INPUT_PER_MILLION: '2.5' },
      loadDotEnv: false,
    }),
  ).rejects.toThrow('AUDIT_COST_INPUT_PER_MILLION has been removed');
});

test('rejects retired configuration names instead of silently accepting compatibility input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-env-roots-'));
  await writeFile(
    join(root, '.env'),
    [
      'AUDIT_PUBLIC_ARTIFACT_DIR=public-artifacts',
      'AUDIT_PRIVATE_WORK_DIR=private-work',
      'AUDIT_ARTIFACT_DIR=retired-root',
    ].join('\n'),
    'utf8',
  );
  await expect(loadRuntimeConfiguration({ cwd: root, environment: {} })).rejects.toThrow(
    'AUDIT_ARTIFACT_DIR has been removed',
  );
});

test('rejects the former product-prefixed configuration names', async () => {
  await expect(
    loadRuntimeConfiguration({
      environment: { SECURITY_REVIEWER_MODEL: 'retired-model' },
      loadDotEnv: false,
    }),
  ).rejects.toThrow('SECURITY_REVIEWER_MODEL has been removed');
});

test('rejects malformed environment lines and keeps empty values optional', () => {
  expect(() => parseDotEnv('NOT VALID')).toThrow('Invalid .env line 1');
  expect(parseDotEnv('AUDIT_MODEL=')).toEqual({ AUDIT_MODEL: '' });
});

test('accepts any positive vector queue capacity without turning it into an audit-work limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-env-concurrency-'));
  await writeFile(join(root, '.env'), 'AUDIT_MAX_PARALLEL_VECTORS=128\n', 'utf8');
  const loaded = await loadRuntimeConfiguration({ cwd: root, environment: {} });
  expect(loaded.configuration.maxParallelVectors).toBe(128);
});

test('uses the bundled exact catalogue price without local price configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-env-catalogue-'));
  await writeFile(
    join(root, '.env'),
    ['AUDIT_PROVIDER=openai', 'AUDIT_MODEL=gpt-5.3-codex'].join('\n'),
    'utf8',
  );
  const loaded = await loadRuntimeConfiguration({ cwd: root, environment: {} });
  expect(loaded.configuration.modelPricing).toEqual({
    inputPerMillion: 1.75,
    cachedInputPerMillion: 0.175,
    outputPerMillion: 14,
    source: 'catalogue',
  });
});

test('loads an optional observed-cost ceiling without accepting a price override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-env-cost-ceiling-'));
  await writeFile(
    join(root, '.env'),
    [
      'AUDIT_PROVIDER=openai',
      'AUDIT_MODEL=gpt-5.3-codex',
      'AUDIT_MAX_ESTIMATED_COST_USD=1.50',
    ].join('\n'),
    'utf8',
  );
  const loaded = await loadRuntimeConfiguration({ cwd: root, environment: {} });
  expect(loaded.configuration.maxEstimatedCostUsd).toBe(1.5);
  expect(loaded.configuration.modelPricing.source).toBe('catalogue');
});

test('loads a complete independent verifier route without retaining the credential value in configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-env-independent-route-'));
  await writeFile(
    join(root, '.env'),
    [
      'AUDIT_PROVIDER=openai',
      'AUDIT_MODEL=primary-model',
      'AUDIT_VERIFICATION_MODE=independent-route',
      'AUDIT_VERIFIER_PROVIDER=anthropic',
      'AUDIT_VERIFIER_MODEL=verifier-model',
      'AUDIT_VERIFIER_API_KEY_ENV=SECONDARY_PROVIDER_KEY',
    ].join('\n'),
    'utf8',
  );
  const loaded = await loadRuntimeConfiguration({
    cwd: root,
    environment: { SECONDARY_PROVIDER_KEY: 'secret-that-must-not-enter-configuration' },
  });
  expect(loaded.configuration).toMatchObject({
    verificationMode: 'independent-route',
    independentVerifierRoute: {
      provider: 'anthropic',
      model: 'verifier-model',
      apiKeyEnvironmentVariable: 'SECONDARY_PROVIDER_KEY',
      modelPricing: {},
    },
  });
  expect(JSON.stringify(loaded.configuration)).not.toContain(
    'secret-that-must-not-enter-configuration',
  );
});

test('rejects an independent verifier that repeats the normalized primary route', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-env-same-route-'));
  await writeFile(
    join(root, '.env'),
    [
      'AUDIT_PROVIDER=openai',
      'AUDIT_MODEL=primary-model',
      'AUDIT_VERIFICATION_MODE=independent-route',
      'AUDIT_VERIFIER_PROVIDER=openai',
      'AUDIT_VERIFIER_MODEL= PRIMARY-MODEL ',
      'AUDIT_VERIFIER_API_KEY_ENV=SECONDARY_PROVIDER_KEY',
    ].join('\n'),
    'utf8',
  );
  await expect(loadRuntimeConfiguration({ cwd: root, environment: {} })).rejects.toThrow(
    'must differ from the primary route',
  );
});
