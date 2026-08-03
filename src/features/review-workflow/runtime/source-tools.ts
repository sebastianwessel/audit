import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import { matchesGlob } from '../../audit-execution/investigation/scope.js';
import { inferLanguageHint } from '../../target-inventory/inventory.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import type { ReviewRepositoryToolset } from '../tools/contract.js';
import type { SourceLineRange } from './context-overflow.js';

/**
 * Creates the only repository-tool adapter used by planning and vector stages.
 * A supplied path set turns the same adapter into a vector-scoped capability.
 */
export function createReviewSourceTools(
  filesystem: SourceRepository,
  allowedPaths?: ReadonlySet<string>,
  allowedLineRanges: ReadonlyMap<string, SourceLineRange> = new Map(),
): ReviewRepositoryToolset {
  return {
    listFiles: async (input) => {
      const listed = await filesystem.listFiles({ root: 'target', ...input });
      return {
        entries: listed.entries
          .filter((entry) => allowedPaths === undefined || allowedPaths.has(entry.relativePath))
          .map((entry) => ({
            path: entry.relativePath,
            sizeBytes: entry.sizeBytes,
            languageHint: inferLanguageHint(entry.relativePath),
          })),
      };
    },
    readFile: async (input) => {
      assertAllowedPath(input.path, allowedPaths);
      const range = allowedLineRanges.get(input.path);
      const requestedStart = input.startLine ?? range?.startLine;
      const requestedEnd = input.endLine ?? range?.endLine;
      const read = await filesystem.readFile({
        root: 'target',
        relativePath: input.path,
        startLine:
          range === undefined ? requestedStart : Math.max(requestedStart ?? 1, range.startLine),
        endLine:
          range === undefined
            ? requestedEnd
            : Math.min(requestedEnd ?? range.endLine, range.endLine),
      });
      return {
        path: read.relativePath,
        startLine: read.startLine,
        endLine: read.endLine,
        text: read.text,
      };
    },
    grepFiles: async (input) => {
      const requestedPaths =
        input.paths ?? (allowedPaths === undefined ? undefined : [...allowedPaths]);
      if (requestedPaths !== undefined) {
        for (const path of requestedPaths) assertAllowedPath(path, allowedPaths);
      }
      const matched = await filesystem.grepFiles({
        root: 'target',
        pattern: input.pattern,
        mode: input.mode,
        caseSensitive: input.caseSensitive,
        relativePaths: requestedPaths,
        contextLines: 0,
      });
      return {
        matches: matched.matches
          .filter((match) =>
            isWithinAllowedLineRange(match.relativePath, match.line, allowedLineRanges),
          )
          .map((match) => ({
            path: match.relativePath,
            line: match.line,
            context: match.context,
          })),
      };
    },
  };
}

function isWithinAllowedLineRange(
  path: string,
  line: number,
  allowedLineRanges: ReadonlyMap<string, SourceLineRange>,
): boolean {
  const range = allowedLineRanges.get(path);
  return range === undefined || (line >= range.startLine && line <= range.endLine);
}

/** Returns only advisory context whose explicit glob applies to a scoped source path. */
export function selectApplicableContext(
  context: readonly ContextDocument[],
  sourcePaths: readonly string[],
): readonly ContextDocument[] {
  return context.filter((document) =>
    sourcePaths.some((sourcePath) =>
      document.appliesTo.some((glob) => matchesGlob(sourcePath, glob)),
    ),
  );
}

function assertAllowedPath(path: string, allowedPaths: ReadonlySet<string> | undefined): void {
  if (allowedPaths !== undefined && !allowedPaths.has(path)) {
    throw new SecurityReviewerError(
      'invalid-input',
      'The requested path is outside the approved vector scope.',
    );
  }
}
