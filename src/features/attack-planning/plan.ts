import { canonicalJson, createStableId, sha256 } from '../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';

import {
  type AdditionalObservation,
  AdditionalObservationSchema,
  type AttackPlan,
  AttackPlanSchema,
  type AttackVector,
  type DraftAttackVector,
  DraftAttackVectorSchema,
  type InventorySummary,
  PersistedPlanTextSchema,
} from './plan.schema.js';

export type DraftVectorInput = Omit<AttackVector, 'vectorId' | 'vectorDigest'>;

type PlanContent = Readonly<{
  targetFingerprint: string;
  contextDigest: string;
  vectors: AttackVector[];
  additionalObservations: AdditionalObservation[];
}>;

export function createPlan(input: {
  targetFingerprint: string;
  contextDigest: string;
  targetDisplayName: string;
  inventorySummary: InventorySummary;
  vectors: readonly DraftVectorInput[];
  additionalObservations?: readonly AdditionalObservation[];
  createdAt: string;
  resealedFromPlanId?: string;
  resealedAt?: string;
}): AttackPlan {
  const draftVectors: DraftAttackVector[] = input.vectors.map((vector) =>
    DraftAttackVectorSchema.parse(vector),
  );
  const additionalObservations: AdditionalObservation[] = (input.additionalObservations ?? []).map(
    (observation) => AdditionalObservationSchema.parse(observation),
  );
  const targetDisplayName = PersistedPlanTextSchema.parse(input.targetDisplayName);
  const vectors = draftVectors.map((vector) => {
    const vectorDigest = digestVector(vector);
    return {
      ...vector,
      vectorDigest,
      vectorId: createStableId('vector', vectorDigest),
    };
  });
  const content: PlanContent = {
    targetFingerprint: input.targetFingerprint,
    contextDigest: input.contextDigest,
    vectors,
    additionalObservations,
  };
  const planDigest = digestPlan(content);
  return AttackPlanSchema.parse({
    schemaVersion: 4,
    planId: createStableId('plan', planDigest),
    planDigest,
    targetFingerprint: input.targetFingerprint,
    contextDigest: input.contextDigest,
    targetDisplayName,
    createdAt: input.createdAt,
    ...(input.resealedFromPlanId === undefined
      ? {}
      : {
          resealedFromPlanId: input.resealedFromPlanId,
          resealedAt: input.resealedAt,
        }),
    inventorySummary: input.inventorySummary,
    vectors,
    additionalObservations,
  });
}

/** Recomputes every derived identity after a deliberate human plan edit. */
export function resealPlan(plan: AttackPlan): AttackPlan {
  return createPlan({
    targetFingerprint: plan.targetFingerprint,
    contextDigest: plan.contextDigest,
    targetDisplayName: plan.targetDisplayName,
    inventorySummary: plan.inventorySummary,
    createdAt: plan.createdAt,
    ...(plan.resealedFromPlanId === undefined
      ? {}
      : {
          resealedFromPlanId: plan.resealedFromPlanId,
          resealedAt: plan.resealedAt,
        }),
    vectors: plan.vectors.map(toDraftVector),
    additionalObservations: plan.additionalObservations,
  });
}

/** Rejects a tampered or partially resealed executable plan before target access. */
export function assertPlanIsSealed(plan: AttackPlan): void {
  const resealed = resealPlan(AttackPlanSchema.parse(plan));
  if (
    plan.planId !== resealed.planId ||
    plan.planDigest !== resealed.planDigest ||
    plan.vectors.length !== resealed.vectors.length ||
    plan.vectors.some((vector, index) => {
      const expected = resealed.vectors[index];
      return (
        expected === undefined ||
        vector.vectorId !== expected.vectorId ||
        vector.vectorDigest !== expected.vectorDigest
      );
    })
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The supplied plan has been edited without being resealed.',
    );
  }
}

export function assertPlanMatchesTarget(
  plan: AttackPlan,
  targetFingerprint: string,
  contextDigest: string,
): void {
  assertPlanIsSealed(plan);
  if (plan.targetFingerprint !== targetFingerprint || plan.contextDigest !== contextDigest) {
    throw new AuditRuntimeError(
      'plan-target-mismatch',
      'The supplied plan does not match the current target or context.',
    );
  }
}

function digestVector(vector: DraftVectorInput): string {
  return sha256(canonicalJson(vector));
}

function digestPlan(content: PlanContent): string {
  return sha256(
    canonicalJson({
      schemaVersion: 4,
      targetFingerprint: content.targetFingerprint,
      contextDigest: content.contextDigest,
      vectors: content.vectors,
      additionalObservations: content.additionalObservations,
    }),
  );
}

function toDraftVector(vector: AttackVector): DraftVectorInput {
  return {
    title: vector.title,
    rationale: vector.rationale,
    enabled: vector.enabled,
    scopeGlobs: vector.scopeGlobs,
    reviewObligations: vector.reviewObligations,
    limitations: vector.limitations,
  };
}
