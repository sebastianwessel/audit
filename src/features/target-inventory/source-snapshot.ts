import type {
  FileEntry,
  GrepFilesInput,
  GrepFilesResult,
  JailedReadOnlyFilesystem,
  ListFilesInput,
  ListFilesResult,
  ReadFileInput,
  ReadFileResult,
} from '../../platform/filesystem/index.js';
import { FilesystemBoundaryError, GrepModeSchema } from '../../platform/filesystem/index.js';
import {
  createSafeGrepMatcher,
  matchesFilesystemGlob,
} from '../../platform/filesystem/jailed-read-only-filesystem.js';
import {
  selectTextLineRange,
  textLinesWithoutEndings,
} from '../../platform/filesystem/text-lines.js';
import type { SourceDocument } from '../audit-execution/audit.schema.js';

export type SourceSnapshotDocumentReader = (path: string) => Promise<SourceDocument>;

export type SourceRepository = Pick<
  JailedReadOnlyFilesystem,
  'listFiles' | 'readFile' | 'grepFiles'
>;

/**
 * Immutable source view. Its content reader is bound to one accepted snapshot,
 * so model-facing reads never reopen the mutable target filesystem.
 */
export class SourceSnapshot implements SourceRepository {
  readonly #readDocument: SourceSnapshotDocumentReader;
  readonly #entries: readonly FileEntry[];

  public constructor(input: {
    entries: readonly FileEntry[];
    readDocument: SourceSnapshotDocumentReader;
  }) {
    this.#readDocument = input.readDocument;
    this.#entries = [...input.entries].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
  }

  /**
   * Transitional orchestration projection. Callers must prefer the repository
   * operations above; this method reads sequentially and never caches source
   * content in the snapshot itself.
   */
  public async documents(): Promise<readonly SourceDocument[]> {
    return Promise.all(this.#entries.map((entry) => this.#readDocument(entry.relativePath)));
  }

  public async listFiles(input: ListFilesInput): Promise<ListFilesResult> {
    if ((input.root ?? 'target') !== 'target') throw snapshotTargetOnly();
    const includeGlobs = input.includeGlobs ?? ['**/*'];
    const excludeGlobs = input.excludeGlobs ?? [];
    return {
      entries: this.#entries.filter(
        (entry) =>
          includeGlobs.some((glob) => matchesFilesystemGlob(entry.relativePath, glob)) &&
          !excludeGlobs.some((glob) => matchesFilesystemGlob(entry.relativePath, glob)),
      ),
    };
  }

  public async readFile(input: ReadFileInput): Promise<ReadFileResult> {
    if ((input.root ?? 'target') !== 'target') throw snapshotTargetOnly();
    const source = await this.readDocument(input.relativePath);
    const startLine = input.startLine ?? 1;
    const selection = selectTextLineRange(source.content, startLine, input.endLine);
    if (selection === undefined) throw missingSnapshotSource();
    return {
      relativePath: source.path,
      startLine,
      endLine: selection.endLine,
      text: selection.text,
    };
  }

  public async grepFiles(input: GrepFilesInput): Promise<GrepFilesResult> {
    if ((input.root ?? 'target') !== 'target') throw snapshotTargetOnly();
    const matcher = createSafeGrepMatcher(
      input.pattern,
      GrepModeSchema.parse(input.mode),
      input.caseSensitive ?? false,
    );
    const paths = input.relativePaths ?? this.#entries.map((entry) => entry.relativePath);
    const contextLines = input.contextLines ?? 0;
    const matches: GrepFilesResult['matches'] = [];
    for (const path of [...new Set(paths)].sort()) {
      const source = await this.readDocument(path);
      const lines = textLinesWithoutEndings(source.content);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (line === undefined || !matcher.test(line)) continue;
        const start = Math.max(0, index - contextLines);
        const end = Math.min(lines.length, index + contextLines + 1);
        const context = selectTextLineRange(source.content, start + 1, end);
        if (context === undefined) throw missingSnapshotSource();
        matches.push({
          relativePath: path,
          line: index + 1,
          context: context.text,
        });
      }
    }
    return { matches };
  }

  private async readDocument(path: string): Promise<SourceDocument> {
    if (!this.#entries.some((entry) => entry.relativePath === path)) throw missingSnapshotSource();
    return this.#readDocument(path);
  }
}

export function createSourceSnapshot(sources: readonly SourceDocument[]): SourceSnapshot {
  const byPath = new Map(sources.map((source) => [source.path, Object.freeze({ ...source })]));
  return new SourceSnapshot({
    entries: [...byPath.values()].map((source) => ({
      relativePath: source.path,
      sizeBytes: new TextEncoder().encode(source.content).byteLength,
    })),
    readDocument: async (path) => {
      const source = byPath.get(path);
      if (source === undefined) throw missingSnapshotSource();
      return { ...source };
    },
  });
}

function snapshotTargetOnly(): FilesystemBoundaryError {
  return new FilesystemBoundaryError(
    'CONTEXT_ROOT_UNAVAILABLE',
    'Source snapshots expose target evidence only.',
  );
}

function missingSnapshotSource(): FilesystemBoundaryError {
  return new FilesystemBoundaryError(
    'FILE_NOT_FOUND',
    'The requested source is not in the immutable snapshot.',
  );
}
