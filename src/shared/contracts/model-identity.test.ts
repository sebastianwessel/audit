import { expect, test } from 'bun:test';

import { ModelRouteIdentitySchema } from './model-identity.js';

test('uses one content-free identity contract for configured model routes', () => {
  expect(ModelRouteIdentitySchema.parse({ provider: 'openai', model: 'gpt-5.6-terra' })).toEqual({
    provider: 'openai',
    model: 'gpt-5.6-terra',
  });
  expect(() => ModelRouteIdentitySchema.parse({ provider: '', model: 'gpt-5.6-terra' })).toThrow();
  expect(() => ModelRouteIdentitySchema.parse({ provider: 'openai', model: '' })).toThrow();
});
