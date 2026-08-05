import { z } from 'zod';

import { BoundedTextSchema, RelativePathSchema } from '../../../shared/contracts/core.js';
import { AttackVectorSchema } from '../../attack-planning/plan.schema.js';
import { EvidenceMapInsufficienciesSchema, EvidenceMapSchema } from '../evidence-map/contract.js';
import { SourcePostureSchema } from '../source-posture/contract.js';

export const SourceDocumentSchema = z.strictObject({
  path: RelativePathSchema,
  content: z.string(),
  languageHint: z.string().trim().min(1).nullable(),
});

/** Fields allowed to every pre-verdict source-scoped phase. */
export const ScopedVectorAuditInputSchema = z.strictObject({
  vector: AttackVectorSchema,
  availableSourcePaths: z.array(RelativePathSchema),
  limitations: z.array(BoundedTextSchema.min(1)),
});

/** Neutral mapping deliberately receives no candidate, finding, or verdict-shaped data. */
export const EvidenceMapRequestSchema = ScopedVectorAuditInputSchema;

/**
 * Candidate-blind neutral-map repair receives only the approved vector, its
 * current map, and generic gap tokens. It has no path to candidate-aware or
 * evaluator-only data.
 */
export const EvidenceMapRepairRequestSchema = ScopedVectorAuditInputSchema.extend({
  evidenceMap: EvidenceMapSchema,
  insufficiencies: EvidenceMapInsufficienciesSchema,
});

/** Candidate-blind posture receives only prior neutral source facts. */
export const SourcePostureRequestSchema = ScopedVectorAuditInputSchema.extend({
  evidenceMap: EvidenceMapSchema,
});

/** Investigation receives only its direct, validated predecessors. */
export const AuditInvestigationRequestSchema = ScopedVectorAuditInputSchema.extend({
  evidenceMap: EvidenceMapSchema,
  sourcePosture: SourcePostureSchema,
});

export type SourceDocument = z.infer<typeof SourceDocumentSchema>;
export type ScopedVectorAuditInput = z.infer<typeof ScopedVectorAuditInputSchema>;
export type EvidenceMapRequest = z.infer<typeof EvidenceMapRequestSchema>;
export type EvidenceMapRepairRequest = z.infer<typeof EvidenceMapRepairRequestSchema>;
export type SourcePostureRequest = z.infer<typeof SourcePostureRequestSchema>;
export type AuditInvestigationRequest = z.infer<typeof AuditInvestigationRequestSchema>;
