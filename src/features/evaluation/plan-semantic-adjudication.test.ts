import { expect, test } from 'bun:test';

import { createPlan } from '../attack-planning/plan.js';

import { CorpusAnswerKeySchema } from './corpus.schema.js';
import {
  answerKeyScenarioDigest,
  createPlanSemanticAdjudicationTemplate,
  createPlanSemanticEvaluation,
} from './plan-semantic-adjudication.js';
import type { PlanSemanticAdjudication } from './plan-semantic-adjudication.schema.js';

const expectedFinding = {
  findingId: 'expected-01',
  staticReviewApplicable: true,
  evidenceRoles: [
    {
      role: 'operation',
      notApplicable: false,
      ranges: [{ path: 'src/query.txt', startLine: 7, endLine: 7 }],
    },
    {
      role: 'unsafe-condition',
      notApplicable: false,
      ranges: [{ path: 'src/query.txt', startLine: 7, endLine: 7 }],
    },
  ],
};

const expectedPlanScenarios = [
  {
    scenarioId: 'scenario-query-01',
    relevantPaths: ['src/query.txt'],
    expectedFindingIds: ['expected-01'],
  },
];

const answerKey = CorpusAnswerKeySchema.parse({
  schemaVersion: 5,
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
    schemaVersion: 1 as const,
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
    reviewer: 'reviewer-three',
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
  };
}

const binding = {
  runId: 'provider-eval-01',
  trialId: 'evaluation-trial-01',
  packId: 'private-pack-01',
  packVersion: '0.1.0',
  caseId: 'private-case-01',
  variant: 'vulnerable' as const,
  repetition: 1,
};

test('derives semantic plan metrics only from a complete human mapping', () => {
  const result = createPlanSemanticEvaluation({
    adjudication: validAdjudication(),
    binding,
    plan,
    answerKey,
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
  });
});

test('creates an intentionally unscoreable source-free human review template', () => {
  const template = createPlanSemanticAdjudicationTemplate({ binding, plan, answerKey });

  expect(template).toMatchObject({
    reviewer: null,
    reviewedAt: null,
    scenarios: [{ scenarioId: 'scenario-query-01', outcome: null, vectorIds: [] }],
  });
  expect(template.vectors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ vectorId: relevantVectorId, outcome: null, scenarioIds: [] }),
      expect.objectContaining({ vectorId: unrelatedVectorId, outcome: null, scenarioIds: [] }),
    ]),
  );
});

test('rejects stale bindings and asymmetric human mappings', () => {
  expect(() =>
    createPlanSemanticEvaluation({
      adjudication: { ...validAdjudication(), planDigest: 'c'.repeat(64) },
      binding,
      plan,
      answerKey,
    }),
  ).toThrow('does not match the exact generated plan');

  const asymmetric = validAdjudication();
  const firstVector = asymmetric.vectors[0];
  if (firstVector === undefined) throw new Error('Expected a relevant vector adjudication.');
  asymmetric.vectors[0] = {
    ...firstVector,
    scenarioIds: [],
    outcome: 'unrelated',
  };
  expect(() =>
    createPlanSemanticEvaluation({ adjudication: asymmetric, binding, plan, answerKey }),
  ).toThrow('references must be bidirectional');
});
