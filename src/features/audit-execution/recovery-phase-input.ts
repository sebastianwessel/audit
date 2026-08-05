import { z } from 'zod';

import { canonicalJson, Sha256Schema, sha256 } from '../../shared/contracts/core.js';

/**
 * Source-free identity of the semantic predecessor state consumed by a
 * reducible scoped stage. It prevents a recovered child from being reused
 * after an append-only map repair or posture recomputation changed its input.
 */
export const RecoveryPhaseInputSchema = z.discriminatedUnion('phase', [
  z.strictObject({ phase: z.literal('evidence-mapping') }),
  z.strictObject({
    phase: z.literal('evidence-map-repair'),
    evidenceMapFingerprint: Sha256Schema,
  }),
  z.strictObject({
    phase: z.literal('source-posture'),
    evidenceMapFingerprint: Sha256Schema,
  }),
  z.strictObject({
    phase: z.literal('investigation'),
    evidenceMapFingerprint: Sha256Schema,
    sourcePostureFingerprint: Sha256Schema,
  }),
  z.strictObject({
    phase: z.literal('candidate-grounding'),
    evidenceMapFingerprint: Sha256Schema,
    sourcePostureFingerprint: Sha256Schema,
  }),
  z.strictObject({
    phase: z.enum(['verification', 'countercheck']),
    candidateFingerprint: Sha256Schema,
    evidenceMapFingerprint: Sha256Schema,
    sourcePostureFingerprint: Sha256Schema,
  }),
]);

export type RecoveryPhaseInput = z.infer<typeof RecoveryPhaseInputSchema>;

/** Exact opaque binding retained with topology and validated recovery leaves. */
export function recoveryPhaseInputFingerprint(input: RecoveryPhaseInput): string {
  return sha256(canonicalJson(RecoveryPhaseInputSchema.parse(input)));
}
