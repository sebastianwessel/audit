import { z } from 'zod';

import { IdentifierSchema, RelativePathSchema } from '../../../shared/contracts/core.js';
import { AttackVectorSchema } from '../../attack-planning/plan.schema.js';
import {
  EvidenceMapSchema,
  UnverifiedEvidenceMapEvidenceSelectionSchema,
} from '../evidence-map/contract.js';
import { HypothesisSeedSchema, UnverifiedAuditCandidateSchema } from '../investigation/contract.js';
import { SourcePostureSchema } from '../source-posture/contract.js';
import { VerifiableHypothesisSchema } from '../verification/contract.js';

/** One bounded handoff from a non-reportable discovery seed to a full candidate. */
export const CandidateGroundingRequestSchema = z.strictObject({
  vector: AttackVectorSchema,
  evidenceMap: EvidenceMapSchema,
  sourcePosture: SourcePostureSchema,
  seeds: z.array(HypothesisSeedSchema).min(1),
  availableSourcePaths: z.array(RelativePathSchema),
});

/** Model output selects neutral-map locations; it cannot author free-form claim locations. */
export const UnverifiedGroundedCandidateSchema = UnverifiedAuditCandidateSchema.omit({
  evidence: true,
  sourcePostureAssessmentIds: true,
}).extend({
  operationEvidence: UnverifiedEvidenceMapEvidenceSelectionSchema,
  unsafeConditionEvidence: UnverifiedEvidenceMapEvidenceSelectionSchema,
});

export const CandidateGroundingResultSchema = z.strictObject({
  seedId: IdentifierSchema,
  candidate: UnverifiedGroundedCandidateSchema.nullable(),
});

export const CandidateGroundingOutputSchema = z.strictObject({
  groundings: z.array(CandidateGroundingResultSchema),
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
    disposition: z.literal('null'),
  }),
  z.strictObject({
    seedId: IdentifierSchema,
    disposition: z.literal('binding-rejected'),
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

export type CandidateGroundingRequest = z.infer<typeof CandidateGroundingRequestSchema>;
export type CandidateGroundingOutput = z.infer<typeof CandidateGroundingOutputSchema>;
export type CanonicalCandidateGroundingOutput = z.infer<
  typeof CanonicalCandidateGroundingOutputSchema
>;
export type UnverifiedGroundedCandidate = z.infer<typeof UnverifiedGroundedCandidateSchema>;
