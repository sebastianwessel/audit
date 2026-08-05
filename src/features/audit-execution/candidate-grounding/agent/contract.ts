import { z } from 'zod';

import {
  CandidateGroundingOutputSchema,
  CandidateGroundingRequestSchema,
} from '../../../audit-execution/candidate-grounding/contract.js';
import {
  ModelRetryGuidanceSchema,
  ScopedInspectionRequirementSchema,
} from '../../../review-workflow/model-contracts/index.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';

export const CandidateGroundingModelInputSchema = CandidateGroundingRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});
export const CandidateGroundingModelOutputSchema = CandidateGroundingOutputSchema;

export type CandidateGroundingModelInput = z.infer<typeof CandidateGroundingModelInputSchema>;
export type CandidateGroundingModelOutput = z.infer<typeof CandidateGroundingModelOutputSchema>;
