import { expect, test } from 'bun:test';

import { createPlan as createDraftPlan } from '../attack-planning/plan.js';
import type { Finding } from '../audit-execution/audit.schema.js';
import { CorpusAnswerKeySchema, type EvaluationTrial } from './corpus.schema.js';
import {
  normalizedFindingKeys,
  scoreFindings,
  scorePlan,
  summarizeReliability,
} from './real-world-scorer.js';

const approvePlan = <T>(plan: T, ..._reviewMetadata: readonly [string, string, string]): T => plan;

const expectedFinding = {
  findingId: 'expected-01',
  staticReviewApplicable: true,
  evidenceRoles: [
    {
      role: 'operation',
      notApplicable: false,
      ranges: [{ path: 'src/query.ts', startLine: 7, endLine: 7 }],
    },
    {
      role: 'unsafe-condition',
      notApplicable: false,
      ranges: [{ path: 'src/query.ts', startLine: 7, endLine: 7 }],
    },
  ],
};

const expectedPlanScenarios = [
  {
    scenarioId: 'scenario-injection-01',
    relevantPaths: ['src/query.ts'],
    expectedFindingIds: ['expected-01'],
  },
];

const answerKey = CorpusAnswerKeySchema.parse({
  schemaVersion: 5,
  caseId: 'real-js-001',
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
      reviewedAt: '2026-07-27T11:00:00.000Z',
      decision: 'include',
      findingCoverage: 'targeted',
      expectedPlanScenarios,
      expectedFindings: [expectedFinding],
      patchedExpectation: 'no-matching-finding',
      staticReviewApplicable: true,
      notes: 'Independent source-only review supports inclusion.',
    },
    {
      reviewer: 'reviewer-two',
      reviewerKind: 'human',
      reviewedAt: '2026-07-27T11:30:00.000Z',
      decision: 'include',
      findingCoverage: 'targeted',
      expectedPlanScenarios,
      expectedFindings: [expectedFinding],
      patchedExpectation: 'no-matching-finding',
      staticReviewApplicable: true,
      notes: 'Independent source-only review supports inclusion.',
    },
  ],
  notes: 'A real-world-style paired source fixture.',
});

const plan = approvePlan(
  createDraftPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    createdAt: '2026-07-27T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: ['typescript'] },
    vectors: [
      {
        title: 'Review injection',
        rationale: 'Input reaches a query.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'scorer-obligation-01',
            riskStatement: 'Untrusted input could change query semantics.',
            evidenceRequirement:
              'Inspect source evidence for input handling and query construction.',
          },
        ],
        limitations: [],
      },
    ],
  }),
  'fixture-reviewer',
  'Approved for evaluator test.',
  '2026-07-27T12:00:00.000Z',
);

const firstPlanVector = plan.vectors.at(0);
if (firstPlanVector === undefined) {
  throw new Error('The fixture requires one approved vector.');
}

const finding: Finding = {
  findingId: 'finding-real-js-001',
  vectorId: firstPlanVector.vectorId,
  statement: 'Unsafe query',
  status: 'accepted',
  evidence: [
    {
      path: 'src/query.ts',
      startLine: 7,
      endLine: 7,
      snippet: `SELECT \${input}`,
      kind: 'source',
      role: 'operation',
    },
    {
      path: 'src/query.ts',
      startLine: 7,
      endLine: 7,
      snippet: `SELECT \${input}`,
      kind: 'source',
      role: 'unsafe-condition',
    },
  ],
  planObligations: firstPlanVector.reviewObligations.map(({ obligationId }) => ({ obligationId })),
  limitations: [],
  verification: {
    status: 'verified',
    reason: 'Fixture source evidence is valid.',
    checks: ['approved-obligation', 'scope', 'source-path', 'line-range', 'source-snippet'],
  },
};

test('scores planning and findings independently for a vulnerable/patched pair', () => {
  expect(scorePlan(answerKey, plan)).toMatchObject({
    scopedScenarioCount: 1,
    relevantPathCoverage: 1,
    generatedVectorCount: 1,
  });
  expect(scoreFindings(answerKey, plan, [finding], 'vulnerable')).toMatchObject({
    findingRecall: 1,
    falsePositives: 0,
  });
  expect(scoreFindings(answerKey, plan, [finding], 'patched')).toMatchObject({
    falsePositives: 1,
    pairedPersistence: 1,
  });
});

test('reports path scope coverage without claiming semantic plan equivalence', () => {
  const twoScenarios = CorpusAnswerKeySchema.parse({
    ...answerKey,
    expectedPlanScenarios: [
      ...expectedPlanScenarios,
      {
        scenarioId: 'scenario-injection-02',
        relevantPaths: ['src/other-query.ts'],
        expectedFindingIds: ['expected-02'],
      },
    ],
    expectedFindings: [
      expectedFinding,
      {
        ...expectedFinding,
        findingId: 'expected-02',
        evidenceRoles: expectedFinding.evidenceRoles.map((role) => ({
          ...role,
          ranges: [{ path: 'src/other-query.ts', startLine: 1, endLine: 1 }],
        })),
      },
    ],
    adjudicationStatus: 'provisional',
    reviewers: ['reviewer-one'],
    independentReviews: undefined,
  });
  const score = scorePlan(twoScenarios, plan);
  expect(score).toMatchObject({
    expectedScenarioCount: 2,
    scopedScenarioCount: 2,
    relevantPathCoverage: 1,
  });
});

test('excludes static-review-inapplicable scenarios and findings from audit metrics', () => {
  const { independentReviews: _independentReviews, ...singleReviewed } = answerKey;
  const notApplicable = CorpusAnswerKeySchema.parse({
    ...singleReviewed,
    staticReviewApplicable: false,
    expectedFindings: [{ ...expectedFinding, staticReviewApplicable: false }],
    adjudicationStatus: 'provisional',
    reviewers: ['reviewer-one'],
  });
  expect(scorePlan(notApplicable, plan)).toMatchObject({
    expectedScenarioCount: 0,
    scopedScenarioCount: 0,
    notApplicableScenarioCount: 1,
    relevantPathCoverage: null,
  });
  expect(scoreFindings(notApplicable, plan, [finding], 'vulnerable')).toMatchObject({
    truePositives: 0,
    falseNegatives: 0,
    findingRecall: null,
    notApplicableExpectedFindingCount: 1,
    unmatchedUnadjudicatedCount: 0,
  });
});

test('scores a finding using its declared operation evidence rather than model array order', () => {
  const fixtureEvidence = finding.evidence[0];
  if (fixtureEvidence === undefined) {
    throw new Error('The fixture requires source evidence.');
  }
  const orderedFinding = {
    ...finding,
    evidence: [
      { ...fixtureEvidence, startLine: 2, role: 'unsafe-condition' as const },
      { ...fixtureEvidence, startLine: 7, role: 'operation' as const },
    ],
  };
  const score = scoreFindings(answerKey, plan, [orderedFinding], 'vulnerable');
  expect(score.truePositives).toBe(1);
  expect(normalizedFindingKeys([orderedFinding], plan)).toContain(
    `${firstPlanVector.vectorId}\0src/query.ts\0${String(7)}`,
  );
});

test('keeps unmatched targeted findings visible without calling them false positives', () => {
  const unmatched = {
    ...finding,
    evidence: finding.evidence.map((evidence) => ({ ...evidence, startLine: 3, endLine: 3 })),
  };
  expect(scoreFindings(answerKey, plan, [unmatched], 'vulnerable')).toMatchObject({
    falsePositives: 0,
    findingPrecision: null,
    findingF1: null,
    unmatchedUnadjudicatedCount: 1,
    unmatchedAdjudicatedFalsePositiveCount: 0,
  });
  const { independentReviews: _independentReviews, ...singleReviewed } = answerKey;
  const exhaustive = CorpusAnswerKeySchema.parse({
    ...singleReviewed,
    findingCoverage: 'exhaustive',
    adjudicationStatus: 'provisional',
    reviewers: ['reviewer-one'],
  });
  expect(scoreFindings(exhaustive, plan, [unmatched], 'vulnerable')).toMatchObject({
    falsePositives: 1,
    unmatchedUnadjudicatedCount: 0,
    unmatchedAdjudicatedFalsePositiveCount: 1,
  });
});

test('uses maximum matching so an overlapping early result cannot hide an expected finding', () => {
  const secondExpected = {
    ...expectedFinding,
    findingId: 'expected-02',
    evidenceRoles: [
      {
        role: 'operation' as const,
        notApplicable: false,
        ranges: [{ path: 'src/query.ts', startLine: 8, endLine: 8 }],
      },
      {
        role: 'unsafe-condition' as const,
        notApplicable: false,
        ranges: [{ path: 'src/query.ts', startLine: 8, endLine: 8 }],
      },
    ],
  };
  const twoExpected = CorpusAnswerKeySchema.parse({
    ...answerKey,
    expectedPlanScenarios: [
      ...expectedPlanScenarios,
      {
        scenarioId: 'scenario-injection-02',
        relevantPaths: ['src/query.ts'],
        expectedFindingIds: ['expected-02'],
      },
    ],
    expectedFindings: [expectedFinding, secondExpected],
    adjudicationStatus: 'provisional',
    reviewers: ['reviewer-one'],
    independentReviews: undefined,
  });
  const operation = finding.evidence[0];
  const unsafeCondition = finding.evidence[1];
  if (operation === undefined || unsafeCondition === undefined) {
    throw new Error('The fixture requires two evidence roles.');
  }
  const overlapping = {
    ...finding,
    findingId: 'finding-overlapping',
    evidence: [
      { ...operation, startLine: 7, endLine: 7, role: 'operation' as const },
      { ...unsafeCondition, startLine: 7, endLine: 7, role: 'unsafe-condition' as const },
      { ...operation, startLine: 8, endLine: 8, role: 'operation' as const },
      { ...unsafeCondition, startLine: 8, endLine: 8, role: 'unsafe-condition' as const },
    ],
  };
  const firstOnly = {
    ...finding,
    findingId: 'finding-first-only',
    evidence: [
      { ...operation, startLine: 7, endLine: 7, role: 'operation' as const },
      { ...unsafeCondition, startLine: 7, endLine: 7, role: 'unsafe-condition' as const },
    ],
  };
  const score = scoreFindings(twoExpected, plan, [overlapping, firstOnly], 'vulnerable');
  expect(score.truePositives).toBe(2);
  expect(score.falseNegatives).toBe(0);
});

test('counts issue detection separately from complete role localization', () => {
  const firstEvidence = finding.evidence[0];
  if (firstEvidence === undefined) throw new Error('The fixture requires operation evidence.');
  const operationOnly = {
    ...finding,
    evidence: [{ ...firstEvidence, role: 'operation' as const }],
  };
  expect(scoreFindings(answerKey, plan, [operationOnly], 'vulnerable')).toMatchObject({
    truePositives: 1,
    matchedLocalizedCount: 0,
    matchedMislocalizedCount: 1,
    localizationAccuracy: 0,
  });
});

test('summarizes repeated trial agreement and latency without hiding failed trials', () => {
  const trials: EvaluationTrial[] = [
    {
      caseId: 'real-js-001',
      variant: 'vulnerable',
      repetition: 1,
      status: 'completed',
      reviewedPlanFingerprint: null,
      planScore: scorePlan(answerKey, plan),
      findingScore: scoreFindings(answerKey, plan, [finding], 'vulnerable'),
      planKeys: ['injection\0src/**'],
      findingKeys: ['injection\0high\0src/query.ts\0line7'],
      durationMs: 10,
      errorCode: null,
    },
    {
      caseId: 'real-js-001',
      variant: 'vulnerable',
      repetition: 2,
      status: 'completed',
      reviewedPlanFingerprint: null,
      planScore: scorePlan(answerKey, plan),
      findingScore: scoreFindings(answerKey, plan, [finding], 'vulnerable'),
      planKeys: ['injection\0src/**'],
      findingKeys: ['injection\0high\0src/query.ts\0line7'],
      durationMs: 30,
      errorCode: null,
    },
    {
      caseId: 'real-js-001',
      variant: 'vulnerable',
      repetition: 3,
      status: 'failed',
      reviewedPlanFingerprint: null,
      planScore: null,
      findingScore: null,
      planKeys: [],
      findingKeys: [],
      durationMs: 5,
      errorCode: 'provider-failure',
    },
  ];
  expect(summarizeReliability(trials)).toMatchObject({
    completedTrials: 2,
    incompleteTrials: 0,
    failedTrials: 1,
    cancelledTrials: 0,
    completionRate: 2 / 3,
    planJaccard: 1,
    findingJaccard: 1,
    findingRecallMedian: 1,
    durationMsP95: 30,
  });
});

test('does not treat different cases as repeated outputs when measuring agreement', () => {
  const first: EvaluationTrial = {
    caseId: 'real-js-001',
    variant: 'vulnerable',
    repetition: 1,
    status: 'completed',
    reviewedPlanFingerprint: null,
    planScore: scorePlan(answerKey, plan),
    findingScore: scoreFindings(answerKey, plan, [finding], 'vulnerable'),
    planKeys: ['injection\0src/**'],
    findingKeys: ['injection\0high\0src/query.ts\0line7'],
    durationMs: 10,
    errorCode: null,
  };
  const second: EvaluationTrial = {
    ...first,
    caseId: 'real-java-002',
    planKeys: ['other\0**/*'],
    findingKeys: ['other\0high\0Example.java\0line20'],
  };
  expect(summarizeReliability([first, second])).toMatchObject({
    planJaccard: null,
    findingJaccard: null,
  });
});
