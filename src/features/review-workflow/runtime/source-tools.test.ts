import { expect, test } from 'bun:test';

import { createSourceSnapshot } from '../../target-inventory/source-snapshot.js';
import {
  RepoGrepToolInputSchema,
  RepoListToolInputSchema,
  RepoReadToolInputSchema,
} from '../tools/contract.js';
import { createReviewSourceTools, selectApplicableContext } from './source-tools.js';

test('uses omitted list filters for every file in the approved vector scope', async () => {
  const tools = createReviewSourceTools(
    createSourceSnapshot([
      { path: 'src/allowed.unknown', content: 'allowed', languageHint: null },
      { path: 'src/nested/also-allowed.txt', content: 'also allowed', languageHint: null },
      { path: 'outside.txt', content: 'outside', languageHint: null },
    ]),
    new Set(['src/allowed.unknown', 'src/nested/also-allowed.txt']),
  );

  await expect(tools.listFiles(RepoListToolInputSchema.parse({}))).resolves.toEqual({
    entries: [
      { path: 'src/allowed.unknown', sizeBytes: 7, languageHint: null },
      { path: 'src/nested/also-allowed.txt', sizeBytes: 12, languageHint: null },
    ],
  });
});

test('forwards optional grep context to the jailed source tool without a cap', async () => {
  const tools = createReviewSourceTools(
    createSourceSnapshot([
      {
        path: 'src/checked.unknown',
        content: 'before\nneedle\nafter\n',
        languageHint: null,
      },
    ]),
    new Set(['src/checked.unknown']),
  );

  await expect(
    tools.grepFiles(
      RepoGrepToolInputSchema.parse({
        pattern: 'needle',
        mode: 'literal',
        caseSensitive: true,
        contextLines: 1,
      }),
    ),
  ).resolves.toEqual({
    matches: [{ path: 'src/checked.unknown', line: 2, context: 'before\nneedle\nafter' }],
  });
});

test('returns exact physical line records without asking a model to count source text', async () => {
  const tools = createReviewSourceTools(
    createSourceSnapshot([
      {
        path: 'src/line-addressable.unknown',
        content: 'first\r\nsecond\nthird',
        languageHint: null,
      },
    ]),
    new Set(['src/line-addressable.unknown']),
  );

  await expect(
    tools.readFile(
      RepoReadToolInputSchema.parse({
        path: 'src/line-addressable.unknown',
        startLine: 2,
      }),
    ),
  ).resolves.toEqual({
    path: 'src/line-addressable.unknown',
    startLine: 2,
    endLine: 3,
    lines: [
      { line: 2, text: 'second' },
      { line: 3, text: 'third' },
    ],
  });
});

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
