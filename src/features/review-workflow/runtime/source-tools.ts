import {
  createSafeGrepMatcher,
  matchesFilesystemGlob,
} from '../../../platform/filesystem/jailed-read-only-filesystem.js';
import {
  selectTextLineRange,
  textLinesWithoutEndings,
} from '../../../platform/filesystem/text-lines.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
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
        lines: textLinesWithoutEndings(read.text).map((text, index) => ({
          line: read.startLine + index,
          text,
        })),
      };
    },
    grepFiles: async (input) => {
      const requestedPaths =
        input.paths ?? (allowedPaths === undefined ? undefined : [...allowedPaths]);
      if (requestedPaths !== undefined) {
        for (const path of requestedPaths) assertAllowedPath(path, allowedPaths);
      }
      const matched = await grepWithinAllowedRanges({
        filesystem,
        paths: requestedPaths,
        pattern: input.pattern,
        mode: input.mode,
        caseSensitive: input.caseSensitive,
        contextLines: input.contextLines ?? 0,
        allowedLineRanges,
      });
      return {
        matches: matched.map((match) => ({
          path: match.path,
          line: match.line,
          context: match.context,
        })),
      };
    },
  };
}

async function grepWithinAllowedRanges(input: {
  filesystem: SourceRepository;
  paths: readonly string[] | undefined;
  pattern: string;
  mode: 'literal' | 'identifier' | 'regex';
  caseSensitive: boolean;
  contextLines: number;
  allowedLineRanges: ReadonlyMap<string, SourceLineRange>;
}): Promise<readonly Readonly<{ path: string; line: number; context: string }>[]> {
  if (input.allowedLineRanges.size === 0) {
    const matched = await input.filesystem.grepFiles({
      root: 'target',
      pattern: input.pattern,
      mode: input.mode,
      caseSensitive: input.caseSensitive,
      relativePaths: input.paths === undefined ? undefined : [...input.paths],
      contextLines: input.contextLines,
    });
    return matched.matches.map((match) => ({
      path: match.relativePath,
      line: match.line,
      context: match.context,
    }));
  }
  const paths =
    input.paths ??
    (await input.filesystem.listFiles({ root: 'target' })).entries.map(
      (entry) => entry.relativePath,
    );
  const matcher = createSafeGrepMatcher(input.pattern, input.mode, input.caseSensitive);
  const matches: Array<Readonly<{ path: string; line: number; context: string }>> = [];
  for (const path of [...new Set(paths)].sort((left, right) => left.localeCompare(right))) {
    const range = input.allowedLineRanges.get(path);
    if (range === undefined) {
      const matched = await input.filesystem.grepFiles({
        root: 'target',
        pattern: input.pattern,
        mode: input.mode,
        caseSensitive: input.caseSensitive,
        relativePaths: [path],
        contextLines: input.contextLines,
      });
      matches.push(
        ...matched.matches.map((match) => ({
          path: match.relativePath,
          line: match.line,
          context: match.context,
        })),
      );
      continue;
    }
    const read = await input.filesystem.readFile({
      root: 'target',
      relativePath: path,
      startLine: range.startLine,
      endLine: range.endLine,
    });
    const lines = textLinesWithoutEndings(read.text);
    for (const [index, line] of lines.entries()) {
      if (!matcher.test(line)) continue;
      const start = Math.max(0, index - input.contextLines);
      const end = Math.min(lines.length, index + input.contextLines + 1);
      const context = selectTextLineRange(read.text, start + 1, end);
      if (context === undefined) {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'A matched recovery-range source line could not be reassembled.',
        );
      }
      matches.push({ path, line: read.startLine + index, context: context.text });
    }
  }
  return matches;
}

/** Returns only advisory context whose explicit glob applies to a scoped source path. */
export function selectApplicableContext(
  context: readonly ContextDocument[],
  sourcePaths: readonly string[],
): readonly ContextDocument[] {
  return context.filter((document) =>
    sourcePaths.some((sourcePath) =>
      document.appliesTo.some((glob) => matchesFilesystemGlob(sourcePath, glob)),
    ),
  );
}

function assertAllowedPath(path: string, allowedPaths: ReadonlySet<string> | undefined): void {
  if (allowedPaths !== undefined && !allowedPaths.has(path)) {
    throw new AuditRuntimeError(
      'invalid-input',
      'The requested path is outside the approved vector scope.',
    );
  }
}
