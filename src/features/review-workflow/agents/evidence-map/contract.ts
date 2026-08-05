import { z } from 'zod';
import {
  type UnverifiedEvidenceMapRepair,
  UnverifiedEvidenceMapRepairSchema,
  UnverifiedEvidenceMapSchema,
} from '../../../audit-execution/evidence-map/contract.js';
import {
  EvidenceMapRepairRequestSchema,
  EvidenceMapRequestSchema,
} from '../../../audit-execution/phase-input/contract.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { ModelRetryGuidanceSchema } from '../../runtime/retry-guidance.js';
import { ScopedInspectionRequirementSchema } from '../../tools/contract.js';

/** Mapper input deliberately contains no prior hypothesis or finding. */
export const EvidenceMapModelInputSchema = EvidenceMapRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});

/**
 * A live mapper must provide a semantic summary for every fact. The shared
 * unverified schema remains reusable by lossless canonical recovery, whose
 * already-validated fragments can carry an absent optional field structurally.
 */
export const EvidenceMapModelOutputSchema = UnverifiedEvidenceMapSchema.superRefine(
  (value, context) => {
    for (const [index, fact] of value.facts.entries()) {
      if (fact.statement !== undefined) continue;
      context.addIssue({
        code: 'custom',
        path: ['facts', index, 'statement'],
        message: 'A mapper fact requires a concise semantic statement.',
      });
    }
  },
);

/** Separate repair contract prevents a mapper from replacing prior map state. */
export const EvidenceMapRepairModelInputSchema = EvidenceMapRepairRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});

export const EvidenceMapRepairModelOutputSchema = UnverifiedEvidenceMapRepairSchema;

export type EvidenceMapModelInput = z.infer<typeof EvidenceMapModelInputSchema>;
export type EvidenceMapModelOutput = z.infer<typeof EvidenceMapModelOutputSchema>;
export type EvidenceMapRepairModelInput = z.infer<typeof EvidenceMapRepairModelInputSchema>;
export type EvidenceMapRepairModelOutput = UnverifiedEvidenceMapRepair;
