import { textLinesWithoutEndings } from '../../platform/filesystem/text-lines.js';
import { sha256 } from '../../shared/contracts/core.js';
import type { SourceEvidence, SourceEvidenceRole } from '../attack-planning/plan.schema.js';

import type { SourceDocument } from './audit.schema.js';

/**
 * Projects one transient jailed source line into the only durable source-evidence
 * representation. The content digest binds the location to inspected bytes
 * without copying source text into a checkpoint or report.
 */
export function createSourceEvidenceReference(input: {
  source: SourceDocument;
  startLine: number;
  role?: SourceEvidenceRole;
}): SourceEvidence | undefined {
  const sourceLine = textLinesWithoutEndings(input.source.content)[input.startLine - 1];
  if (sourceLine === undefined) return undefined;
  return {
    path: input.source.path,
    startLine: input.startLine,
    endLine: input.startLine,
    contentDigest: sha256(sourceLine),
    kind: input.source.languageHint === 'configuration' ? 'configuration' : 'source',
    ...(input.role === undefined ? {} : { role: input.role }),
  };
}
