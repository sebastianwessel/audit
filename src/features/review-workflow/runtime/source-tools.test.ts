import { expect, test } from 'bun:test';

import { selectApplicableContext } from './source-tools.js';

test('selects only explicitly applicable advisory context for the vector source paths', () => {
  const digest = 'a'.repeat(64);
  const selected = selectApplicableContext(
    [
      {
        path: 'deployment.md',
        title: 'Deployment',
        kind: 'architecture',
        sensitivity: 'internal',
        appliesTo: ['src/**/*.ts'],
        body: 'Applies only to TypeScript application files.',
        digest,
      },
      {
        path: 'operations.md',
        title: 'Operations',
        kind: 'other',
        sensitivity: 'internal',
        appliesTo: ['ops/**'],
        body: 'Does not apply to the selected vector.',
        digest,
      },
    ],
    ['src/app.ts'],
  );
  expect(selected.map((document) => document.path)).toEqual(['deployment.md']);
});
