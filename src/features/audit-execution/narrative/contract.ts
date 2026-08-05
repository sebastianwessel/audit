import { z } from 'zod';

import { ArtifactTextSchema } from '../../../shared/contracts/artifact-text.js';
import { ClaimEvidenceRoleSchema, ProposedFindingSchema } from '../../attack-planning/index.js';

/**
 * Human-readable, redacted semantic context. It is not raw model output,
 * source evidence, a provenance selector, or a deterministic admission input.
 */
export const AuditNarrativeTextSchema = ArtifactTextSchema.pipe(z.string().trim().min(1));

export const ClaimNarrativeSchema = z.strictObject({
  statement: AuditNarrativeTextSchema,
  roleExplanations: z
    .array(
      z.strictObject({
        role: ClaimEvidenceRoleSchema,
        explanation: AuditNarrativeTextSchema,
      }),
    )
    .length(2)
    .superRefine((items, context) => {
      const roles = items.map((item) => item.role);
      if (
        roles.filter((role) => role === 'operation').length === 1 &&
        roles.filter((role) => role === 'unsafe-condition').length === 1
      ) {
        return;
      }
      context.addIssue({
        code: 'custom',
        message: 'A claim narrative requires exactly one explanation for each evidence role.',
      });
    }),
  limitations: z.array(AuditNarrativeTextSchema),
});

/** Source-backed finding identity plus the human-readable narrative it must carry. */
export const NarratedProposedFindingSchema = ProposedFindingSchema.extend({
  narrative: ClaimNarrativeSchema,
});

export type ClaimNarrative = z.infer<typeof ClaimNarrativeSchema>;
export type NarratedProposedFinding = z.infer<typeof NarratedProposedFindingSchema>;
