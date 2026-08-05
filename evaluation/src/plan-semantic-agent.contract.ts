import { z } from 'zod';
import {
  AdditionalObservationBaseSchema,
  type AttackPlan,
} from '../../src/features/attack-planning/plan.schema.js';
import {
  BoundedTextSchema,
  IdentifierSchema,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';

import type { CorpusAnswerKey } from './corpus.schema.js';
import {
  PlanObservationAdjudicationSchema,
  PlanScenarioAdjudicationSchema,
  PlanVectorAdjudicationSchema,
} from './plan-semantic-adjudication.schema.js';

const PlanSemanticVectorSchema = z.strictObject({
  vectorId: IdentifierSchema,
  title: BoundedTextSchema,
  rationale: BoundedTextSchema,
  enabled: z.boolean(),
  scopeGlobs: z.array(z.string().trim().min(1)),
  reviewObligations: z.array(
    z.strictObject({
      obligationId: IdentifierSchema,
      riskStatement: BoundedTextSchema,
      evidenceRequirement: BoundedTextSchema,
    }),
  ),
  limitations: z.array(BoundedTextSchema),
});

const PlanSemanticScenarioRubricSchema = z.strictObject({
  scenarioId: IdentifierSchema,
  objective: BoundedTextSchema,
  sourceOnlyApplicable: z.boolean(),
  requiredRiskCondition: BoundedTextSchema,
  evidenceRequirements: z.array(BoundedTextSchema).min(1),
});

const PlanSemanticObservationSchema = AdditionalObservationBaseSchema;

/**
 * Evaluator-only input. It intentionally has no source content, source tools,
 * answer-key paths, finding identifiers, locations, paired variants, product
 * findings, or product prompt data.
 */
export const PlanSemanticModelInputSchema = z.strictObject({
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  vectors: z.array(PlanSemanticVectorSchema),
  observations: z.array(PlanSemanticObservationSchema),
  scenarios: z.array(PlanSemanticScenarioRubricSchema),
});

/** Strict mapping returned by the evaluator agent before deterministic binding. */
export const PlanSemanticModelOutputSchema = z.strictObject({
  scenarios: z.array(PlanScenarioAdjudicationSchema),
  vectors: z.array(PlanVectorAdjudicationSchema),
  observations: z.array(PlanObservationAdjudicationSchema),
});

export type PlanSemanticModelInput = z.infer<typeof PlanSemanticModelInputSchema>;
export type PlanSemanticModelOutput = z.infer<typeof PlanSemanticModelOutputSchema>;

export function createPlanSemanticModelInput(input: {
  plan: AttackPlan;
  answerKey: CorpusAnswerKey;
}): PlanSemanticModelInput {
  return PlanSemanticModelInputSchema.parse({
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    vectors: input.plan.vectors.map((vector) => ({
      vectorId: vector.vectorId,
      title: vector.title,
      rationale: vector.rationale,
      enabled: vector.enabled,
      scopeGlobs: vector.scopeGlobs,
      reviewObligations: vector.reviewObligations.map((obligation) => ({
        obligationId: obligation.obligationId,
        riskStatement: obligation.riskStatement,
        evidenceRequirement: obligation.evidenceRequirement,
      })),
      limitations: vector.limitations,
    })),
    observations: input.plan.additionalObservations.map((observation) => ({
      observationId: observation.observationId,
      title: observation.title,
      rationale: observation.rationale,
      scopeGlobs: observation.scopeGlobs,
      reviewObligations: observation.reviewObligations.map((obligation) => ({
        obligationId: obligation.obligationId,
        riskStatement: obligation.riskStatement,
        evidenceRequirement: obligation.evidenceRequirement,
      })),
      limitations: observation.limitations,
    })),
    scenarios: input.answerKey.expectedPlanScenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      objective: scenario.objective,
      sourceOnlyApplicable: scenario.sourceOnlyApplicable,
      requiredRiskCondition: scenario.requiredRiskCondition,
      evidenceRequirements: scenario.evidenceRequirements,
    })),
  });
}
