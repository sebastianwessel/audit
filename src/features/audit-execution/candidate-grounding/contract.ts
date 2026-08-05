import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  RelativePathSchema,
} from '../../../shared/contracts/core.js';
import { AttackVectorSchema } from '../../attack-planning/plan/index.js';
import { EvidenceMapInsufficienciesSchema, EvidenceMapSchema } from '../evidence-map/contract.js';
import { HypothesisSeedSchema } from '../investigation/contract.js';
import { SourcePostureSchema } from '../source-posture/contract.js';
import {
  UnverifiedClaimEvidenceBundlesSchema,
  VerifiableHypothesisSchema,
} from '../verification/contract.js';

/** One bounded handoff from a non-reportable discovery seed to a full candidate. */
export const CandidateGroundingRequestSchema = z.strictObject({
  vector: AttackVectorSchema,
  evidenceMap: EvidenceMapSchema,
  sourcePosture: SourcePostureSchema,
  seeds: z.array(HypothesisSeedSchema).min(1),
  availableSourcePaths: z.array(RelativePathSchema),
});

/**
 * The model states only the new semantic claim and selects neutral-map
 * evidence. Vector, obligation, map-basis, and posture bindings are copied
 * once from the supplied seed during canonicalization; asking the model to
 * repeat those deterministic values made the strict output contract fragile.
 */
export const CandidateGroundingModelCandidateSchema = z.strictObject({
  statement: BoundedTextSchema.min(1),
  claimEvidenceBundles: UnverifiedClaimEvidenceBundlesSchema,
});

/** A null grounding must say whether scoped source disproved the seed or the map needs repair. */
export const CandidateGroundingNullReasonSchema = z.enum([
  'no-source-backed-candidate',
  'map-insufficient',
]);

export const CandidateGroundingResultSchema = z.union([
  z.strictObject({
    seedId: IdentifierSchema,
    candidate: CandidateGroundingModelCandidateSchema,
    nullReason: z.null(),
  }),
  z.strictObject({
    seedId: IdentifierSchema,
    candidate: z.null(),
    nullReason: CandidateGroundingNullReasonSchema,
  }),
]);

export const CandidateGroundingOutputSchema = z
  .strictObject({
    groundings: z.array(CandidateGroundingResultSchema),
    /**
     * Candidate-aware grounding may request more neutral map evidence, but the
     * repair stage receives only these generic obligation-bound tokens.
     */
    mapInsufficiencies: EvidenceMapInsufficienciesSchema.optional(),
  })
  .superRefine((output, context) => {
    const requestsMapRepair = output.groundings.some(
      (grounding) => grounding.candidate === null && grounding.nullReason === 'map-insufficient',
    );
    const declaredMapInsufficiencies = output.mapInsufficiencies?.length ?? 0;
    if (requestsMapRepair && declaredMapInsufficiencies === 0) {
      context.addIssue({
        code: 'custom',
        path: ['mapInsufficiencies'],
        message:
          'A map-insufficient grounding must declare at least one generic map insufficiency.',
      });
    }
    if (!requestsMapRepair && declaredMapInsufficiencies > 0) {
      context.addIssue({
        code: 'custom',
        path: ['mapInsufficiencies'],
        message: 'Only a map-insufficient grounding may request candidate-blind map repair.',
      });
    }
  });

/**
 * Validated, source-backed per-seed result suitable for durable recovery.
 * It deliberately contains neither a discovery seed nor raw model selections.
 */
export const CanonicalCandidateGroundingOutcomeSchema = z.discriminatedUnion('disposition', [
  z.strictObject({
    seedId: IdentifierSchema,
    disposition: z.literal('grounded'),
    hypothesis: VerifiableHypothesisSchema,
  }),
  z.strictObject({
    seedId: IdentifierSchema,
    disposition: z.literal('no-source-backed-candidate'),
  }),
  z.strictObject({
    seedId: IdentifierSchema,
    disposition: z.literal('map-insufficient'),
  }),
]);

export const CanonicalCandidateGroundingOutputSchema = z
  .strictObject({
    groundings: z.array(CanonicalCandidateGroundingOutcomeSchema),
  })
  .superRefine((value, context) => {
    const seedIds = value.groundings.map((grounding) => grounding.seedId);
    if (seedIds.length !== new Set(seedIds).size) {
      context.addIssue({
        code: 'custom',
        path: ['groundings'],
        message: 'Canonical grounding outcomes must not duplicate a discovery seed identity.',
      });
    }
  });

/** Canonical grounding plus source-free requests for candidate-blind map repair. */
export const CandidateGroundingStageOutputSchema = CanonicalCandidateGroundingOutputSchema.extend({
  mapInsufficiencies: EvidenceMapInsufficienciesSchema.optional(),
});

export type CandidateGroundingRequest = z.infer<typeof CandidateGroundingRequestSchema>;
export type CandidateGroundingNullReason = z.infer<typeof CandidateGroundingNullReasonSchema>;
export type CandidateGroundingOutput = z.infer<typeof CandidateGroundingOutputSchema>;
export type CanonicalCandidateGroundingOutput = z.infer<
  typeof CanonicalCandidateGroundingOutputSchema
>;
export type CandidateGroundingStageOutput = z.infer<typeof CandidateGroundingStageOutputSchema>;
export type CandidateGroundingModelCandidate = z.infer<
  typeof CandidateGroundingModelCandidateSchema
>;
