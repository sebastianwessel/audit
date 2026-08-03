import { expect, test } from 'bun:test';

import { providerCacheRoutingKey } from './provider.js';

test('creates stable provider-side cache routing only for supported providers', () => {
  expect(providerCacheRoutingKey({ provider: 'openai', model: 'gpt-5.3-codex' })).toBe(
    'security-reviewer:gpt-5.3-codex',
  );
  expect(providerCacheRoutingKey({ provider: 'anthropic', model: 'claude-test' })).toBeUndefined();
});
