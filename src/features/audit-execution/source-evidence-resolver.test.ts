import { expect, test } from 'bun:test';

import { SourceSnapshot } from '../target-inventory/source-snapshot.js';

import { createSourceEvidenceResolver } from './source-evidence-resolver.js';

test('opens only the referenced snapshot document inside a multi-path resolver scope', async () => {
  const documentReads: string[] = [];
  const sourceSnapshot = new SourceSnapshot({
    entries: [
      { relativePath: 'referenced.unknown', sizeBytes: 11 },
      { relativePath: 'unreferenced.unknown', sizeBytes: 13 },
    ],
    readDocument: async (path) => {
      documentReads.push(path);
      return { path, content: 'reviewed line', languageHint: null };
    },
  });
  const resolver = createSourceEvidenceResolver({
    sourceSnapshot,
    sourcePaths: ['referenced.unknown', 'unreferenced.unknown'],
  }).forScope(['referenced.unknown', 'unreferenced.unknown']);

  await expect(
    resolver.resolve({ path: 'referenced.unknown', startLine: 1 }),
  ).resolves.toMatchObject({
    path: 'referenced.unknown',
    startLine: 1,
  });

  expect(documentReads).toEqual(['referenced.unknown']);
});
