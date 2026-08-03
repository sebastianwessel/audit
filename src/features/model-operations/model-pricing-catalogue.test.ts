import { expect, test } from 'bun:test';

import { catalogueModelPricing } from './model-pricing-catalogue.js';
import { modelPricingSnapshot } from './model-pricing-snapshot.js';

test('uses an exact verified provider/model price record only', () => {
  expect(catalogueModelPricing({ provider: 'OpenAI', model: ' GPT-5.3-Codex ' })).toEqual({
    inputPerMillion: 1.75,
    cachedInputPerMillion: 0.175,
    outputPerMillion: 14,
    source: 'catalogue',
  });
  expect(catalogueModelPricing({ provider: 'openai', model: 'gpt-5.3-codex-preview' })).toEqual({});
  expect(catalogueModelPricing({ provider: undefined, model: undefined })).toEqual({});
});

test('resolves an exact bundled snapshot record without duplicating its price', () => {
  const entry = Object.entries(modelPricingSnapshot.models).find(
    ([, price]) => price.provider === 'anthropic',
  );
  expect(entry).toBeDefined();
  if (entry === undefined) return;
  const [model, { provider: _provider, ...price }] = entry;
  expect(
    catalogueModelPricing({ provider: ' Anthropic ', model: ` ${model.toUpperCase()} ` }),
  ).toEqual({
    ...price,
    source: 'catalogue',
  });
});
