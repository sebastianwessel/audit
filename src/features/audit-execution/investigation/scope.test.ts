import { expect, test } from 'bun:test';

import { AttackVectorSchema } from '../../attack-planning/index.js';
import type { SourceDocument } from '../audit.schema.js';

import { matchesGlob, selectScopedSourcePaths, selectScopedSources } from './scope.js';

const vector = AttackVectorSchema.parse({
  vectorId: 'vector-injection-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Review source scope',
  rationale: 'Only a bounded source area is approved.',
  enabled: true,
  scopeGlobs: ['src/**/*.txt', 'config/*.yaml'],
  reviewObligations: [
    {
      obligationId: 'test-obligation-01',
      riskStatement: 'The approved source area could require review.',
      evidenceRequirement: 'Only matched files are inspected.',
    },
  ],
  limitations: [],
});

const sources: SourceDocument[] = [
  { path: 'src/deep/input.txt', content: 'evidence', languageHint: null },
  { path: 'src/root.txt', content: 'evidence', languageHint: null },
  { path: 'config/review.yaml', content: 'evidence', languageHint: 'yaml' },
  { path: 'private/secret.txt', content: 'evidence', languageHint: null },
];

test('selects only approved glob scope without using language hints as a filter', () => {
  expect(selectScopedSources(vector, sources).map((source) => source.path)).toEqual([
    'src/deep/input.txt',
    'src/root.txt',
    'config/review.yaml',
  ]);
  expect(matchesGlob('private/secret.txt', 'src/**')).toBeFalse();
});

test('selects the approved manifest without materializing source documents', () => {
  expect(
    selectScopedSourcePaths(
      vector,
      sources.map((source) => source.path),
    ),
  ).toEqual(['src/deep/input.txt', 'src/root.txt', 'config/review.yaml']);
});
