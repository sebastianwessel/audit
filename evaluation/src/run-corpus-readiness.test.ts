import { expect, test } from 'bun:test';

import { parseCorpusReadinessArguments } from './run-corpus-readiness.js';

test('accepts only explicit local corpus-readiness overrides before I/O', () => {
  expect(
    parseCorpusReadinessArguments([
      '--corpus',
      'evaluation/data/research-corpora/ai-assisted-real-world-v1',
      '--output',
      'evaluation/runs',
    ]),
  ).toEqual({
    corpus: 'evaluation/data/research-corpora/ai-assisted-real-world-v1',
    output: 'evaluation/runs',
  });
  expect(() => parseCorpusReadinessArguments(['--unsupported', 'value'])).toThrow(
    'Invalid corpus-readiness options',
  );
});
