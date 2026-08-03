import type { Dirent, Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  type FileEntry,
  type FilesystemRoot,
  type GrepFilesInput,
  GrepFilesInputSchema,
  type GrepFilesResult,
  GrepFilesResultSchema,
  type GrepMode,
  type JailedReadOnlyFilesystemOptions,
  JailedReadOnlyFilesystemOptionsSchema,
  type ListFilesInput,
  ListFilesInputSchema,
  type ListFilesResult,
  ListFilesResultSchema,
  type ReadFileInput,
  ReadFileInputSchema,
  type ReadFileResult,
  ReadFileResultSchema,
} from './filesystem.schema.ts';
import { FilesystemBoundaryError } from './filesystem-error.ts';
import { selectTextLineRange, textLinesWithoutEndings } from './text-lines.ts';

export type JailedReadOnlyFilesystem = Readonly<{
  targetRoot: string;
  contextRoot: string | undefined;
  listFiles: (input: ListFilesInput) => Promise<ListFilesResult>;
  readFile: (input: ReadFileInput) => Promise<ReadFileResult>;
  grepFiles: (input: GrepFilesInput) => Promise<GrepFilesResult>;
}>;

export const createJailedReadOnlyFilesystem = async (
  options: JailedReadOnlyFilesystemOptions,
): Promise<JailedReadOnlyFilesystem> => {
  const parsedOptions = parseOptions(options);
  const targetRoot = await canonicalizeRoot(parsedOptions.targetRoot);
  const contextRoot = parsedOptions.contextRoot
    ? await canonicalizeRoot(parsedOptions.contextRoot)
    : undefined;

  return Object.freeze({
    targetRoot,
    contextRoot,
    listFiles: async (input: ListFilesInput): Promise<ListFilesResult> => {
      const parsedInput = parseListInput(input);
      const root = selectRoot(parsedInput.root, targetRoot, contextRoot);
      const entries = await collectFiles(root, parsedInput.includeGlobs, parsedInput.excludeGlobs);

      return ListFilesResultSchema.parse({ entries });
    },
    readFile: async (input: ReadFileInput): Promise<ReadFileResult> => {
      const parsedInput = parseReadInput(input);
      const root = selectRoot(parsedInput.root, targetRoot, contextRoot);
      const content = await readUtf8File(root, parsedInput.relativePath);
      const selection = selectTextLineRange(content, parsedInput.startLine, parsedInput.endLine);
      if (selection === undefined) {
        throw new FilesystemBoundaryError(
          'INVALID_INPUT',
          'The requested start line is outside the file.',
        );
      }

      return ReadFileResultSchema.parse({
        relativePath: parsedInput.relativePath,
        startLine: parsedInput.startLine,
        endLine: selection.endLine,
        text: selection.text,
      });
    },
    grepFiles: async (input: GrepFilesInput): Promise<GrepFilesResult> => {
      const parsedInput = parseGrepInput(input);
      const root = selectRoot(parsedInput.root, targetRoot, contextRoot);
      const matcher = createSafeGrepMatcher(
        parsedInput.pattern,
        parsedInput.mode,
        parsedInput.caseSensitive,
      );
      const relativePaths = parsedInput.relativePaths
        ? [...new Set(parsedInput.relativePaths)].sort(compareStrings)
        : (await collectFiles(root, ['**/*'], [])).map((entry) => entry.relativePath);
      const matches: GrepFilesResult['matches'] = [];

      for (const relativePath of relativePaths) {
        const content = await readUtf8File(root, relativePath);

        const lines = textLinesWithoutEndings(content);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          if (line === undefined) {
            continue;
          }
          if (!matcher.test(line)) {
            continue;
          }
          const contextStart = Math.max(0, index - parsedInput.contextLines);
          const contextEnd = Math.min(lines.length, index + parsedInput.contextLines + 1);
          const context = selectTextLineRange(content, contextStart + 1, contextEnd);
          if (context === undefined) {
            throw new FilesystemBoundaryError(
              'INVALID_INPUT',
              'The matched line could not be read from the approved file.',
            );
          }
          matches.push({
            relativePath,
            line: index + 1,
            context: context.text,
          });
        }
      }

      return GrepFilesResultSchema.parse({ matches });
    },
  });
};

const parseOptions = (options: JailedReadOnlyFilesystemOptions) => {
  const result = JailedReadOnlyFilesystemOptionsSchema.safeParse(options);
  if (!result.success) {
    throw new FilesystemBoundaryError('INVALID_INPUT', 'The filesystem options are invalid.');
  }
  return result.data;
};

const parseListInput = (input: ListFilesInput) => {
  const result = ListFilesInputSchema.safeParse(input);
  if (!result.success) {
    throw new FilesystemBoundaryError('INVALID_INPUT', 'The list input is invalid.');
  }
  return result.data;
};

const parseReadInput = (input: ReadFileInput) => {
  const result = ReadFileInputSchema.safeParse(input);
  if (!result.success) {
    throw new FilesystemBoundaryError('INVALID_INPUT', 'The read input is invalid.');
  }
  return result.data;
};

const parseGrepInput = (input: GrepFilesInput) => {
  const result = GrepFilesInputSchema.safeParse(input);
  if (!result.success) {
    throw new FilesystemBoundaryError('INVALID_INPUT', 'The grep input is invalid.');
  }
  return result.data;
};

const canonicalizeRoot = async (root: string): Promise<string> => {
  const configuredRoot = resolve(root);
  let rootStat: Stats;
  try {
    rootStat = await lstat(configuredRoot);
  } catch {
    throw new FilesystemBoundaryError('INVALID_ROOT', 'The configured root does not exist.');
  }

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new FilesystemBoundaryError(
      'INVALID_ROOT',
      'The configured root must be a non-symlink directory.',
    );
  }

  try {
    return await realpath(configuredRoot);
  } catch {
    throw new FilesystemBoundaryError(
      'INVALID_ROOT',
      'The configured root cannot be canonicalized.',
    );
  }
};

const selectRoot = (
  kind: FilesystemRoot,
  targetRoot: string,
  contextRoot: string | undefined,
): string => {
  if (kind === 'target') {
    return targetRoot;
  }
  if (contextRoot === undefined) {
    throw new FilesystemBoundaryError('CONTEXT_ROOT_UNAVAILABLE', 'No context root is configured.');
  }
  return contextRoot;
};

const collectFiles = async (
  root: string,
  includeGlobs: readonly string[],
  excludeGlobs: readonly string[],
): Promise<FileEntry[]> => {
  const entries: FileEntry[] = [];

  const visit = async (directory: string, directoryRelativePath: string): Promise<void> => {
    let directoryEntries: Dirent[];
    try {
      directoryEntries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new FilesystemBoundaryError(
        'FILE_NOT_FOUND',
        'A directory disappeared during listing.',
      );
    }

    directoryEntries.sort((left, right) => compareStrings(left.name, right.name));
    for (const directoryEntry of directoryEntries) {
      const relativePath =
        directoryRelativePath.length === 0
          ? directoryEntry.name
          : `${directoryRelativePath}/${directoryEntry.name}`;
      const absolutePath = join(directory, directoryEntry.name);
      let entryStat: Stats;
      try {
        entryStat = await lstat(absolutePath);
      } catch {
        throw new FilesystemBoundaryError(
          'FILE_NOT_FOUND',
          'A directory entry disappeared during listing.',
        );
      }

      if (entryStat.isSymbolicLink()) {
        await assertSymlinkStaysInsideRoot(root, absolutePath);
        continue;
      }
      if (entryStat.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entryStat.isFile() || !matchesFile(relativePath, includeGlobs, excludeGlobs)) {
        continue;
      }
      entries.push({ relativePath, sizeBytes: entryStat.size });
    }
  };

  await visit(root, '');
  return entries.sort((left, right) => compareStrings(left.relativePath, right.relativePath));
};

const readUtf8File = async (root: string, relativePath: string): Promise<string> => {
  const canonicalPath = await resolveFilePath(root, relativePath);
  let fileHandle: FileHandle | undefined;
  try {
    fileHandle = await open(canonicalPath, 'r');
    const fileStat = await fileHandle.stat();
    if (!fileStat.isFile()) {
      throw new FilesystemBoundaryError('NOT_A_FILE', 'The requested path is not a regular file.');
    }
    const bytes = await fileHandle.readFile();
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new FilesystemBoundaryError(
        'INVALID_ENCODING',
        'The requested file is not valid UTF-8.',
      );
    }
  } catch (error) {
    if (error instanceof FilesystemBoundaryError) {
      throw error;
    }
    throw new FilesystemBoundaryError('FILE_NOT_FOUND', 'The requested file cannot be opened.');
  } finally {
    if (fileHandle !== undefined) {
      await fileHandle.close();
    }
  }
};

const resolveFilePath = async (root: string, relativePath: string): Promise<string> => {
  const candidatePath = join(root, ...relativePath.split('/'));
  if (!isPathInsideRoot(root, candidatePath)) {
    throw new FilesystemBoundaryError(
      'INVALID_INPUT',
      'The requested path is outside the configured root.',
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(candidatePath);
  } catch {
    throw new FilesystemBoundaryError('FILE_NOT_FOUND', 'The requested file does not exist.');
  }
  if (!isPathInsideRoot(root, canonicalPath)) {
    throw new FilesystemBoundaryError(
      'SYMLINK_ESCAPE',
      'The requested path resolves outside the configured root.',
    );
  }
  return canonicalPath;
};

const assertSymlinkStaysInsideRoot = async (root: string, symlinkPath: string): Promise<void> => {
  let destination: string;
  try {
    destination = await realpath(symlinkPath);
  } catch {
    throw new FilesystemBoundaryError('UNSAFE_SYMLINK', 'A dangling symlink was encountered.');
  }
  if (!isPathInsideRoot(root, destination)) {
    throw new FilesystemBoundaryError(
      'SYMLINK_ESCAPE',
      'A symlink resolves outside the configured root.',
    );
  }
};

const isPathInsideRoot = (root: string, candidate: string): boolean => {
  const relativeCandidate = relative(root, candidate);
  return (
    relativeCandidate.length > 0 &&
    !relativeCandidate.startsWith('..') &&
    !isAbsolute(relativeCandidate)
  );
};

const matchesFile = (
  relativePath: string,
  includeGlobs: readonly string[],
  excludeGlobs: readonly string[],
): boolean =>
  includeGlobs.some((glob) => matchesFilesystemGlob(relativePath, glob)) &&
  !excludeGlobs.some((glob) => matchesFilesystemGlob(relativePath, glob));

export const matchesFilesystemGlob = (relativePath: string, glob: string): boolean =>
  new RegExp(globToExpression(glob), 'u').test(relativePath);

const globToExpression = (glob: string): string => {
  let expression = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === undefined) {
      continue;
    }
    if (character === '*') {
      const nextCharacter = glob[index + 1];
      if (nextCharacter === '*') {
        const afterDoubleStar = glob[index + 2];
        if (afterDoubleStar === '/') {
          expression += '(?:.*/)?';
          index += 2;
        } else {
          expression += '.*';
          index += 1;
        }
      } else {
        expression += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    expression += character.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return `${expression}$`;
};

export const createSafeGrepMatcher = (
  pattern: string,
  mode: GrepMode,
  caseSensitive: boolean,
): RegExp => {
  if (mode === 'regex' && !isSafeRegex(pattern)) {
    throw new FilesystemBoundaryError(
      'INVALID_PATTERN',
      'The regex uses unsupported or unsafe syntax.',
    );
  }

  const source =
    mode === 'literal'
      ? escapeRegex(pattern)
      : mode === 'identifier'
        ? `(?<![A-Za-z0-9_$])${escapeRegex(pattern)}(?![A-Za-z0-9_$])`
        : pattern;
  try {
    return new RegExp(source, caseSensitive ? 'u' : 'iu');
  } catch {
    throw new FilesystemBoundaryError('INVALID_PATTERN', 'The regex pattern is invalid.');
  }
};

const isSafeRegex = (pattern: string): boolean =>
  !/[()*+?{}]/u.test(pattern) && !/\\[1-9]/u.test(pattern) && !pattern.includes('(?');

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+*?.]/gu, '\\$&');

const compareStrings = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
};
