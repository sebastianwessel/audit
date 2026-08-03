import { z } from 'zod';

import { IdentifierSchema, Sha256Schema } from '../../shared/contracts/core.js';

import { AdditionalObservationsSchema, DraftAttackVectorSchema } from './plan.schema.js';

/**
 * The only editable plan representation. It carries no target metadata or
 * derived identities, so resealing cannot silently alter the review target.
 */
export const AttackPlanDraftSchema = z.strictObject({
  schemaVersion: z.literal(1),
  basePlanId: IdentifierSchema,
  basePlanDigest: Sha256Schema,
  vectors: z.array(DraftAttackVectorSchema).min(1),
  additionalObservations: AdditionalObservationsSchema,
  promotedObservationIds: z.array(IdentifierSchema),
});

export type AttackPlanDraft = z.infer<typeof AttackPlanDraftSchema>;
