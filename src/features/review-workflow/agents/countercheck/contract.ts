import { z } from 'zod';

import { AuditCountercheckRequestSchema } from '../../../audit-execution/verification/contract.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { ScopedInspectionRequirementSchema } from '../../tools/contract.js';
import { VerificationModelOutputSchema } from '../verification/contract.js';

export const CountercheckModelInputSchema = AuditCountercheckRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
});

/** Countercheck output is deliberately identical to a verifier verdict. */
export const CountercheckModelOutputSchema = VerificationModelOutputSchema;

export type CountercheckModelInput = z.infer<typeof CountercheckModelInputSchema>;
export type CountercheckModelOutput = z.infer<typeof CountercheckModelOutputSchema>;
