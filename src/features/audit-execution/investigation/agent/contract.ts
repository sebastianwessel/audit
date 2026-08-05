import { z } from 'zod';

import { AuditInvestigationRequestSchema } from '../../../audit-execution/audit.schema.js';
import {
  UnverifiedHypothesisSeedSchema,
  UnverifiedInvestigationObligationClosuresSchema,
} from '../../../audit-execution/investigation/contract.js';
import {
  ModelRetryGuidanceSchema,
  ScopedInspectionRequirementSchema,
} from '../../../review-workflow/model-contracts/index.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';

export const VectorAuditModelInputSchema = AuditInvestigationRequestSchema.extend({
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
  retryGuidance: ModelRetryGuidanceSchema,
});

/**
 * Discovery deliberately stops before a reportable finding. It returns only
 * map/posture-bound seeds; canonical evidence is a separate grounding duty.
 */
export const AuditModelOutputSchema = z.strictObject({
  seeds: z.array(UnverifiedHypothesisSeedSchema),
  closures: UnverifiedInvestigationObligationClosuresSchema,
});
