import { z } from 'zod';
import { RelativePathSchema, Sha256Schema } from '../../../../shared/contracts/core.js';
import {
  DraftAttackVectorBaseSchema,
  InventorySummarySchema,
} from '../../../attack-planning/plan.schema.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';

const PlannerVectorSchema = DraftAttackVectorBaseSchema;

export const PlanModelInputSchema = z.strictObject({
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  targetDisplayName: z.string().trim().min(1).max(160),
  inventorySummary: InventorySummarySchema,
  sourcePaths: z.array(RelativePathSchema).min(1),
  context: z.array(ContextDocumentSchema),
  createdAt: z.iso.datetime({ offset: true }),
});

export const PlanModelOutputSchema = z.strictObject({
  vectors: z
    .array(
      z.strictObject({
        ...PlannerVectorSchema.shape,
      }),
    )
    .min(1),
});
