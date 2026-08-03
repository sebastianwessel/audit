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

export type SourceRepository = Pick<
  JailedReadOnlyFilesystem,
  'listFiles' | 'readFile' | 'grepFiles'
>;

/**
 * Immutable in-memory source view. It is built from one accepted inventory and
 * keeps all model-facing reads detached from the mutable target filesystem.
 */
export class SourceSnapshot implements SourceRepository {
  readonly #sources: ReadonlyMap<string, SourceDocument>;
  readonly #entries: readonly FileEntry[];

  public constructor(sources: readonly SourceDocument[]) {
    this.#sources = new Map(sources.map((source) => [source.path, Object.freeze({ ...source })]));
    this.#entries = [...this.#sources.values()]
      .map((source) => ({
        relativePath: source.path,
        sizeBytes: new TextEncoder().encode(source.content).byteLength,
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  /** Internal orchestration projection; no artifact writer receives these bytes. */
  public documents(): readonly SourceDocument[] {
    return [...this.#sources.values()].map((source) => ({ ...source }));
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
    const source = this.#sources.get(input.relativePath);
    if (source === undefined) throw missingSnapshotSource();
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
      const source = this.#sources.get(path);
      if (source === undefined) throw missingSnapshotSource();
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
}

export function createSourceSnapshot(sources: readonly SourceDocument[]): SourceSnapshot {
  return new SourceSnapshot(sources);
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
