import { z } from 'zod';

import {
  CandidateGroundingOutputSchema,
  CandidateGroundingRequestSchema,
} from '../../../audit-execution/candidate-grounding/contract.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { ScopedInspectionRequirementSchema } from '../../tools/contract.js';

export const CandidateGroundingModelInputSchema = CandidateGroundingRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
});
export const CandidateGroundingModelOutputSchema = CandidateGroundingOutputSchema;

export type CandidateGroundingModelInput = z.infer<typeof CandidateGroundingModelInputSchema>;
export type CandidateGroundingModelOutput = z.infer<typeof CandidateGroundingModelOutputSchema>;
