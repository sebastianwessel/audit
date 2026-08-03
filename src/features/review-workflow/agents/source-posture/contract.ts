import { z } from 'zod';

import { SourcePostureRequestSchema } from '../../../audit-execution/phase-input/contract.js';
import {
  type UnverifiedSourcePosture,
  UnverifiedSourcePostureSchema,
} from '../../../audit-execution/source-posture/contract.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { ScopedInspectionRequirementSchema } from '../../tools/contract.js';

/** Deliberately excludes findings, priorities, fixes, and every later verdict. */
export const SourcePostureModelInputSchema = SourcePostureRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
});

export const SourcePostureModelOutputSchema = UnverifiedSourcePostureSchema;

export type SourcePostureModelInput = z.infer<typeof SourcePostureModelInputSchema>;
export type SourcePostureModelOutput = UnverifiedSourcePosture;
