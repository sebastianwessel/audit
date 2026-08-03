import { z } from 'zod';
import { IdentifierSchema, RelativePathSchema } from '../../../../shared/contracts/core.js';
import { AttackVectorSchema } from '../../../attack-planning/plan.schema.js';
import { EvidenceMapSchema } from '../../../audit-execution/evidence-map/contract.js';
import { SourcePostureSchema } from '../../../audit-execution/source-posture/contract.js';
import {
  UnverifiedAuditVerificationResultSchema,
  VerifiableHypothesisSchema,
} from '../../../audit-execution/verification/contract.js';
import { VerificationEvidenceSelectionBasisSchema } from '../../../audit-execution/verification/evidence-basis.js';
import { ContextDocumentSchema } from '../../../target-inventory/inventory.schema.js';
import { ScopedInspectionRequirementSchema } from '../../tools/contract.js';

export const VerificationModelInputSchema = z.strictObject({
  verificationId: IdentifierSchema,
  vector: AttackVectorSchema,
  evidenceMap: EvidenceMapSchema,
  sourcePosture: SourcePostureSchema,
  hypothesis: VerifiableHypothesisSchema,
  evidenceSelectionBasis: VerificationEvidenceSelectionBasisSchema,
  availableSourcePaths: z.array(RelativePathSchema),
  context: z.array(ContextDocumentSchema),
  inspectionRequirement: ScopedInspectionRequirementSchema,
});

export const VerificationModelOutputSchema = UnverifiedAuditVerificationResultSchema;

export type { VerificationDecision } from '../../../audit-execution/verification/contract.js';
export type VerificationModelInput = z.infer<typeof VerificationModelInputSchema>;
export type VerificationModelOutput = z.infer<typeof VerificationModelOutputSchema>;
