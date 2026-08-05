import { expect, test } from 'bun:test';

import { createPlan } from '../../src/features/attack-planning/plan.js';
import { observeModelStage } from '../../src/features/model-operations/model-operations.js';

import { CorpusAnswerKeySchema } from './corpus.schema.js';
import {
  answerKeyScenarioDigest,
  bindPlanSemanticModelOutput,
  createPlanSemanticEvaluation,
} from './plan-semantic-adjudication.js';
import {
  type PlanSemanticAdjudication,
  PlanSemanticAdjudicationSchema,
} from './plan-semantic-adjudication.schema.js';
import {
  createPlanSemanticModelInput,
  PlanSemanticModelInputSchema,
} from './plan-semantic-agent.contract.js';

const expectedFinding = {
  findingId: 'answer-key-only-finding-id',
  staticReviewApplicable: true,
  evidenceRoles: [
    {
      role: 'operation',
      notApplicable: false,
      ranges: [{ path: 'answer-key-only/expected-location.txt', startLine: 7, endLine: 7 }],
    },
    {
      role: 'unsafe-condition',
      notApplicable: false,
      ranges: [{ path: 'answer-key-only/expected-location.txt', startLine: 7, endLine: 7 }],
    },
  ],
};

const expectedPlanScenarios = [
  {
    scenarioId: 'scenario-query-01',
    objective: 'Review the source query boundary.',
    sourceOnlyApplicable: true,
    requiredRiskCondition: 'Input can alter query semantics.',
    evidenceRequirements: ['Inspect input origin.', 'Inspect query construction.'],
    relevantPaths: ['answer-key-only/expected-location.txt'],
    expectedFindingIds: ['answer-key-only-finding-id'],
  },
];
const expectedPlanScenario = expectedPlanScenarios[0];
if (expectedPlanScenario === undefined) throw new Error('Expected one scenario rubric.');

const answerKey = CorpusAnswerKeySchema.parse({
  schemaVersion: 6,
  caseId: 'private-case-01',
  findingCoverage: 'targeted',
  expectedPlanScenarios,
  expectedFindings: [expectedFinding],
  patchedExpectation: 'no-matching-finding',
  staticReviewApplicable: true,
  adjudicationStatus: 'dual-reviewed',
  reviewers: ['reviewer-one', 'reviewer-two'],
  independentReviews: [
    {
      reviewer: 'reviewer-one',
      reviewerKind: 'human',
      reviewedAt: '2026-08-03T10:00:00.000Z',
      decision: 'include',
      findingCoverage: 'targeted',
      expectedPlanScenarios,
      expectedFindings: [expectedFinding],
      patchedExpectation: 'no-matching-finding',
      staticReviewApplicable: true,
      notes: 'Source-only independent review.',
    },
    {
      reviewer: 'reviewer-two',
      reviewerKind: 'human',
      reviewedAt: '2026-08-03T10:01:00.000Z',
      decision: 'include',
      findingCoverage: 'targeted',
      expectedPlanScenarios,
      expectedFindings: [expectedFinding],
      patchedExpectation: 'no-matching-finding',
      staticReviewApplicable: true,
      notes: 'Source-only independent review.',
    },
  ],
  notes: 'Evaluator-only test key.',
});

const plan = createPlan({
  targetFingerprint: 'a'.repeat(64),
  contextDigest: 'b'.repeat(64),
  targetDisplayName: 'private-case-01',
  inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
  createdAt: '2026-08-03T10:00:00.000Z',
  vectors: [
    {
      title: 'Review query construction',
      rationale: 'Review the source-backed construction boundary.',
      enabled: true,
      scopeGlobs: ['src/query.txt'],
      reviewObligations: [
        {
          obligationId: 'query-risk-01',
          riskStatement: 'Untrusted data might reach a sensitive operation.',
          evidenceRequirement: 'Inspect the operation and its controlling condition.',
        },
      ],
      limitations: [],
    },
    {
      title: 'Review unrelated configuration',
      rationale: 'Review an independently selected configuration concern.',
      enabled: true,
      scopeGlobs: ['config/**'],
      reviewObligations: [
        {
          obligationId: 'config-risk-01',
          riskStatement: 'Configuration might weaken a security boundary.',
          evidenceRequirement: 'Inspect configuration and the affected operation.',
        },
      ],
      limitations: [],
    },
  ],
  additionalObservations: [
    {
      observationId: 'observation-adjacent-01',
      title: 'Review optional operational context',
      rationale: 'The surrounding operational concern is not a declared source-only scenario.',
      scopeGlobs: ['operations/**'],
      reviewObligations: [
        {
          obligationId: 'observation-adjacent-obligation-01',
          riskStatement:
            'A surrounding concern may need human review before it becomes audit work.',
          evidenceRequirement:
            'A human decides whether project evidence supports a new audit vector.',
        },
      ],
      limitations: ['No source-only scenario currently establishes this as executable work.'],
    },
  ],
});

function planVectorId(index: number): string {
  const vector = plan.vectors[index];
  if (vector === undefined) throw new Error('Expected two generated plan vectors.');
  return vector.vectorId;
}

const relevantVectorId = planVectorId(0);
const unrelatedVectorId = planVectorId(1);

function validAdjudication(): PlanSemanticAdjudication {
  return {
    schemaVersion: 5 as const,
    runId: 'provider-eval-01',
    trialId: 'evaluation-trial-01',
    packId: 'private-pack-01',
    packVersion: '0.1.0',
    caseId: 'private-case-01',
    variant: 'vulnerable' as const,
    repetition: 1,
    planId: plan.planId,
    planDigest: plan.planDigest,
    targetFingerprint: plan.targetFingerprint,
    contextDigest: plan.contextDigest,
    answerKeyScenarioDigest: answerKeyScenarioDigest(answerKey),
    reviewerProtocolFingerprint: 'c'.repeat(64),
    reviewerRoute: 'primary' as const,
    reviewer: 'reviewer-three',
    reviewerKind: 'ai-assisted',
    reviewedAt: '2026-08-03T11:00:00.000Z',
    scenarios: [
      {
        scenarioId: 'scenario-query-01',
        outcome: 'covered' as const,
        vectorIds: [relevantVectorId],
      },
    ],
    vectors: [
      {
        vectorId: relevantVectorId,
        outcome: 'relevant' as const,
        scenarioIds: ['scenario-query-01'],
      },
      {
        vectorId: unrelatedVectorId,
        outcome: 'unrelated' as const,
        scenarioIds: [],
      },
    ],
    observations: [
      {
        observationId: 'observation-adjacent-01',
        outcome: 'appropriate' as const,
        scenarioIds: [],
      },
    ],
  };
}

test('rejects model-authored explanatory text from persisted semantic adjudication', () => {
  expect(() =>
    PlanSemanticAdjudicationSchema.parse({
      ...validAdjudication(),
      rationale: 'This must remain in the unpersisted model response.',
    }),
  ).toThrow();
});

const binding = {
  runId: 'provider-eval-01',
  trialId: 'evaluation-trial-01',
  packId: 'private-pack-01',
  packVersion: '0.1.0',
  caseId: 'private-case-01',
  variant: 'vulnerable' as const,
  repetition: 1,
  planId: plan.planId,
  planDigest: plan.planDigest,
  targetFingerprint: plan.targetFingerprint,
  contextDigest: plan.contextDigest,
  answerKeyScenarioDigest: answerKeyScenarioDigest(answerKey),
  reviewerProtocolFingerprint: 'c'.repeat(64),
  reviewerRoute: 'primary' as const,
};

const modelObservation = observeModelStage({
  stage: 'plan-semantic-adjudication',
  route: 'primary',
  stageId: 'plan-semantic-evaluation-test',
  status: 'completed',
  durationMs: 0,
  errorCode: null,
  requests: [],
  pricing: {},
  trace: [],
  cacheRoutingEnabled: false,
});

test('derives semantic plan metrics only from a complete AI-assisted mapping', () => {
  const result = createPlanSemanticEvaluation({
    adjudication: validAdjudication(),
    binding,
    plan,
    answerKey,
    modelObservation,
  });

  expect(result.score).toEqual({
    expectedScenarioCount: 1,
    coveredScenarioCount: 1,
    scenarioRecall: 1,
    enabledVectorCount: 2,
    relevantVectorCount: 1,
    unrelatedVectorCount: 1,
    relevantVectorPrecision: 0.5,
    duplicateRelevantVectorCount: 0,
    additionalObservationCount: 1,
    appropriateObservationCount: 1,
    misplacedObservationCount: 0,
  });
});

test('records source-supported work hidden as an observation without promoting it', () => {
  const hiddenWork = validAdjudication();
  hiddenWork.scenarios = [{ scenarioId: 'scenario-query-01', outcome: 'uncovered', vectorIds: [] }];
  hiddenWork.vectors = hiddenWork.vectors.map((vector) => ({
    ...vector,
    outcome: 'unrelated' as const,
    scenarioIds: [],
  }));
  hiddenWork.observations = [
    {
      observationId: 'observation-adjacent-01',
      outcome: 'misplaced',
      scenarioIds: ['scenario-query-01'],
    },
  ];

  const result = createPlanSemanticEvaluation({
    adjudication: hiddenWork,
    binding,
    plan,
    answerKey,
    modelObservation,
  });

  expect(result.score).toMatchObject({
    scenarioRecall: 0,
    relevantVectorPrecision: 0,
    unrelatedVectorCount: 2,
    additionalObservationCount: 1,
    appropriateObservationCount: 0,
    misplacedObservationCount: 1,
  });
});

test('rejects malformed observation placement mappings', () => {
  const appropriateWithScenario = validAdjudication();
  appropriateWithScenario.observations = [
    {
      observationId: 'observation-adjacent-01',
      outcome: 'appropriate',
      scenarioIds: ['scenario-query-01'],
    },
  ];
  expect(() =>
    createPlanSemanticEvaluation({
      adjudication: appropriateWithScenario,
      binding,
      plan,
      answerKey,
      modelObservation,
    }),
  ).toThrow('appropriate observation none');

  const misplacedCoveredScenario = validAdjudication();
  misplacedCoveredScenario.observations = [
    {
      observationId: 'observation-adjacent-01',
      outcome: 'misplaced',
      scenarioIds: ['scenario-query-01'],
    },
  ];
  expect(() =>
    createPlanSemanticEvaluation({
      adjudication: misplacedCoveredScenario,
      binding,
      plan,
      answerKey,
      modelObservation,
    }),
  ).toThrow('source-only-applicable uncovered scenario');
});

test('rejects stale bindings and asymmetric AI-assisted mappings', () => {
  expect(() =>
    createPlanSemanticEvaluation({
      adjudication: { ...validAdjudication(), planDigest: 'c'.repeat(64) },
      binding,
      plan,
      answerKey,
      modelObservation,
    }),
  ).toThrow('planDigest does not match its trial');

  const asymmetric = validAdjudication();
  const firstVector = asymmetric.vectors[0];
  if (firstVector === undefined) throw new Error('Expected a relevant vector adjudication.');
  asymmetric.vectors[0] = {
    ...firstVector,
    scenarioIds: [],
    outcome: 'unrelated',
  };
  expect(() =>
    createPlanSemanticEvaluation({
      adjudication: asymmetric,
      binding,
      plan,
      answerKey,
      modelObservation,
    }),
  ).toThrow('references must be bidirectional');
});

test('projects only plan and rubric data into the evaluator agent, then binds its output', () => {
  const input = createPlanSemanticModelInput({ plan, answerKey });
  expect(input).toMatchObject({
    planId: plan.planId,
    planDigest: plan.planDigest,
    scenarios: [
      {
        scenarioId: 'scenario-query-01',
        objective: 'Review the source query boundary.',
        requiredRiskCondition: 'Input can alter query semantics.',
      },
    ],
  });
  expect(JSON.stringify(input)).not.toContain('startLine');
  expect(JSON.stringify(input)).not.toContain('targetFingerprint');
  expect(JSON.stringify(input)).not.toContain('expectedFindingIds');
  expect(JSON.stringify(input)).not.toContain('relevantPaths');
  expect(JSON.stringify(input)).not.toContain('answer-key-only-finding-id');
  expect(JSON.stringify(input)).not.toContain('answer-key-only/expected-location.txt');
  const modelScenario = input.scenarios[0];
  if (modelScenario === undefined) throw new Error('Expected one evaluator semantic scenario.');
  expect(
    PlanSemanticModelInputSchema.safeParse({
      ...input,
      scenarios: [
        {
          ...modelScenario,
          relevantPaths: ['answer-key-only/expected-location.txt'],
        },
      ],
    }).success,
  ).toBe(false);
  expect(input.observations).toMatchObject([
    { observationId: 'observation-adjacent-01', title: 'Review optional operational context' },
  ]);

  const adjudication = bindPlanSemanticModelOutput({
    output: {
      scenarios: validAdjudication().scenarios,
      vectors: validAdjudication().vectors,
      observations: validAdjudication().observations,
    },
    binding,
    plan,
    answerKey,
    reviewer: 'plan-semantic-evaluator',
    reviewedAt: '2026-08-03T11:00:00.000Z',
  });
  expect(
    createPlanSemanticEvaluation({ adjudication, binding, plan, answerKey, modelObservation })
      .score,
  ).toMatchObject({
    scenarioRecall: 1,
    relevantVectorPrecision: 0.5,
  });
});

test('binds semantic checkpoint reuse to every evaluator-visible rubric field', () => {
  const withScenarioRubric = (scenario: typeof expectedPlanScenario) =>
    CorpusAnswerKeySchema.parse({
      ...answerKey,
      expectedPlanScenarios: [scenario],
      independentReviews: (answerKey.independentReviews ?? []).map((review) => ({
        ...review,
        expectedPlanScenarios: [scenario],
      })),
    });
  const changedObjective = CorpusAnswerKeySchema.parse({
    ...withScenarioRubric({
      ...expectedPlanScenario,
      objective: 'Review the complete source query boundary.',
    }),
  });
  const changedRequirement = withScenarioRubric({
    ...expectedPlanScenario,
    evidenceRequirements: ['Inspect input origin.', 'Inspect parameter binding.'],
  });

  expect(answerKeyScenarioDigest(changedObjective)).not.toBe(answerKeyScenarioDigest(answerKey));
  expect(answerKeyScenarioDigest(changedRequirement)).not.toBe(answerKeyScenarioDigest(answerKey));

  const changedOnlyAnswerKeyLocation = CorpusAnswerKeySchema.parse({
    ...answerKey,
    expectedPlanScenarios: [
      { ...expectedPlanScenario, relevantPaths: ['answer-key-only/revised-location.txt'] },
    ],
    expectedFindings: [
      {
        ...expectedFinding,
        evidenceRoles: expectedFinding.evidenceRoles.map((role) => ({
          ...role,
          ranges: [{ path: 'answer-key-only/revised-location.txt', startLine: 7, endLine: 7 }],
        })),
      },
    ],
    independentReviews: (answerKey.independentReviews ?? []).map((review) => ({
      ...review,
      expectedPlanScenarios: [
        { ...expectedPlanScenario, relevantPaths: ['answer-key-only/revised-location.txt'] },
      ],
      expectedFindings: [
        {
          ...expectedFinding,
          evidenceRoles: expectedFinding.evidenceRoles.map((role) => ({
            ...role,
            ranges: [{ path: 'answer-key-only/revised-location.txt', startLine: 7, endLine: 7 }],
          })),
        },
      ],
    })),
  });
  expect(answerKeyScenarioDigest(changedOnlyAnswerKeyLocation)).toBe(
    answerKeyScenarioDigest(answerKey),
  );
});
