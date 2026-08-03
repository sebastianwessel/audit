import { canonicalJson, sha256 } from '../../shared/contracts/core.js';

import type { VerifiableHypothesis } from './verification/contract.js';

/** Creates the opaque stable identity for one canonical candidate-aware input. */
export function candidateAwareFingerprint(candidate: VerifiableHypothesis): string {
  return sha256(canonicalJson(candidate));
}
