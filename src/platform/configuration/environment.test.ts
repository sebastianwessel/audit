import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRuntimeConfiguration, parseDotEnv } from './environment.js';

test('loads project-local .env values over the inherited environment without exposing secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-env-'));
  await writeFile(
    join(root, '.env'),
    [
      'SECURITY_REVIEWER_PROVIDER=anthropic',
      'SECURITY_REVIEWER_MODEL=claude-test',
      'SECURITY_REVIEWER_COST_INPUT_PER_MILLION=2.5',
      'SECURITY_REVIEWER_COST_CACHED_INPUT_PER_MILLION=0.25',
      'SECURITY_REVIEWER_COST_OUTPUT_PER_MILLION=10',
    ].join('\n'),
    'utf8',
  );
  const loaded = await loadRuntimeConfiguration({
    cwd: root,
    environment: { SECURITY_REVIEWER_PROVIDER: 'openai', OPENAI_API_KEY: 'inherited-secret' },
  });
  expect(loaded.configuration).toMatchObject({
    provider: 'anthropic',
    model: 'claude-test',
    modelPricing: {},
  });
  expect(loaded.environment.OPENAI_API_KEY).toBe('inherited-secret');
});

test('rejects malformed environment lines and keeps empty values optional', () => {
  expect(() => parseDotEnv('NOT VALID')).toThrow('Invalid .env line 1');
  expect(parseDotEnv('SECURITY_REVIEWER_MODEL=')).toEqual({ SECURITY_REVIEWER_MODEL: '' });
});

test('uses the bundled exact catalogue price without local price configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-env-catalogue-'));
  await writeFile(
    join(root, '.env'),
    ['SECURITY_REVIEWER_PROVIDER=openai', 'SECURITY_REVIEWER_MODEL=gpt-5.3-codex'].join('\n'),
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
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-env-cost-ceiling-'));
  await writeFile(
    join(root, '.env'),
    [
      'SECURITY_REVIEWER_PROVIDER=openai',
      'SECURITY_REVIEWER_MODEL=gpt-5.3-codex',
      'SECURITY_REVIEWER_MAX_ESTIMATED_COST_USD=1.50',
    ].join('\n'),
    'utf8',
  );
  const loaded = await loadRuntimeConfiguration({ cwd: root, environment: {} });
  expect(loaded.configuration.maxEstimatedCostUsd).toBe(1.5);
  expect(loaded.configuration.modelPricing.source).toBe('catalogue');
});

test('loads a complete independent verifier route without retaining the credential value in configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-env-independent-route-'));
  await writeFile(
    join(root, '.env'),
    [
      'SECURITY_REVIEWER_PROVIDER=openai',
      'SECURITY_REVIEWER_MODEL=primary-model',
      'SECURITY_REVIEWER_VERIFICATION_MODE=independent-route',
      'SECURITY_REVIEWER_VERIFIER_PROVIDER=anthropic',
      'SECURITY_REVIEWER_VERIFIER_MODEL=verifier-model',
      'SECURITY_REVIEWER_VERIFIER_API_KEY_ENV=SECONDARY_PROVIDER_KEY',
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
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-env-same-route-'));
  await writeFile(
    join(root, '.env'),
    [
      'SECURITY_REVIEWER_PROVIDER=openai',
      'SECURITY_REVIEWER_MODEL=primary-model',
      'SECURITY_REVIEWER_VERIFICATION_MODE=independent-route',
      'SECURITY_REVIEWER_VERIFIER_PROVIDER=openai',
      'SECURITY_REVIEWER_VERIFIER_MODEL= PRIMARY-MODEL ',
      'SECURITY_REVIEWER_VERIFIER_API_KEY_ENV=SECONDARY_PROVIDER_KEY',
    ].join('\n'),
    'utf8',
  );
  await expect(loadRuntimeConfiguration({ cwd: root, environment: {} })).rejects.toThrow(
    'must differ from the primary route',
  );
});
