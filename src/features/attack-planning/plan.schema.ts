import { z } from 'zod';

import { ArtifactTextSchema } from '../../shared/contracts/artifact-text.js';
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  modelNullableOptionalSchema,
  modelTokenSchema,
  NonEmptyTextSchema,
  RelativePathSchema,
  Sha256Schema,
} from '../../shared/contracts/core.js';

/** One normalized text boundary for every plan field that may be persisted or rendered. */
export const PersistedPlanTextSchema = ArtifactTextSchema.pipe(NonEmptyTextSchema);
export const PlanTitleSchema = ArtifactTextSchema.pipe(z.string().trim().min(3));

/**
 * Source-local roles used to describe a reported claim or its verification.
 * They organize model-supplied source evidence only; no role has deterministic
 * security meaning.
 */
export const SourceEvidenceRoleSchema = z.enum([
  'entrypoint',
  'operation',
  'unsafe-condition',
  'source',
  'sink',
  'guard',
  'dataflow',
  'root-control',
  'counterevidence',
]);

/** The two mandatory roles in every relational security claim. */
export const ClaimEvidenceRoleSchema = z.enum(['operation', 'unsafe-condition']);

/**
 * A stable, deliberate review unit selected by the plan author.
 * It prevents later phases from inventing an implicit question/criterion matrix.
 */
export const ReviewObligationSchema = z.strictObject({
  obligationId: IdentifierSchema,
  /** A deliberately risk-positive question, never a control-presence question. */
  riskStatement: PersistedPlanTextSchema,
  /** The source-backed proof an investigator must seek for this risk statement. */
  evidenceRequirement: PersistedPlanTextSchema,
});

export type ReviewObligation = z.infer<typeof ReviewObligationSchema>;

const AttackVectorFields = {
  vectorId: IdentifierSchema,
  vectorDigest: Sha256Schema,
  title: PlanTitleSchema,
  rationale: PersistedPlanTextSchema,
  enabled: z.boolean(),
  scopeGlobs: z.array(z.string().trim().min(1)).min(1),
  reviewObligations: z.array(ReviewObligationSchema).min(1),
  limitations: z.array(PersistedPlanTextSchema),
};

function validateReviewObligations(
  vector: { reviewObligations: readonly ReviewObligation[] },
  context: z.RefinementCtx,
): void {
  const identifiers = vector.reviewObligations.map((obligation) => obligation.obligationId);
  if (new Set(identifiers).size !== identifiers.length) {
    context.addIssue({
      code: 'custom',
      path: ['reviewObligations'],
      message: 'Review obligation identifiers must be unique within a vector.',
    });
  }
}

export const AttackVectorSchema = z
  .strictObject(AttackVectorFields)
  .superRefine(validateReviewObligations);

const {
  vectorId: _vectorId,
  vectorDigest: _vectorDigest,
  ...DraftAttackVectorFields
} = AttackVectorFields;

/** Unrefined base retained for model-bound token normalization before canonical validation. */
export const DraftAttackVectorBaseSchema = z.strictObject(DraftAttackVectorFields);

/** Planner-owned vector shape before the plan service assigns its stable vector identity. */
export const DraftAttackVectorSchema =
  DraftAttackVectorBaseSchema.superRefine(validateReviewObligations);

/**
 * A source-aware suggestion for human plan maintenance. It is deliberately
 * not executable audit work and cannot become a finding until a human promotes
 * it into the editable plan draft.
 */
/**
 * Canonical unrefined observation shape for source-free consumers such as the
 * evaluator. The sealed plan adds its feature-owned uniqueness invariant below.
 */
export const AdditionalObservationBaseSchema = DraftAttackVectorBaseSchema.omit({
  enabled: true,
}).extend({ observationId: IdentifierSchema });

export const AdditionalObservationSchema =
  AdditionalObservationBaseSchema.superRefine(validateReviewObligations);

export const AdditionalObservationsSchema = z
  .array(AdditionalObservationSchema)
  .superRefine((observations, context: z.RefinementCtx): void => {
    const identifiers = observations.map((observation) => observation.observationId);
    if (new Set(identifiers).size !== identifiers.length) {
      context.addIssue({
        code: 'custom',
        message: 'Additional observation identifiers must be unique within a plan.',
      });
    }
  });

/**
 * A source-free pointer to one approved risk-positive review obligation.
 * It is an audit-boundary contract, never a finding rule or source claim.
 */
export const PlanObligationReferenceSchema = z.strictObject({
  obligationId: IdentifierSchema,
});

export type PlanObligationReference = z.infer<typeof PlanObligationReferenceSchema>;

/**
 * Canonical identity for one approved risk-positive review obligation.
 * All map, investigation, and verification bindings use this representation.
 */
export function planObligationKey(reference: PlanObligationReference): string {
  return reference.obligationId;
}

export const PlanObligationReferencesSchema = z
  .array(PlanObligationReferenceSchema)
  .min(1)
  .superRefine((references, context) => {
    const unique = new Set(references.map(planObligationKey));
    if (unique.size !== references.length) {
      context.addIssue({
        code: 'custom',
        message: 'Plan obligation references must be unique.',
      });
    }
  });

export const InventorySummarySchema = z.strictObject({
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  languageHints: z.array(z.string().trim().min(1)),
});

export const AttackPlanSchema = z
  .strictObject({
    schemaVersion: z.literal(4),
    planId: IdentifierSchema,
    planDigest: Sha256Schema,
    targetFingerprint: Sha256Schema,
    contextDigest: Sha256Schema,
    targetDisplayName: PersistedPlanTextSchema,
    createdAt: IsoDateTimeSchema,
    resealedFromPlanId: IdentifierSchema.optional(),
    resealedAt: IsoDateTimeSchema.optional(),
    inventorySummary: InventorySummarySchema,
    vectors: z.array(AttackVectorSchema).min(1),
    additionalObservations: AdditionalObservationsSchema,
  })
  .superRefine((plan, context) => {
    if ((plan.resealedFromPlanId === undefined) !== (plan.resealedAt === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['resealedFromPlanId'],
        message: 'A resealed plan requires both its base plan identifier and reseal timestamp.',
      });
    }
    if (plan.resealedFromPlanId === plan.planId) {
      context.addIssue({
        code: 'custom',
        path: ['resealedFromPlanId'],
        message: 'A resealed plan cannot name itself as its base plan.',
      });
    }
    const vectorIds = plan.vectors.map((vector) => vector.vectorId);
    if (new Set(vectorIds).size !== vectorIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['vectors'],
        message: 'Attack-plan vector identifiers must be unique.',
      });
    }
    const vectorDigests = plan.vectors.map((vector) => vector.vectorDigest);
    if (new Set(vectorDigests).size !== vectorDigests.length) {
      context.addIssue({
        code: 'custom',
        path: ['vectors'],
        message: 'Attack-plan vector digests must be unique.',
      });
    }
    if (!plan.vectors.some((vector) => vector.enabled)) {
      context.addIssue({
        code: 'custom',
        path: ['vectors'],
        message: 'An executable attack plan requires at least one enabled vector.',
      });
    }
  });

export const SourceEvidenceSchema = z.strictObject({
  path: RelativePathSchema,
  startLine: z.number().int().positive(),
  endLine: modelNullableOptionalSchema(z.number().int().positive()),
  /** SHA-256 of the exact selected source line. Source text never enters durable artifacts. */
  contentDigest: Sha256Schema,
  kind: modelTokenSchema(z.enum(['source', 'configuration', 'context', 'inventory'])),
  role: modelTokenSchema(modelNullableOptionalSchema(SourceEvidenceRoleSchema)),
});

/**
 * One source-backed role in a relational security claim. A bundle retains every
 * selected location needed for that role instead of inventing a primary line.
 */
export const ClaimEvidenceBundleSchema = z.strictObject({
  role: ClaimEvidenceRoleSchema,
  evidence: z.array(SourceEvidenceSchema).min(1),
});

export const ClaimEvidenceBundlesSchema = z
  .array(ClaimEvidenceBundleSchema)
  .length(2)
  .superRefine((bundles, context) => {
    const roles = bundles.map((bundle) => bundle.role);
    if (
      roles.filter((role) => role === 'operation').length !== 1 ||
      roles.filter((role) => role === 'unsafe-condition').length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A claim requires exactly one operation and one unsafe-condition evidence bundle.',
      });
    }
  });

export const ProposedFindingSchema = z.strictObject({
  vectorId: IdentifierSchema,
  claimEvidenceBundles: ClaimEvidenceBundlesSchema,
  planObligations: PlanObligationReferencesSchema,
});

export type AttackPlan = z.infer<typeof AttackPlanSchema>;
export type AttackVector = z.infer<typeof AttackVectorSchema>;
export type DraftAttackVector = z.infer<typeof DraftAttackVectorSchema>;
export type AdditionalObservation = z.infer<typeof AdditionalObservationSchema>;
export type InventorySummary = z.infer<typeof InventorySummarySchema>;
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
export type ClaimEvidenceBundle = z.infer<typeof ClaimEvidenceBundleSchema>;
export type ProposedFinding = z.infer<typeof ProposedFindingSchema>;
export type SourceEvidenceRole = z.infer<typeof SourceEvidenceRoleSchema>;
export type ClaimEvidenceRole = z.infer<typeof ClaimEvidenceRoleSchema>;
export type ClaimEvidenceItem = Omit<SourceEvidence, 'role'> & {
  role: ClaimEvidenceRole;
};

/** Returns the canonical flattened evidence view for navigation-only consumers. */
export function claimEvidenceItems(
  finding: Pick<ProposedFinding, 'claimEvidenceBundles'>,
): readonly ClaimEvidenceItem[] {
  return finding.claimEvidenceBundles.flatMap((bundle) =>
    bundle.evidence.map((evidence) => ({ ...evidence, role: bundle.role })),
  );
}

/** Returns true only when every reference exists on the supplied approved vector. */
export function hasApprovedPlanObligations(
  vector: AttackVector,
  references: readonly PlanObligationReference[],
): boolean {
  return (
    references.length > 0 &&
    references.every((reference) =>
      vector.reviewObligations.some(
        (obligation) => obligation.obligationId === reference.obligationId,
      ),
    )
  );
}

/** Resolves a later phase reference back to the sole plan-owned stable identity. */
export function findReviewObligation(
  vector: AttackVector,
  reference: PlanObligationReference,
): ReviewObligation | undefined {
  return vector.reviewObligations.find(
    (obligation) => obligation.obligationId === reference.obligationId,
  );
}

/**
 * Requires an exact, non-empty, duplicate-free match. An accepted verifier
 * verdict cannot silently narrow the obligations carried by its hypothesis.
 */
export function hasExactPlanObligations(
  actual: readonly PlanObligationReference[],
  expected: readonly PlanObligationReference[],
): boolean {
  if (actual.length === 0 || actual.length !== expected.length) return false;
  const actualKeys = new Set(actual.map(planObligationKey));
  const expectedKeys = new Set(expected.map(planObligationKey));
  return (
    actualKeys.size === actual.length &&
    expectedKeys.size === expected.length &&
    [...expectedKeys].every((key) => actualKeys.has(key))
  );
}
