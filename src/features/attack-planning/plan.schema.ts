import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  modelNullableOptionalSchema,
  modelTokenSchema,
  RelativePathSchema,
  Sha256Schema,
} from '../../shared/contracts/core.js';

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

/**
 * A stable, deliberate review unit selected by the plan author.
 * It prevents later phases from inventing an implicit question/criterion matrix.
 */
export const ReviewObligationSchema = z.strictObject({
  obligationId: IdentifierSchema,
  /** A deliberately risk-positive question, never a control-presence question. */
  riskStatement: BoundedTextSchema.min(1).max(1_000),
  /** The source-backed proof an investigator must seek for this risk statement. */
  evidenceRequirement: BoundedTextSchema.min(1).max(1_000),
});

export type ReviewObligation = z.infer<typeof ReviewObligationSchema>;

const AttackVectorFields = {
  vectorId: IdentifierSchema,
  vectorDigest: Sha256Schema,
  title: z.string().trim().min(3).max(160),
  rationale: BoundedTextSchema.min(1),
  enabled: z.boolean(),
  scopeGlobs: z.array(z.string().trim().min(1).max(256)).min(1),
  reviewObligations: z.array(ReviewObligationSchema).min(1),
  limitations: z.array(BoundedTextSchema.min(1)),
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
  languageHints: z.array(z.string().trim().min(1).max(32)),
});

export const AttackPlanSchema = z.strictObject({
  schemaVersion: z.literal(2),
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  targetDisplayName: z.string().trim().min(1).max(160),
  createdAt: IsoDateTimeSchema,
  inventorySummary: InventorySummarySchema,
  vectors: z.array(AttackVectorSchema).min(1),
});

export const SourceEvidenceSchema = z.strictObject({
  path: RelativePathSchema,
  startLine: z.number().int().positive(),
  endLine: modelNullableOptionalSchema(z.number().int().positive()),
  snippet: z.string(),
  kind: modelTokenSchema(z.enum(['source', 'configuration', 'context', 'inventory'])),
  role: modelTokenSchema(modelNullableOptionalSchema(SourceEvidenceRoleSchema)),
});

export const ProposedFindingSchema = z.strictObject({
  vectorId: IdentifierSchema,
  /** A precise, source-backed security claim. Classification is intentionally post-confirmation. */
  statement: BoundedTextSchema.min(1).max(2_000),
  evidence: z.array(SourceEvidenceSchema).min(1),
  planObligations: PlanObligationReferencesSchema,
  limitations: z.array(BoundedTextSchema.min(1)),
});

export type AttackPlan = z.infer<typeof AttackPlanSchema>;
export type AttackVector = z.infer<typeof AttackVectorSchema>;
export type DraftAttackVector = z.infer<typeof DraftAttackVectorSchema>;
export type InventorySummary = z.infer<typeof InventorySummarySchema>;
export type SourceEvidence = z.infer<typeof SourceEvidenceSchema>;
export type ProposedFinding = z.infer<typeof ProposedFindingSchema>;
export type SourceEvidenceRole = z.infer<typeof SourceEvidenceRoleSchema>;

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
