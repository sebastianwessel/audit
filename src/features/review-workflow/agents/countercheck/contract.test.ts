import { expect, test } from 'bun:test';

import { CountercheckModelInputSchema } from './contract.js';

test('does not impose a context-document count limit before provider-signalled recovery', () => {
  expect(
    CountercheckModelInputSchema.shape.context.parse(
      Array.from({ length: 65 }, (_, index) => ({
        path: `context-${index}.md`,
        title: `Context ${index}`,
        kind: 'architecture',
        sensitivity: 'internal',
        appliesTo: ['**/*'],
        body: 'Advisory context.',
        digest: 'a'.repeat(64),
      })),
    ),
  ).toHaveLength(65);
});
