import { textLinesWithoutEndings } from '../../platform/filesystem/text-lines.js';
import { sha256 } from '../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import type { SourceEvidence, SourceEvidenceRole } from '../attack-planning/index.js';
import type { SourceSnapshot } from '../target-inventory/index.js';

/**
 * Immutable, scope-bound source-evidence port for audit projection.
 *
 * It deliberately exposes neither a source-document collection nor a read-all
 * operation. Each requested location opens exactly one immutable snapshot
 * object after the path has been checked against the caller's scope.
 */
export type SourceEvidenceResolver = Readonly<{
  sourcePaths: readonly string[];
  forScope: (paths: readonly string[]) => SourceEvidenceResolver;
  resolve: (input: {
    path: string;
    startLine: number;
    role?: SourceEvidenceRole;
  }) => Promise<SourceEvidence | undefined>;
}>;

/** Creates an exact, lazy evidence resolver over one immutable source snapshot. */
export function createSourceEvidenceResolver(input: {
  sourceSnapshot: SourceSnapshot;
  sourcePaths: readonly string[];
}): SourceEvidenceResolver {
  const sourcePaths = [...new Set(input.sourcePaths)].sort((left, right) =>
    left.localeCompare(right),
  );
  const allowedPaths = new Set(sourcePaths);
  return Object.freeze({
    sourcePaths,
    forScope: (paths) => {
      const requestedPaths = [...new Set(paths)].sort((left, right) => left.localeCompare(right));
      if (requestedPaths.some((path) => !allowedPaths.has(path))) {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'A source-evidence scope expanded beyond its approved immutable snapshot paths.',
        );
      }
      return createSourceEvidenceResolver({
        sourceSnapshot: input.sourceSnapshot,
        sourcePaths: requestedPaths,
      });
    },
    resolve: async ({ path, startLine, role }) => {
      if (!allowedPaths.has(path)) return undefined;
      const source = await input.sourceSnapshot.document(path);
      const sourceLine = textLinesWithoutEndings(source.content)[startLine - 1];
      if (sourceLine === undefined) return undefined;
      return {
        path: source.path,
        startLine,
        endLine: startLine,
        contentDigest: sha256(sourceLine),
        kind: source.languageHint === 'configuration' ? 'configuration' : 'source',
        ...(role === undefined ? {} : { role }),
      };
    },
  });
}
