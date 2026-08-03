import { expect, test } from 'bun:test';

import { parseEvaluationOptionPairs } from './command-arguments.js';

test('parses unique evaluation option pairs and permits Bun argument separator', () => {
  expect(parseEvaluationOptionPairs(['--corpus', 'evaluation/custom'])).toEqual({
    corpus: 'evaluation/custom',
  });
  expect(parseEvaluationOptionPairs(['--', '--corpus', 'evaluation/custom'])).toEqual({
    corpus: 'evaluation/custom',
  });
});

test('rejects malformed, duplicate, and valueless evaluation options', () => {
  expect(() => parseEvaluationOptionPairs(['corpus', 'evaluation/custom'])).toThrow(
    'unique --key value pairs',
  );
  expect(() => parseEvaluationOptionPairs(['--corpus'])).toThrow('unique --key value pairs');
  expect(() => parseEvaluationOptionPairs(['--corpus', 'first', '--corpus', 'second'])).toThrow(
    'unique --key value pairs',
  );
});
