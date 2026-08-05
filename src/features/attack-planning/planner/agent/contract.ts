import { z } from 'zod';
import { RelativePathSchema, Sha256Schema } from '../../../../shared/contracts/core.js';
import {
  ModelRetryGuidanceSchema,
  ScopedInspectionRequirementSchema,
} from '../../../review-workflow/model-contracts/index.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import {
  InventorySummarySchema,
  PersistedPlanTextSchema,
  PlanTitleSchema,
} from '../../plan/plan.schema.js';

/** Planner output excludes every identity derived and owned by the plan feature. */
const PlannerReviewObligationSchema = z.strictObject({
  riskStatement: PersistedPlanTextSchema,
  evidenceRequirement: PersistedPlanTextSchema,
});

const PlannerVectorSchema = z.strictObject({
  title: PlanTitleSchema,
  rationale: PersistedPlanTextSchema,
  enabled: z.boolean().default(true),
  scopeGlobs: z.array(z.string().trim().min(1)).min(1),
  reviewObligations: z.array(PlannerReviewObligationSchema).min(1),
  limitations: z.array(PersistedPlanTextSchema).default([]),
});

const PlannerAdditionalObservationSchema = PlannerVectorSchema.omit({ enabled: true });

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
  additionalObservations: z.array(PlannerAdditionalObservationSchema).default([]),
});

export type PlanModelRequest = z.infer<typeof PlanModelRequestSchema>;
export type PlanModelInput = z.infer<typeof PlanModelInputSchema>;
export type PlanModelOutput = z.infer<typeof PlanModelOutputSchema>;
