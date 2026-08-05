import { matchesFilesystemGlob } from '../../../platform/filesystem/jailed-read-only-filesystem.js';
import type { AttackVector } from '../../attack-planning/index.js';
import type { SourceDocument } from '../audit.schema.js';

/** Matches the small glob grammar accepted in executable plan artifacts. */
export function selectScopedSources(
  vector: AttackVector,
  sources: readonly SourceDocument[],
): SourceDocument[] {
  const scopedPaths = new Set(
    selectScopedSourcePaths(
      vector,
      sources.map((source) => source.path),
    ),
  );
  return sources.filter((source) => scopedPaths.has(source.path));
}

/** Selects the approved source manifest without materializing source content. */
export function selectScopedSourcePaths(
  vector: AttackVector,
  sourcePaths: readonly string[],
): string[] {
  return sourcePaths.filter((path) => vector.scopeGlobs.some((glob) => matchesGlob(path, glob)));
}

export function matchesGlob(path: string, glob: string): boolean {
  return matchesFilesystemGlob(path, glob);
}
