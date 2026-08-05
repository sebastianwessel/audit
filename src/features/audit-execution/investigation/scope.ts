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
  let expression = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
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
    expression += (character ?? '').replace(/[|\\{}()[\]^$+?.]/gu, '\\$&');
  }
  return new RegExp(`${expression}$`, 'u').test(path);
}
