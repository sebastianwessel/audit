import { expect, test } from 'bun:test';

import {
  RepoGrepToolInputSchema,
  RepoListToolInputSchema,
  RepoReadToolOutputSchema,
  ScopedInspectionRequirementSchema,
  scopedInspectionRequirement,
} from './contract.js';

test('defaults omitted list filters to the complete approved scope', () => {
  expect(RepoListToolInputSchema.parse({})).toEqual({
    includeGlobs: ['**/*'],
    excludeGlobs: [],
  });
  expect(() => RepoListToolInputSchema.parse({ includeGlobs: [] })).toThrow();
  expect(() => RepoListToolInputSchema.parse({ unexpected: true })).toThrow();
});

test('accepts an optional nonnegative grep context without imposing a maximum', () => {
  expect(
    RepoGrepToolInputSchema.parse({
      pattern: 'authorize',
      mode: 'identifier',
      caseSensitive: false,
      contextLines: 1_000_000,
    }).contextLines,
  ).toBe(1_000_000);
  expect(() =>
    RepoGrepToolInputSchema.parse({
      pattern: 'authorize',
      mode: 'identifier',
      caseSensitive: false,
      contextLines: -1,
    }),
  ).toThrow();
});

test('requires line-addressable repository reads', () => {
  expect(
    RepoReadToolOutputSchema.parse({
      path: 'src/example.unknown',
      startLine: 7,
      endLine: 8,
      lines: [
        { line: 7, text: 'first' },
        { line: 8, text: 'second' },
      ],
    }),
  ).toEqual({
    path: 'src/example.unknown',
    startLine: 7,
    endLine: 8,
    lines: [
      { line: 7, text: 'first' },
      { line: 8, text: 'second' },
    ],
  });
  expect(() =>
    RepoReadToolOutputSchema.parse({
      path: 'src/example.unknown',
      startLine: 7,
      endLine: 7,
      text: 'legacy unnumbered source',
    }),
  ).toThrow();
});

test('requires a source inspection exactly when the scoped manifest is non-empty', () => {
  expect(scopedInspectionRequirement([])).toEqual({
    required: false,
    allowedToolIds: ['repo_read', 'repo_grep'],
  });
  expect(scopedInspectionRequirement(['src/example.unknown'])).toEqual({
    required: true,
    allowedToolIds: ['repo_read', 'repo_grep'],
  });
});

test('keeps the source-inspection protocol closed to the allowed read tools', () => {
  expect(() =>
    ScopedInspectionRequirementSchema.parse({
      required: true,
      allowedToolIds: ['repo_grep', 'repo_read'],
    }),
  ).toThrow();
  expect(() =>
    ScopedInspectionRequirementSchema.parse({
      required: true,
      allowedToolIds: ['repo_read', 'repo_grep'],
      bypass: true,
    }),
  ).toThrow();
});
