import { expect, test } from 'bun:test';

import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import type { ReviewRepositoryToolset } from './contract.js';
import { createObservedReviewToolset } from './operations.js';

const toolset: ReviewRepositoryToolset = {
  listFiles: async () => ({
    entries: [{ path: 'src/a.ts', sizeBytes: 1, languageHint: 'typescript' }],
  }),
  readFile: async () => ({
    path: 'src/a.ts',
    startLine: 1,
    endLine: 1,
    text: 'x',
  }),
  grepFiles: async () => ({ matches: [] }),
};

test('records aggregate-only tool use without applying a fixed call budget', async () => {
  const bounded = createObservedReviewToolset(toolset);
  await bounded.toolset.listFiles({ includeGlobs: ['**'], excludeGlobs: [] });
  await bounded.toolset.readFile({ path: 'src/a.ts' });
  await bounded.toolset.grepFiles({
    pattern: 'x',
    mode: 'literal',
    caseSensitive: true,
  });
  expect(bounded.usage()).toEqual({
    toolCallCount: 3,
    listFilesCallCount: 1,
    readFileCallCount: 1,
    grepFilesCallCount: 1,
    successfulReadFileCallCount: 1,
    successfulGrepFilesCallCount: 1,
    rejectedCallCount: 0,
    returnedBytes: 145,
    budgetExhausted: false,
  });
});

test('records an ordered, content-free trace including rejected tool calls', async () => {
  const trace: Array<{
    tool: string;
    outcome: string;
    responseBytes: number;
    errorCode: string | null;
  }> = [];
  const bounded = createObservedReviewToolset(
    {
      ...toolset,
      grepFiles: async () => {
        throw new SecurityReviewerError('unsafe-path', 'The raw path must not be persisted.');
      },
    },
    {
      recordToolCall: (event) => trace.push(event),
    },
  );
  await bounded.toolset.readFile({ path: 'src/a.ts' });
  await expect(
    bounded.toolset.grepFiles({
      pattern: 'x',
      mode: 'literal',
      caseSensitive: true,
    }),
  ).rejects.toThrow('raw path');
  expect(bounded.usage()).toMatchObject({
    toolCallCount: 2,
    readFileCallCount: 1,
    grepFilesCallCount: 1,
    successfulReadFileCallCount: 1,
    successfulGrepFilesCallCount: 0,
    rejectedCallCount: 1,
  });
  expect(trace).toEqual([
    expect.objectContaining({
      tool: 'repo_read',
      outcome: 'completed',
      errorCode: null,
    }),
    expect.objectContaining({
      tool: 'repo_grep',
      outcome: 'rejected',
      responseBytes: 0,
      errorCode: 'unsafe-path',
    }),
  ]);
});

test('does not count a rejected read or search as successful source inspection', async () => {
  const bounded = createObservedReviewToolset({
    ...toolset,
    readFile: async () => {
      throw new SecurityReviewerError('unsafe-path', 'The raw path must not be persisted.');
    },
    grepFiles: async () => {
      throw new SecurityReviewerError('unsafe-path', 'The raw path must not be persisted.');
    },
  });
  await expect(bounded.toolset.readFile({ path: 'src/a.ts' })).rejects.toThrow('raw path');
  await expect(
    bounded.toolset.grepFiles({
      pattern: 'x',
      mode: 'literal',
      caseSensitive: true,
    }),
  ).rejects.toThrow('raw path');
  expect(bounded.usage()).toMatchObject({
    readFileCallCount: 1,
    grepFilesCallCount: 1,
    successfulReadFileCallCount: 0,
    successfulGrepFilesCallCount: 0,
    rejectedCallCount: 2,
  });
});
