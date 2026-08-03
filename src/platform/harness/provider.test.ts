import { expect, test } from 'bun:test';

import {
  configuredProviderCredentialState,
  providerCacheRoutingKey,
  providerRequestTimeout,
} from './provider.js';

test('creates stable provider-side cache routing only for supported providers', () => {
  expect(providerCacheRoutingKey({ provider: 'openai', model: 'gpt-5.3-codex' })).toBe(
    'security-reviewer:gpt-5.3-codex',
  );
  expect(providerCacheRoutingKey({ provider: 'anthropic', model: 'claude-test' })).toBeUndefined();
});

test('omits a disabled harness deadline from provider transport options', () => {
  expect(providerRequestTimeout(undefined)).toBeUndefined();
  expect(providerRequestTimeout(0)).toBeUndefined();
  expect(providerRequestTimeout(60_000)).toBe(60_000);
});

test('reports credential readiness without returning credential content', () => {
  expect(
    configuredProviderCredentialState({
      provider: 'openai',
      environment: { OPENAI_API_KEY: 'configured-secret' },
    }),
  ).toEqual({ environmentVariable: 'OPENAI_API_KEY', configured: true });
  expect(configuredProviderCredentialState({ provider: 'anthropic', environment: {} })).toEqual({
    environmentVariable: 'ANTHROPIC_API_KEY',
    configured: false,
  });
});
