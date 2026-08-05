import {
  evidenceMapProtocolFingerprint,
  investigationGroundingProtocolFingerprint,
  planningProtocolFingerprint,
  verificationProtocolFingerprint,
} from '../../src/features/review-workflow/prompt-protocol.js';
import type { StageIsolatedDiagnosticPackDescriptor } from './stage-isolated-diagnostic-pack.schema.js';

/**
 * Owns the exact stage-protocol identity for the supported diagnostic pack
 * stages. The registry and contributor resealing command must use one source
 * of truth so protocol drift is visible and recoverable without hand editing.
 */
export function stageIsolatedDiagnosticStageProtocolFingerprint(
  stage: StageIsolatedDiagnosticPackDescriptor['stage'],
): string {
  if (stage === 'planning') return planningProtocolFingerprint;
  if (stage === 'evidence-mapping') return evidenceMapProtocolFingerprint;
  if (stage === 'investigation-grounding') return investigationGroundingProtocolFingerprint;
  return verificationProtocolFingerprint;
}
