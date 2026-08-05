import { z } from 'zod';

import { AuditCountercheckRequestSchema } from '../../../audit-execution/verification/contract.js';
import {
  ModelRetryGuidanceSchema,
  ScopedInspectionRequirementSchema,
} from '../../../review-workflow/model-contracts/index.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { VerificationModelOutputSchema } from '../../verification/index.js';

export const CountercheckModelInputSchema = AuditCountercheckRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});

/** Countercheck output is deliberately identical to a verifier verdict. */
export const CountercheckModelOutputSchema = VerificationModelOutputSchema;

export type CountercheckModelInput = z.infer<typeof CountercheckModelInputSchema>;
export type CountercheckModelOutput = z.infer<typeof CountercheckModelOutputSchema>;
