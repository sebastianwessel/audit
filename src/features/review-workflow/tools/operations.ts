import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import { type ToolUsage, ToolUsageSchema } from '../../model-operations/model-operations.schema.js';
import type { ReviewRepositoryToolset } from './contract.js';

export type BudgetedReviewToolset = Readonly<{
  toolset: ReviewRepositoryToolset;
  usage: () => ToolUsage;
}>;

export type ReviewToolTraceRecorder = Readonly<{
  recordToolCall: (input: {
    tool: 'repo_list' | 'repo_read' | 'repo_grep';
    outcome: 'completed' | 'rejected';
    durationMs: number;
    responseBytes: number;
    errorCode: string | null;
  }) => void;
}>;

/** Retains aggregate-only telemetry without a quality-affecting call or response cap. */
export function createObservedReviewToolset(
  toolset: ReviewRepositoryToolset,
  trace?: ReviewToolTraceRecorder,
): BudgetedReviewToolset {
  let toolCallCount = 0;
  let listFilesCallCount = 0;
  let readFileCallCount = 0;
  let grepFilesCallCount = 0;
  let successfulReadFileCallCount = 0;
  let successfulGrepFilesCallCount = 0;
  let rejectedCallCount = 0;
  let returnedBytes = 0;
  const reserve = (kind: 'listFiles' | 'readFile' | 'grepFiles'): void => {
    toolCallCount += 1;
    if (kind === 'listFiles') listFilesCallCount += 1;
    if (kind === 'readFile') readFileCallCount += 1;
    if (kind === 'grepFiles') grepFilesCallCount += 1;
  };
  const invoke = async <Result extends object>(input: {
    tool: 'repo_list' | 'repo_read' | 'repo_grep';
    run: () => Promise<Result>;
  }): Promise<Result> => {
    const started = performance.now();
    try {
      const response = await input.run();
      const responseBytes = serializedByteLength(response);
      returnedBytes += responseBytes;
      if (input.tool === 'repo_read') successfulReadFileCallCount += 1;
      if (input.tool === 'repo_grep') successfulGrepFilesCallCount += 1;
      trace?.recordToolCall({
        tool: input.tool,
        outcome: 'completed',
        durationMs: Math.round(performance.now() - started),
        responseBytes,
        errorCode: null,
      });
      return response;
    } catch (error) {
      rejectedCallCount += 1;
      trace?.recordToolCall({
        tool: input.tool,
        outcome: 'rejected',
        durationMs: Math.round(performance.now() - started),
        responseBytes: 0,
        errorCode: toolErrorCode(error),
      });
      throw error;
    }
  };
  return Object.freeze({
    toolset: {
      listFiles: async (input) => {
        reserve('listFiles');
        return invoke({
          tool: 'repo_list',
          run: () => toolset.listFiles(input),
        });
      },
      readFile: async (input) => {
        reserve('readFile');
        return invoke({
          tool: 'repo_read',
          run: () => toolset.readFile(input),
        });
      },
      grepFiles: async (input) => {
        reserve('grepFiles');
        return invoke({
          tool: 'repo_grep',
          run: () => toolset.grepFiles(input),
        });
      },
    },
    usage: () =>
      ToolUsageSchema.parse({
        toolCallCount,
        listFilesCallCount,
        readFileCallCount,
        grepFilesCallCount,
        successfulReadFileCallCount,
        successfulGrepFilesCallCount,
        rejectedCallCount,
        returnedBytes,
        budgetExhausted: false,
      }),
  });
}

function serializedByteLength(response: object): number {
  return new TextEncoder().encode(JSON.stringify(response)).byteLength;
}

function toolErrorCode(error: unknown): string {
  return error instanceof SecurityReviewerError ? error.code : 'tool-failure';
}
