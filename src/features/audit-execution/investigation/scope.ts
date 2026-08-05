import { matchesFilesystemGlob } from '../../../platform/filesystem/jailed-read-only-filesystem.js';
import type { AttackVector } from '../../attack-planning/index.js';

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
