import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';

import { assertPlanIsSealed, createPlan } from './plan.js';
import { type AttackPlan, AttackPlanSchema, type DraftAttackVector } from './plan.schema.js';
import { type AttackPlanDraft, AttackPlanDraftSchema } from './plan-authoring.schema.js';

/** Creates a constrained human-editable draft from a sealed executable plan. */
export function createAttackPlanDraft(plan: AttackPlan): AttackPlanDraft {
  const sealedPlan = AttackPlanSchema.parse(plan);
  assertPlanIsSealed(sealedPlan);
  return AttackPlanDraftSchema.parse({
    schemaVersion: 1,
    basePlanId: sealedPlan.planId,
    basePlanDigest: sealedPlan.planDigest,
    vectors: sealedPlan.vectors.map(toDraftVector),
  });
}

/**
 * Rebuilds an executable plan from one base plan and an intentionally limited
 * draft. Target identity, context binding, and inventory metadata remain owned
 * by the sealed base plan.
 */
export function resealAttackPlanDraft(input: {
  basePlan: AttackPlan;
  draft: AttackPlanDraft;
}): AttackPlan {
  const basePlan = AttackPlanSchema.parse(input.basePlan);
  const draft = AttackPlanDraftSchema.parse(input.draft);
  assertPlanIsSealed(basePlan);
  if (draft.basePlanId !== basePlan.planId || draft.basePlanDigest !== basePlan.planDigest) {
    throw new SecurityReviewerError(
      'artifact-invalid',
      'The editable draft is not bound to the supplied sealed base plan.',
    );
  }

  const resealed = createPlan({
    targetFingerprint: basePlan.targetFingerprint,
    contextDigest: basePlan.contextDigest,
    targetDisplayName: basePlan.targetDisplayName,
    inventorySummary: basePlan.inventorySummary,
    createdAt: basePlan.createdAt,
    vectors: draft.vectors,
  });
  if (resealed.planId === basePlan.planId) {
    throw new SecurityReviewerError(
      'invalid-input',
      'The editable draft does not change the executable plan.',
    );
  }
  return resealed;
}

/** Returns a fresh editable vector without derived identity fields. */
function toDraftVector(vector: AttackPlan['vectors'][number]): DraftAttackVector {
  return {
    title: vector.title,
    rationale: vector.rationale,
    enabled: vector.enabled,
    scopeGlobs: [...vector.scopeGlobs],
    reviewObligations: vector.reviewObligations.map((obligation) => ({ ...obligation })),
    limitations: [...vector.limitations],
  };
}
