import type { AttackPlan } from '../../src/features/attack-planning/plan.schema.js';
import type { ModelStageObservation } from '../../src/features/model-operations/model-operations.js';
import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import type { CorpusAnswerKey } from './corpus.schema.js';
import {
  type PlanSemanticAdjudication,
  type PlanSemanticAdjudicationBinding,
  PlanSemanticAdjudicationSchema,
  type PlanSemanticEvaluation,
  PlanSemanticEvaluationSchema,
} from './plan-semantic-adjudication.schema.js';
import type { PlanSemanticModelOutput } from './plan-semantic-agent.contract.js';

export type { PlanSemanticAdjudicationBinding } from './plan-semantic-adjudication.schema.js';

/** Builds the persisted evaluator artifact after a strict, source-free model response. */
export function bindPlanSemanticModelOutput(input: {
  output: PlanSemanticModelOutput;
  binding: PlanSemanticAdjudicationBinding;
  plan: AttackPlan;
  answerKey: CorpusAnswerKey;
  reviewer: string;
  reviewedAt: string;
}): PlanSemanticAdjudication {
  const output = PlanSemanticAdjudicationSchema.pick({
    scenarios: true,
    vectors: true,
    observations: true,
  }).parse(input.output);
  return PlanSemanticAdjudicationSchema.parse({
    schemaVersion: 5,
    ...input.binding,
    reviewer: input.reviewer,
    reviewerKind: 'ai-assisted',
    reviewedAt: input.reviewedAt,
    ...output,
  });
}

/**
 * Derives the complete evaluator-visible semantic-rubric binding without
 * answer-key paths, finding identifiers, or source locations. Any semantic
 * rubric change must invalidate a completed semantic-review checkpoint before
 * provider dispatch.
 */
export function answerKeyScenarioDigest(answerKey: CorpusAnswerKey): string {
  return sha256(
    canonicalJson({
      caseId: answerKey.caseId,
      expectedPlanScenarios: answerKey.expectedPlanScenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        objective: scenario.objective,
        sourceOnlyApplicable: scenario.sourceOnlyApplicable,
        requiredRiskCondition: scenario.requiredRiskCondition,
        evidenceRequirements: [...scenario.evidenceRequirements],
      })),
    }),
  );
}

/** Validates an AI-assisted semantic judgment structurally, then derives metrics. */
export function createPlanSemanticEvaluation(input: {
  adjudication: PlanSemanticAdjudication;
  binding: PlanSemanticAdjudicationBinding;
  plan: AttackPlan;
  answerKey: CorpusAnswerKey;
  modelObservation: ModelStageObservation;
}): PlanSemanticEvaluation {
  const adjudication = PlanSemanticAdjudicationSchema.parse(input.adjudication);
  assertBinding(adjudication, input.binding, input.plan, input.answerKey);
  assertClosedAiAssistedMapping(adjudication, input.plan, input.answerKey);

  const coveredScenarioCount = adjudication.scenarios.filter(
    (scenario) => scenario.outcome === 'covered',
  ).length;
  const relevantVectorCount = adjudication.vectors.filter(
    (vector) => vector.outcome === 'relevant',
  ).length;
  const enabledVectorCount = adjudication.vectors.length;
  const duplicateRelevantVectorCount = adjudication.scenarios.reduce(
    (total, scenario) => total + Math.max(0, scenario.vectorIds.length - 1),
    0,
  );
  return PlanSemanticEvaluationSchema.parse({
    schemaVersion: 5,
    adjudication,
    modelObservation: input.modelObservation,
    score: {
      expectedScenarioCount: adjudication.scenarios.length,
      coveredScenarioCount,
      scenarioRecall: ratio(coveredScenarioCount, adjudication.scenarios.length),
      enabledVectorCount,
      relevantVectorCount,
      unrelatedVectorCount: enabledVectorCount - relevantVectorCount,
      relevantVectorPrecision: ratio(relevantVectorCount, enabledVectorCount),
      duplicateRelevantVectorCount,
      additionalObservationCount: adjudication.observations.length,
      appropriateObservationCount: adjudication.observations.filter(
        (observation) => observation.outcome === 'appropriate',
      ).length,
      misplacedObservationCount: adjudication.observations.filter(
        (observation) => observation.outcome === 'misplaced',
      ).length,
    },
  });
}

function assertBinding(
  adjudication: PlanSemanticAdjudication,
  binding: PlanSemanticAdjudicationBinding,
  plan: AttackPlan,
  answerKey: CorpusAnswerKey,
): void {
  const matchingFields: ReadonlyArray<keyof PlanSemanticAdjudicationBinding> = [
    'runId',
    'trialId',
    'packId',
    'packVersion',
    'caseId',
    'variant',
    'repetition',
    'planId',
    'planDigest',
    'targetFingerprint',
    'contextDigest',
    'answerKeyScenarioDigest',
    'reviewerProtocolFingerprint',
    'reviewerRoute',
  ];
  for (const field of matchingFields) {
    if (adjudication[field] !== binding[field]) {
      throw invalidAdjudication(`Plan semantic adjudication ${field} does not match its trial.`);
    }
  }
  if (
    adjudication.planId !== plan.planId ||
    adjudication.planDigest !== plan.planDigest ||
    adjudication.targetFingerprint !== plan.targetFingerprint ||
    adjudication.contextDigest !== plan.contextDigest
  ) {
    throw invalidAdjudication(
      'Plan semantic adjudication does not match the exact generated plan.',
    );
  }
  if (adjudication.answerKeyScenarioDigest !== answerKeyScenarioDigest(answerKey)) {
    throw invalidAdjudication(
      'Plan semantic adjudication does not match the answer-key scenarios.',
    );
  }
}

function assertClosedAiAssistedMapping(
  adjudication: PlanSemanticAdjudication,
  plan: AttackPlan,
  answerKey: CorpusAnswerKey,
): void {
  const expectedScenarioIds = new Set(
    answerKey.expectedPlanScenarios.map((scenario) => scenario.scenarioId),
  );
  const enabledVectorIds = new Set(
    plan.vectors.filter((vector) => vector.enabled).map((vector) => vector.vectorId),
  );
  const observationIds = new Set(
    plan.additionalObservations.map((observation) => observation.observationId),
  );
  assertExactIds(
    adjudication.scenarios.map((scenario) => scenario.scenarioId),
    expectedScenarioIds,
    'scenario',
  );
  assertExactIds(
    adjudication.observations.map((observation) => observation.observationId),
    observationIds,
    'additional observation',
  );
  assertExactIds(
    adjudication.vectors.map((vector) => vector.vectorId),
    enabledVectorIds,
    'enabled vector',
  );

  const vectorsById = new Map(adjudication.vectors.map((vector) => [vector.vectorId, vector]));
  const scenariosById = new Map(
    adjudication.scenarios.map((scenario) => [scenario.scenarioId, scenario]),
  );
  for (const scenario of adjudication.scenarios) {
    assertUniqueKnownIds(scenario.vectorIds, enabledVectorIds, 'scenario vector');
    if ((scenario.outcome === 'covered') !== scenario.vectorIds.length > 0) {
      throw invalidAdjudication(
        'A covered scenario must have vectors and an uncovered scenario none.',
      );
    }
    for (const vectorId of scenario.vectorIds) {
      const vector = vectorsById.get(vectorId);
      if (vector === undefined || !vector.scenarioIds.includes(scenario.scenarioId)) {
        throw invalidAdjudication(
          'Scenario and vector adjudication references must be bidirectional.',
        );
      }
    }
  }
  for (const vector of adjudication.vectors) {
    assertUniqueKnownIds(vector.scenarioIds, expectedScenarioIds, 'vector scenario');
    if ((vector.outcome === 'relevant') !== vector.scenarioIds.length > 0) {
      throw invalidAdjudication(
        'A relevant vector must have scenarios and an unrelated vector none.',
      );
    }
    for (const scenarioId of vector.scenarioIds) {
      const scenario = scenariosById.get(scenarioId);
      if (scenario === undefined || !scenario.vectorIds.includes(vector.vectorId)) {
        throw invalidAdjudication(
          'Vector and scenario adjudication references must be bidirectional.',
        );
      }
    }
  }
  for (const observation of adjudication.observations) {
    assertUniqueKnownIds(observation.scenarioIds, expectedScenarioIds, 'observation scenario');
    if ((observation.outcome === 'misplaced') !== observation.scenarioIds.length > 0) {
      throw invalidAdjudication(
        'A misplaced observation must identify uncovered scenarios and an appropriate observation none.',
      );
    }
    for (const scenarioId of observation.scenarioIds) {
      const scenario = scenariosById.get(scenarioId);
      const expectation = inputScenario(answerKey, scenarioId);
      if (
        scenario === undefined ||
        scenario.outcome !== 'uncovered' ||
        !expectation.sourceOnlyApplicable
      ) {
        throw invalidAdjudication(
          'A misplaced observation may reference only a source-only-applicable uncovered scenario.',
        );
      }
    }
  }
}

function assertExactIds(
  actual: readonly string[],
  expected: ReadonlySet<string>,
  label: string,
): void {
  if (
    actual.length !== expected.size ||
    new Set(actual).size !== actual.length ||
    actual.some((identifier) => !expected.has(identifier))
  ) {
    throw invalidAdjudication(`Plan semantic adjudication must close every ${label} exactly once.`);
  }
}

function assertUniqueKnownIds(
  identifiers: readonly string[],
  knownIdentifiers: ReadonlySet<string>,
  label: string,
): void {
  if (
    new Set(identifiers).size !== identifiers.length ||
    identifiers.some((identifier) => !knownIdentifiers.has(identifier))
  ) {
    throw invalidAdjudication(`Plan semantic adjudication contains an invalid ${label} reference.`);
  }
}

function invalidAdjudication(message: string): AuditRuntimeError {
  return new AuditRuntimeError('artifact-invalid', message);
}

function inputScenario(answerKey: CorpusAnswerKey, scenarioId: string) {
  const scenario = answerKey.expectedPlanScenarios.find(
    (candidate) => candidate.scenarioId === scenarioId,
  );
  if (scenario === undefined)
    throw invalidAdjudication('Plan semantic adjudication references an unknown scenario.');
  return scenario;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
