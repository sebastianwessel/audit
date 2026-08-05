import { z } from 'zod';

import { SourcePostureRequestSchema } from '../../../audit-execution/phase-input/contract.js';
import { UnverifiedSourcePostureSchema } from '../../../audit-execution/source-posture/contract.js';
import {
  ModelRetryGuidanceSchema,
  ScopedInspectionRequirementSchema,
} from '../../../review-workflow/model-contracts/index.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';

/** Deliberately excludes findings, priorities, fixes, and every later verdict. */
export const SourcePostureModelInputSchema = SourcePostureRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});

/** A live posture assessment must retain a concise semantic summary for later bounded stages. */
export const SourcePostureModelOutputSchema = UnverifiedSourcePostureSchema.superRefine(
  (value, context) => {
    for (const [index, assessment] of value.assessments.entries()) {
      if (assessment.summary !== undefined) continue;
      context.addIssue({
        code: 'custom',
        path: ['assessments', index, 'summary'],
        message: 'A posture assessment requires a concise semantic summary.',
      });
    }
  },
);

export type SourcePostureModelInput = z.infer<typeof SourcePostureModelInputSchema>;
export type SourcePostureModelOutput = z.infer<typeof SourcePostureModelOutputSchema>;
