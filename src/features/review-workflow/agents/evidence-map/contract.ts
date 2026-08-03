import { z } from 'zod';
import {
  type UnverifiedEvidenceMap,
  UnverifiedEvidenceMapSchema,
} from '../../../audit-execution/evidence-map/contract.js';
import { EvidenceMapRequestSchema } from '../../../audit-execution/phase-input/contract.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { ScopedInspectionRequirementSchema } from '../../tools/contract.js';

/** Mapper input deliberately contains no prior hypothesis or finding. */
export const EvidenceMapModelInputSchema = EvidenceMapRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
});

export const EvidenceMapModelOutputSchema = UnverifiedEvidenceMapSchema;

export type EvidenceMapModelInput = z.infer<typeof EvidenceMapModelInputSchema>;
export type EvidenceMapModelOutput = UnverifiedEvidenceMap;
