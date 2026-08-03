import { canonicalJson, sha256 } from '../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import type { AttackPlan } from '../attack-planning/plan.schema.js';

import type { CorpusAnswerKey, CorpusVariant } from './corpus.schema.js';
import {
  type PlanSemanticAdjudication,
  PlanSemanticAdjudicationSchema,
  type PlanSemanticAdjudicationTemplate,
  PlanSemanticAdjudicationTemplateSchema,
  type PlanSemanticEvaluation,
  PlanSemanticEvaluationSchema,
} from './plan-semantic-adjudication.schema.js';

export type PlanSemanticAdjudicationBinding = Readonly<{
  runId: string;
  trialId: string;
  packId: string;
  packVersion: string;
  caseId: string;
  variant: CorpusVariant;
  repetition: number;
}>;

/** Derives the exact evaluator-only scenario input without retaining its source ranges or wording. */
export function answerKeyScenarioDigest(answerKey: CorpusAnswerKey): string {
  return sha256(
    canonicalJson({
      caseId: answerKey.caseId,
      expectedPlanScenarios: answerKey.expectedPlanScenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        relevantPaths: [...scenario.relevantPaths].sort(),
        expectedFindingIds: [...scenario.expectedFindingIds].sort(),
      })),
    }),
  );
}

/** Creates an intentionally unscoreable, source-free human adjudication template. */
export function createPlanSemanticAdjudicationTemplate(input: {
  binding: PlanSemanticAdjudicationBinding;
  plan: AttackPlan;
  answerKey: CorpusAnswerKey;
}): PlanSemanticAdjudicationTemplate {
  return PlanSemanticAdjudicationTemplateSchema.parse({
    schemaVersion: 1,
    ...input.binding,
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    targetFingerprint: input.plan.targetFingerprint,
    contextDigest: input.plan.contextDigest,
    answerKeyScenarioDigest: answerKeyScenarioDigest(input.answerKey),
    reviewer: null,
    reviewedAt: null,
    rationale: null,
    scenarios: input.answerKey.expectedPlanScenarios.map((scenario) => ({
      scenarioId: scenario.scenarioId,
      outcome: null,
      vectorIds: [],
    })),
    vectors: input.plan.vectors
      .filter((vector) => vector.enabled)
      .map((vector) => ({ vectorId: vector.vectorId, outcome: null, scenarioIds: [] })),
  });
}

/**
 * Validates a human semantic judgment structurally, then derives metrics. The
 * human is the sole semantic authority; this function never reads plan text.
 */
export function createPlanSemanticEvaluation(input: {
  adjudication: PlanSemanticAdjudication;
  binding: PlanSemanticAdjudicationBinding;
  plan: AttackPlan;
  answerKey: CorpusAnswerKey;
}): PlanSemanticEvaluation {
  const adjudication = PlanSemanticAdjudicationSchema.parse(input.adjudication);
  assertBinding(adjudication, input.binding, input.plan, input.answerKey);
  assertClosedHumanMapping(adjudication, input.plan, input.answerKey);

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
    schemaVersion: 1,
    adjudication,
    score: {
      expectedScenarioCount: adjudication.scenarios.length,
      coveredScenarioCount,
      scenarioRecall: ratio(coveredScenarioCount, adjudication.scenarios.length),
      enabledVectorCount,
      relevantVectorCount,
      unrelatedVectorCount: enabledVectorCount - relevantVectorCount,
      relevantVectorPrecision: ratio(relevantVectorCount, enabledVectorCount),
      duplicateRelevantVectorCount,
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

function assertClosedHumanMapping(
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
  assertExactIds(
    adjudication.scenarios.map((scenario) => scenario.scenarioId),
    expectedScenarioIds,
    'scenario',
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

function invalidAdjudication(message: string): SecurityReviewerError {
  return new SecurityReviewerError('artifact-invalid', message);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
