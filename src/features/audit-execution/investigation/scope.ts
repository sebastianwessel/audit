import { matchesFilesystemGlob } from '../../../platform/filesystem/jailed-read-only-filesystem.js';
import type { AttackVector } from '../../attack-planning/index.js';
import type { SourceDocument } from '../audit.schema.js';

/** Matches the small glob grammar accepted in executable plan artifacts. */
export function selectScopedSources(
  vector: AttackVector,
  sources: readonly SourceDocument[],
): SourceDocument[] {
  return sources.filter((source) =>
    vector.scopeGlobs.some((glob) => matchesGlob(source.path, glob)),
  );
}

export function matchesGlob(path: string, glob: string): boolean {
  return matchesFilesystemGlob(path, glob);
}
