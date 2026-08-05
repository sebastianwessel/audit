import { z } from 'zod';
import { RelativePathSchema, Sha256Schema } from '../../../../shared/contracts/core.js';
import {
  AdditionalObservationSchema,
  DraftAttackVectorBaseSchema,
  InventorySummarySchema,
} from '../../../attack-planning/plan.schema.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { ModelRetryGuidanceSchema } from '../../runtime/retry-guidance.js';
import { ScopedInspectionRequirementSchema } from '../../tools/contract.js';

const PlannerVectorSchema = DraftAttackVectorBaseSchema;

/** Planner-owned request data before the scoped lifecycle projects its tool requirement. */
export const PlanModelRequestSchema = z.strictObject({
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  targetDisplayName: z.string().trim().min(1).max(160),
  inventorySummary: InventorySummarySchema,
  sourcePaths: z.array(RelativePathSchema).min(1),
  context: z.array(ContextDocumentSchema),
  createdAt: z.iso.datetime({ offset: true }),
});

/** Complete planner input visible to the model. */
export const PlanModelInputSchema = PlanModelRequestSchema.extend({
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});

export const PlanModelOutputSchema = z.strictObject({
  vectors: z
    .array(
      z.strictObject({
        ...PlannerVectorSchema.shape,
      }),
    )
    .min(1),
  additionalObservations: z.array(AdditionalObservationSchema).default([]),
});

export type PlanModelRequest = z.infer<typeof PlanModelRequestSchema>;
export type PlanModelInput = z.infer<typeof PlanModelInputSchema>;
export type PlanModelOutput = z.infer<typeof PlanModelOutputSchema>;
