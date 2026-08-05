import { z } from 'zod';

import { BoundedTextSchema, IdentifierSchema } from '../../../shared/contracts/core.js';
import {
  ClaimEvidenceBundlesSchema,
  PlanObligationReferenceSchema,
  PlanObligationReferencesSchema,
  ProposedFindingSchema,
} from '../../attack-planning/index.js';
import {
  EvidenceMapFactIdsSchema,
  UnverifiedEvidenceMapFactIdsSchema,
} from '../evidence-map/contract.js';
import { SourcePostureAssessmentIdsSchema } from '../source-posture/contract.js';
import { UnverifiedClaimEvidenceSelectionBundlesSchema } from '../verification/contract.js';

/**
 * A non-reportable discovery result. Grounding owns a single precise claim and
 * its source basis; presentation, classification, urgency, and remediation are
 * intentionally outside the confirmation path.
 */
const HypothesisSeedFields = {
  seedId: IdentifierSchema,
  vectorId: IdentifierSchema,
  hypothesis: BoundedTextSchema.min(1),
  planObligations: PlanObligationReferencesSchema,
  evidenceMapFactIds: UnverifiedEvidenceMapFactIdsSchema,
  sourcePostureAssessmentIds: SourcePostureAssessmentIdsSchema,
  limitations: z.array(BoundedTextSchema.min(1)),
};

export const HypothesisSeedSchema = z.strictObject(HypothesisSeedFields);

/** Model output omits posture IDs; the validated posture owns their projection. */
export const UnverifiedHypothesisSeedSchema = z.strictObject({
  seedId: HypothesisSeedFields.seedId,
  vectorId: HypothesisSeedFields.vectorId,
  hypothesis: HypothesisSeedFields.hypothesis,
  planObligations: HypothesisSeedFields.planObligations,
  evidenceMapFactIds: HypothesisSeedFields.evidenceMapFactIds,
  limitations: HypothesisSeedFields.limitations,
});

/** Process-local model prose is validated before it is projected into canonical provenance. */
export const UnverifiedAuditCandidateSchema = z.strictObject({
  vectorId: ProposedFindingSchema.shape.vectorId,
  statement: BoundedTextSchema.min(1),
  claimEvidenceBundles: ClaimEvidenceBundlesSchema.element
    .extend({
      explanation: BoundedTextSchema.min(1),
    })
    .array()
    .length(2),
  claimEvidenceSelections: UnverifiedClaimEvidenceSelectionBundlesSchema,
  planObligations: PlanObligationReferencesSchema,
  evidenceMapFactIds: UnverifiedEvidenceMapFactIdsSchema,
  sourcePostureAssessmentIds: SourcePostureAssessmentIdsSchema,
  limitations: z.array(BoundedTextSchema.min(1)),
});

/** Content-free canonical-admission categories, never security meaning. */
export const CandidateStructuralRejectionReasonSchema = z.enum([
  'model-hypothesis-invalid',
  'model-plan-obligation-invalid',
  'model-evidence-map-reference-invalid',
  'model-source-posture-reference-invalid',
  'model-claim-evidence-insufficient',
  'model-evidence-invalid-or-out-of-scope',
]);

/** Content-free categories for a discovery seed rejected before grounding. */
export const HypothesisSeedStructuralRejectionReasonSchema = z.enum([
  'model-hypothesis-invalid',
  'model-seed-duplicate',
  'model-vector-mismatch',
  'model-plan-obligation-invalid',
  'model-evidence-map-reference-invalid',
  'model-source-posture-reference-invalid',
]);

/** An investigator's source-free terminal account of one approved review obligation. */
export const InvestigationClosureDispositionSchema = z.enum([
  'candidate-raised',
  'no-source-backed-candidate',
  'not-applicable',
  'incomplete',
]);

/** Closed durable replacement for model-authored investigation limitations. */
export const InvestigationLimitationCodeSchema = z.literal('model-declared-limitation');

export const InvestigationObligationClosureSchema = z.strictObject({
  planObligation: PlanObligationReferenceSchema,
  disposition: InvestigationClosureDispositionSchema,
  evidenceMapFactIds: EvidenceMapFactIdsSchema,
  sourcePostureAssessmentIds: SourcePostureAssessmentIdsSchema,
  limitations: z.array(InvestigationLimitationCodeSchema),
});

export const UnverifiedInvestigationObligationClosureSchema = z.strictObject({
  planObligation: PlanObligationReferenceSchema,
  disposition: InvestigationClosureDispositionSchema,
  evidenceMapFactIds: UnverifiedEvidenceMapFactIdsSchema,
  limitations: z.array(BoundedTextSchema.min(1)),
});

function uniqueClosureObligations(
  closures: readonly { planObligation: { obligationId: string } }[],
  context: z.RefinementCtx,
): void {
  const keys = closures.map((closure) => closure.planObligation.obligationId);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: 'custom',
      message: 'Investigation closure declarations must not duplicate a plan obligation.',
    });
  }
}

export const InvestigationObligationClosuresSchema = z
  .array(InvestigationObligationClosureSchema)
  .min(1)
  .superRefine(uniqueClosureObligations);

export const UnverifiedInvestigationObligationClosuresSchema = z
  .array(UnverifiedInvestigationObligationClosureSchema)
  .min(1)
  .superRefine(uniqueClosureObligations);

export type UnverifiedAuditCandidate = z.infer<typeof UnverifiedAuditCandidateSchema>;
export type HypothesisSeed = z.infer<typeof HypothesisSeedSchema>;
export type UnverifiedHypothesisSeed = z.infer<typeof UnverifiedHypothesisSeedSchema>;
export type CandidateStructuralRejectionReason = z.infer<
  typeof CandidateStructuralRejectionReasonSchema
>;
export type HypothesisSeedStructuralRejectionReason = z.infer<
  typeof HypothesisSeedStructuralRejectionReasonSchema
>;
export type InvestigationObligationClosure = z.infer<typeof InvestigationObligationClosureSchema>;
export type UnverifiedInvestigationObligationClosure = z.infer<
  typeof UnverifiedInvestigationObligationClosureSchema
>;
