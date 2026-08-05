import { canonicalJson, createStableId } from '../../../shared/contracts/core.js';
import { createPlan, type DraftVectorInput } from '../plan/plan.js';
import {
  type AdditionalObservation,
  AdditionalObservationSchema,
  type AttackPlan,
  DraftAttackVectorSchema,
} from '../plan/plan.schema.js';
import type { PlanModelOutput, PlanModelRequest } from './agent/contract.js';

/** Turns validated planner semantics into the sole executable-plan identity representation. */
export function createExecutablePlanFromModelOutput(
  request: PlanModelRequest,
  output: PlanModelOutput,
): AttackPlan {
  return createPlan({
    targetFingerprint: request.targetFingerprint,
    contextDigest: request.contextDigest,
    targetDisplayName: request.targetDisplayName,
    inventorySummary: request.inventorySummary,
    vectors: output.vectors.map(materializePlannerVector),
    additionalObservations: output.additionalObservations.map(materializePlannerObservation),
    createdAt: request.createdAt,
  });
}

/** Materializes stable plan identifiers exactly once, after strict model-shape validation. */
export function materializePlannerVector(
  vector: PlanModelOutput['vectors'][number],
): DraftVectorInput {
  return DraftAttackVectorSchema.parse({
    ...vector,
    reviewObligations: vector.reviewObligations.map((obligation) => ({
      ...obligation,
      obligationId: createStableId('obligation', canonicalJson(obligation)),
    })),
  });
}

/** Additional observations are non-executable, but their durable identity is also feature-owned. */
export function materializePlannerObservation(
  observation: PlanModelOutput['additionalObservations'][number],
): AdditionalObservation {
  const vector = materializePlannerVector({ ...observation, enabled: false });
  return AdditionalObservationSchema.parse({
    observationId: createStableId('observation', canonicalJson(observation)),
    title: vector.title,
    rationale: vector.rationale,
    scopeGlobs: vector.scopeGlobs,
    reviewObligations: vector.reviewObligations,
    limitations: vector.limitations,
  });
}
