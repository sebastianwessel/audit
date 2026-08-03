import { expect, test } from 'bun:test';

import { selectTextLineRange, textLinesWithoutEndings } from './text-lines.ts';

test('preserves exact line endings through EOF and bounds explicit ranges', () => {
  const content = 'first\r\nsecond\nthird\r\n';
  expect(selectTextLineRange(content, 1, undefined)).toEqual({
    endLine: 3,
    text: content,
  });
  expect(selectTextLineRange(content, 1, 2)).toEqual({
    endLine: 2,
    text: 'first\r\nsecond',
  });
  expect(selectTextLineRange(content, 2, undefined)).toEqual({
    endLine: 3,
    text: 'second\nthird\r\n',
  });
  expect(selectTextLineRange(content, 4, undefined)).toBeUndefined();
});

test('retains an empty file as one readable empty line', () => {
  expect(selectTextLineRange('', 1, undefined)).toEqual({ endLine: 1, text: '' });
  expect(textLinesWithoutEndings('first\r\nsecond\n')).toEqual(['first', 'second']);
});

test('treats CR-only source as physical lines without normalizing bytes', () => {
  const content = 'first\rsecond\rthird\r';
  expect(textLinesWithoutEndings(content)).toEqual(['first', 'second', 'third']);
  expect(selectTextLineRange(content, 2, undefined)).toEqual({
    endLine: 3,
    text: 'second\rthird\r',
  });
  expect(selectTextLineRange(content, 1, 2)).toEqual({
    endLine: 2,
    text: 'first\rsecond',
  });
});
