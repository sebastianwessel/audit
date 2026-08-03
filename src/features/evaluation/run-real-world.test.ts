import { expect, test } from 'bun:test';

import { parseDeterministicCorpusArguments } from './run-real-world.js';

test('selects an explicitly requested deterministic corpus', () => {
  expect(
    parseDeterministicCorpusArguments(
      ['--', '--corpus', 'evaluation/research-corpora/private-mixed-language-v1'],
      'evaluation/corpora',
    ),
  ).toBe('evaluation/research-corpora/private-mixed-language-v1');
});

test('uses the configured corpus only when no explicit corpus is supplied', () => {
  expect(parseDeterministicCorpusArguments([], 'evaluation/corpora')).toBe('evaluation/corpora');
});

test('rejects unsupported deterministic corpus options', () => {
  expect(() => parseDeterministicCorpusArguments(['--split', 'test'])).toThrow(
    'Invalid deterministic corpus evaluation options',
  );
});
