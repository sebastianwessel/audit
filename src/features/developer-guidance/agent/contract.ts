import { z } from 'zod';

import { IdentifierSchema, RelativePathSchema } from '../../../shared/contracts/core.js';
import { AttackVectorSchema } from '../../attack-planning/index.js';
import { PublicFindingSchema } from '../../audit-report/index.js';
import {
  ModelRetryGuidanceSchema,
  ScopedInspectionRequirementSchema,
} from '../../review-workflow/model-contracts/index.js';
import { ContextDocumentSchema } from '../../target-inventory/index.js';

export const RecommendedPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);

/** Strict post-confirmation advice: never a new claim or a modification to one. */
export const DeveloperGuidanceModelInputSchema = z.strictObject({
  guidanceId: IdentifierSchema,
  finding: PublicFindingSchema.refine((finding) => finding.status === 'accepted', {
    message: 'Developer guidance requires an accepted finding.',
  }),
  vector: AttackVectorSchema,
  availableSourcePaths: z.array(RelativePathSchema),
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});

export const DeveloperGuidanceModelOutputSchema = z.strictObject({
  recommendedPriority: RecommendedPrioritySchema,
});

export type DeveloperGuidanceModelInput = z.infer<typeof DeveloperGuidanceModelInputSchema>;
export type DeveloperGuidanceModelOutput = z.infer<typeof DeveloperGuidanceModelOutputSchema>;
