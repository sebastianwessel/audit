import type { JailedReadOnlyFilesystem } from '../../platform/filesystem/index.js';
import { FilesystemBoundaryError } from '../../platform/filesystem/index.js';
import { matchesFilesystemGlob } from '../../platform/filesystem/jailed-read-only-filesystem.js';
import { sha256 } from '../../shared/contracts/core.js';
import type { SourceDocument } from '../audit-execution/audit.schema.js';

import { parseContextDocument } from './context.js';
import {
  type SourceAdmissionExclusionReason,
  type SourceAdmissionPolicy,
  type SourceSnapshotManifest,
  type TargetInventory,
  TargetInventorySchema,
} from './inventory.schema.js';
import {
  createSourceSnapshot,
  type SourceSnapshot,
  type SourceSnapshotCapture,
} from './source-snapshot.js';

const languageByExtension: Readonly<Record<string, string>> = {
  '.c': 'c',
  '.cs': 'csharp',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.fs': 'fsharp',
  '.go': 'go',
  '.hs': 'haskell',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'javascript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.lua': 'lua',
  '.md': 'markdown',
  '.php': 'php',
  '.py': 'python',
  '.r': 'r',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.scala': 'scala',
  '.swift': 'swift',
  '.sh': 'shell',
  '.sql': 'sql',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.xml': 'xml',
};

export const DefaultSourceAdmissionPolicy = {
  schemaVersion: 1,
  includeGlobs: ['**/*'],
  defaultExclusions: [
    'vcs-metadata',
    'dependency-or-vendor-cache',
    'build-or-generated-output',
    'local-secret-store',
  ],
  overrides: [],
} as const satisfies SourceAdmissionPolicy;

export type TargetInventoryCapture = Readonly<{
  inventory: TargetInventory;
  snapshot: SourceSnapshot;
  release?: () => Promise<void>;
}>;

export async function inventoryTarget(
  filesystem: JailedReadOnlyFilesystem,
  options: { admissionPolicy?: SourceAdmissionPolicy } = {},
): Promise<TargetInventory> {
  return (await captureTargetInventory(filesystem, options)).inventory;
}

/** Captures every admitted source exactly once, then exposes only its immutable snapshot. */
export async function captureTargetInventory(
  filesystem: JailedReadOnlyFilesystem,
  options: {
    admissionPolicy?: SourceAdmissionPolicy;
    sourceCapture?: SourceSnapshotCapture;
  } = {},
): Promise<TargetInventoryCapture> {
  const policy = options.admissionPolicy ?? DefaultSourceAdmissionPolicy;
  const entries = await filesystem.listFiles({
    root: 'target',
    includeGlobs: ['**/*'],
    excludeGlobs: [],
  });
  const sources: SourceDocument[] = [];
  const rows: SourceSnapshotManifest['rows'] = [];
  try {
    for (const entry of entries.entries) {
      const exclusionReason = sourceAdmissionExclusionReason(entry.relativePath, policy);
      if (exclusionReason !== undefined) {
        rows.push({ disposition: 'excluded', path: entry.relativePath, reason: exclusionReason });
        continue;
      }
      try {
        const read = await filesystem.readFile({
          root: 'target',
          relativePath: entry.relativePath,
          startLine: 1,
        });
        const contentDigest = sha256(read.text);
        const byteLength = new TextEncoder().encode(read.text).byteLength;
        const languageHint = inferLanguageHint(entry.relativePath);
        const source = { path: entry.relativePath, content: read.text, languageHint };
        if (options.sourceCapture === undefined) sources.push(source);
        else await options.sourceCapture.accept(source);
        rows.push({
          disposition: 'admitted',
          path: entry.relativePath,
          byteLength,
          contentDigest,
          objectRef:
            options.sourceCapture?.objectRef(contentDigest) ??
            `snapshots/objects/${contentDigest}.txt`,
          languageHint,
        });
      } catch (error) {
        if (error instanceof FilesystemBoundaryError && error.code === 'INVALID_ENCODING') {
          rows.push({
            disposition: 'excluded',
            path: entry.relativePath,
            reason: 'invalid-encoding',
          });
          continue;
        }
        throw error;
      }
    }
    const admittedRows = rows.filter(
      (row): row is Extract<(typeof rows)[number], { disposition: 'admitted' }> =>
        row.disposition === 'admitted',
    );
    if (admittedRows.length === 0) {
      throw new FilesystemBoundaryError(
        'FILE_NOT_FOUND',
        'The admission policy retained no regular UTF-8 source files.',
      );
    }
    const context = await inventoryContext(filesystem);
    const targetFingerprint = sha256(
      rows
        .flatMap((row) =>
          row.disposition === 'admitted'
            ? [`${row.path}\0${row.byteLength}\0${row.contentDigest}`]
            : [],
        )
        .join('\n'),
    );
    const contextDigest = sha256(context.map((document) => document.digest).join('\n'));
    const languageHints = [
      ...new Set(
        admittedRows.flatMap((source) =>
          source.languageHint === null ? [] : [source.languageHint],
        ),
      ),
    ].sort();
    const sourceSnapshot = {
      schemaVersion: 1,
      policy,
      targetFingerprint,
      rows: rows.map((row) =>
        row.disposition === 'admitted' && options.sourceCapture === undefined
          ? {
              ...row,
              objectRef: `work/snapshots/${targetFingerprint}/objects/${row.contentDigest}.txt`,
            }
          : row,
      ),
    } satisfies SourceSnapshotManifest;
    const inventory = TargetInventorySchema.parse({
      targetFingerprint,
      contextDigest,
      summary: {
        fileCount: admittedRows.length,
        totalBytes: rows.reduce(
          (total, row) => total + (row.disposition === 'admitted' ? row.byteLength : 0),
          0,
        ),
        languageHints,
      },
      sourceSnapshot,
      context,
    });
    return {
      inventory,
      snapshot: options.sourceCapture?.createSnapshot() ?? createSourceSnapshot(sources),
      ...(options.sourceCapture === undefined ? {} : { release: options.sourceCapture.release }),
    };
  } catch (error) {
    await options.sourceCapture?.release();
    throw error;
  }
}

function sourceAdmissionExclusionReason(
  path: string,
  policy: SourceAdmissionPolicy,
): SourceAdmissionExclusionReason | undefined {
  if (!policy.includeGlobs.some((glob) => matchesFilesystemGlob(path, glob))) {
    return 'outside-includes';
  }
  const segments = path.split('/');
  const baseName = segments.at(-1) ?? '';
  const defaultReason =
    (segments.some((segment) => ['.git', '.hg', '.svn'].includes(segment))
      ? 'vcs-metadata'
      : undefined) ??
    (segments.some((segment) =>
      ['node_modules', 'vendor', '.cache', '.pnpm-store'].includes(segment),
    )
      ? 'dependency-or-vendor-cache'
      : undefined) ??
    (segments.some((segment) =>
      ['dist', 'build', 'coverage', '.next', '.turbo', 'out'].includes(segment),
    )
      ? 'build-or-generated-output'
      : undefined) ??
    (baseName === '.env' ||
    baseName.startsWith('.env.') ||
    segments.some((segment) => ['secrets', '.secrets'].includes(segment))
      ? 'local-secret-store'
      : undefined);
  if (defaultReason === undefined || policy.overrides.includes(defaultReason)) return undefined;
  return policy.defaultExclusions.includes(defaultReason) ? defaultReason : undefined;
}

async function inventoryContext(filesystem: JailedReadOnlyFilesystem) {
  if (filesystem.contextRoot === undefined) return [];
  const entries = await filesystem.listFiles({
    root: 'context',
    includeGlobs: ['**/*'],
    excludeGlobs: [],
  });
  const documents = [];
  for (const entry of entries.entries.filter((candidate) =>
    isMarkdownContextPath(candidate.relativePath),
  )) {
    const read = await filesystem.readFile({
      root: 'context',
      relativePath: entry.relativePath,
      startLine: 1,
    });
    documents.push(parseContextDocument(entry.relativePath, read.text));
  }
  return documents;
}

function isMarkdownContextPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/** Best-effort presentation metadata; unknown extensions remain reviewable. */
export function inferLanguageHint(path: string): string | null {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  return languageByExtension[extension] ?? null;
}
