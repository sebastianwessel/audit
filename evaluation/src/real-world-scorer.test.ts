import { expect, test } from 'bun:test';

import { createPlan as createDraftPlan } from '../../src/features/attack-planning/plan.js';
import {
  type ClaimEvidenceItem,
  claimEvidenceItems,
} from '../../src/features/attack-planning/plan.schema.js';
import type { Finding } from '../../src/features/audit-execution/audit.schema.js';
import { createFindingId } from '../../src/features/audit-execution/synthesis/identity.js';
import {
  CorpusAnswerKeySchema,
  type EvaluationTrial,
  FindingScoreSchema,
} from './corpus.schema.js';
import {
  normalizedFindingKeys,
  normalizedPlanKeys,
  scoreFindings,
  scorePathReachability,
  summarizeReliability,
  terminalFindingEvidenceMatches,
} from './real-world-scorer.js';

const disabledModelCostCeilingState = {
  configuredUsd: null,
  accumulatedEstimatedCostUsd: null,
  reached: false,
} as const;

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
    objective: 'Review request-derived input at the query boundary.',
    sourceOnlyApplicable: true,
    requiredRiskCondition: 'Request-controlled input can alter query semantics.',
    evidenceRequirements: ['Inspect input origin.', 'Inspect query construction.'],
    relevantPaths: ['src/query.ts'],
    expectedFindingIds: ['expected-01'],
  },
];

const answerKey = CorpusAnswerKeySchema.parse({
  schemaVersion: 6,
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
  status: 'accepted',
  narrative: {
    statement: 'The reviewed operation may be reached with an unsafe condition.',
    roleExplanations: [
      { role: 'operation', explanation: 'The operation evidence identifies the action.' },
      {
        role: 'unsafe-condition',
        explanation: 'The condition evidence identifies the unsafe state.',
      },
    ],
    limitations: [],
  },
  claimEvidenceBundles: claimBundles(
    [
      {
        path: 'src/query.ts',
        startLine: 7,
        endLine: 7,
        contentDigest: 'a'.repeat(64),
        kind: 'source',
      },
    ],
    [
      {
        path: 'src/query.ts',
        startLine: 7,
        endLine: 7,
        contentDigest: 'a'.repeat(64),
        kind: 'source',
      },
    ],
  ),
  planObligations: firstPlanVector.reviewObligations.map(({ obligationId }) => ({ obligationId })),
  verification: {
    status: 'verified',
    checks: ['approved-obligation', 'scope', 'source-path', 'line-range', 'source-content-digest'],
  },
};

function claimBundles(
  operation: readonly Omit<ClaimEvidenceItem, 'role'>[],
  unsafeCondition: readonly Omit<ClaimEvidenceItem, 'role'>[],
) {
  return [
    {
      role: 'operation' as const,
      evidence: operation.map((evidence) => ({ ...evidence, role: 'operation' as const })),
    },
    {
      role: 'unsafe-condition' as const,
      evidence: unsafeCondition.map((evidence) => ({
        ...evidence,
        role: 'unsafe-condition' as const,
      })),
    },
  ];
}

function withClaimBundles(
  source: Finding,
  operation: readonly Omit<ClaimEvidenceItem, 'role'>[],
  unsafeCondition: readonly Omit<ClaimEvidenceItem, 'role'>[],
): Finding {
  return { ...source, claimEvidenceBundles: claimBundles(operation, unsafeCondition) };
}

test('scores planning and findings independently for a vulnerable/patched pair', () => {
  expect(scorePathReachability(answerKey, plan)).toMatchObject({
    pathReachableScenarioCount: 1,
    relevantPathCoverage: 1,
    enabledVectorCount: 1,
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
        objective: 'Review the second query boundary.',
        sourceOnlyApplicable: true,
        requiredRiskCondition: 'Request-controlled input can alter another query.',
        evidenceRequirements: ['Inspect second input.', 'Inspect second query construction.'],
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
  const score = scorePathReachability(twoScenarios, plan);
  expect(score).toMatchObject({
    eligibleScenarioCount: 2,
    pathReachableScenarioCount: 2,
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
  expect(scorePathReachability(notApplicable, plan)).toMatchObject({
    eligibleScenarioCount: 0,
    pathReachableScenarioCount: 0,
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
  const fixtureEvidence = claimEvidenceItems(finding)[0];
  if (fixtureEvidence === undefined) {
    throw new Error('The fixture requires source evidence.');
  }
  const orderedFinding = withClaimBundles(
    finding,
    [{ ...fixtureEvidence, startLine: 7 }],
    [{ ...fixtureEvidence, startLine: 2 }],
  );
  const score = scoreFindings(answerKey, plan, [orderedFinding], 'vulnerable');
  expect(score.truePositives).toBe(1);
  expect(normalizedFindingKeys([orderedFinding], plan)).toContain(createFindingId(orderedFinding));
});

test('keeps unmatched targeted findings visible without calling them false positives', () => {
  const unmatched = withClaimBundles(
    finding,
    [
      {
        path: 'src/query.ts',
        startLine: 3,
        endLine: 3,
        contentDigest: 'a'.repeat(64),
        kind: 'source',
      },
    ],
    [
      {
        path: 'src/query.ts',
        startLine: 3,
        endLine: 3,
        contentDigest: 'a'.repeat(64),
        kind: 'source',
      },
    ],
  );
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
        objective: 'Review the second query boundary.',
        sourceOnlyApplicable: true,
        requiredRiskCondition: 'Request-controlled input can alter another query.',
        evidenceRequirements: ['Inspect second input.', 'Inspect second query construction.'],
        relevantPaths: ['src/query.ts'],
        expectedFindingIds: ['expected-02'],
      },
    ],
    expectedFindings: [expectedFinding, secondExpected],
    adjudicationStatus: 'provisional',
    reviewers: ['reviewer-one'],
    independentReviews: undefined,
  });
  const operation = finding.claimEvidenceBundles[0]?.evidence[0];
  const unsafeCondition = finding.claimEvidenceBundles[1]?.evidence[0];
  if (operation === undefined || unsafeCondition === undefined) {
    throw new Error('The fixture requires two evidence roles.');
  }
  const overlapping = {
    ...withClaimBundles(
      finding,
      [
        { ...operation, startLine: 7, endLine: 7 },
        { ...operation, startLine: 8, endLine: 8 },
      ],
      [
        { ...unsafeCondition, startLine: 7, endLine: 7 },
        { ...unsafeCondition, startLine: 8, endLine: 8 },
      ],
    ),
    findingId: 'finding-overlapping',
  };
  const firstOnly = {
    ...withClaimBundles(
      finding,
      [{ ...operation, startLine: 7, endLine: 7 }],
      [{ ...unsafeCondition, startLine: 7, endLine: 7 }],
    ),
    findingId: 'finding-first-only',
  };
  const score = scoreFindings(twoExpected, plan, [overlapping, firstOnly], 'vulnerable');
  expect(score.truePositives).toBe(2);
  expect(score.falseNegatives).toBe(0);
});

test('does not count partial role evidence as a fully evidenced expected finding', () => {
  const firstEvidence = finding.claimEvidenceBundles[0]?.evidence[0];
  if (firstEvidence === undefined) throw new Error('The fixture requires operation evidence.');
  const mislocalized = withClaimBundles(
    finding,
    [{ ...firstEvidence, startLine: 7, endLine: 7 }],
    [{ ...firstEvidence, startLine: 3, endLine: 3 }],
  );
  expect(scoreFindings(answerKey, plan, [mislocalized], 'vulnerable')).toMatchObject({
    truePositives: 0,
    falseNegatives: 1,
    findingRecall: 0,
    matchedLocalizedCount: 0,
    matchedMislocalizedCount: 1,
    localizationAccuracy: 0,
    matchedExpectedFindingIds: [],
  });
});

test('projects an incomplete terminal role match once for scoring and trace consumers', () => {
  const firstEvidence = finding.claimEvidenceBundles[0]?.evidence[0];
  if (firstEvidence === undefined) throw new Error('The fixture requires operation evidence.');
  const partial = withClaimBundles(
    finding,
    [{ ...firstEvidence, startLine: 7, endLine: 7 }],
    [{ ...firstEvidence, startLine: 3, endLine: 3 }],
  );
  expect(terminalFindingEvidenceMatches(answerKey, [partial])).toEqual([
    {
      expectedFindingId: 'expected-01',
      terminalFindingId: partial.findingId,
      roleSelections: [
        { role: 'operation', selected: true },
        { role: 'unsafe-condition', selected: false },
      ],
    },
  ]);
});

test('does not treat partial patched role overlap as a patched matching finding', () => {
  const firstEvidence = finding.claimEvidenceBundles[0]?.evidence[0];
  if (firstEvidence === undefined) throw new Error('The fixture requires operation evidence.');
  const partial = withClaimBundles(
    finding,
    [{ ...firstEvidence, startLine: 7, endLine: 7 }],
    [{ ...firstEvidence, startLine: 3, endLine: 3 }],
  );
  expect(scoreFindings(answerKey, plan, [partial], 'patched')).toMatchObject({
    patchedMatchingFindingCount: 0,
    falsePositives: 0,
    unmatchedUnadjudicatedCount: 1,
  });
});

test('counts a fully localized patched finding as the matching patched false positive', () => {
  expect(scoreFindings(answerKey, plan, [finding], 'patched')).toMatchObject({
    patchedMatchingFindingCount: 1,
    falsePositives: 1,
    unmatchedUnadjudicatedCount: 0,
  });
});

test('changes plan stability when an executable review obligation changes', () => {
  const changedPlan = approvePlan(
    createDraftPlan({
      targetFingerprint: plan.targetFingerprint,
      contextDigest: plan.contextDigest,
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
              obligationId: 'changed-obligation-01',
              riskStatement: 'Untrusted input could alter another sensitive operation.',
              evidenceRequirement:
                'Inspect source evidence for input handling and the other operation.',
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
  expect(normalizedPlanKeys(changedPlan)).not.toEqual(normalizedPlanKeys(plan));
});

test('does not match a finding solely because an expected role is not applicable', () => {
  const roleNotApplicable = CorpusAnswerKeySchema.parse({
    ...answerKey,
    expectedFindings: [
      {
        ...expectedFinding,
        evidenceRoles: [
          expectedFinding.evidenceRoles[0],
          { role: 'unsafe-condition', notApplicable: true, ranges: [] },
        ],
      },
    ],
    adjudicationStatus: 'provisional',
    reviewers: ['reviewer-one'],
    independentReviews: undefined,
  });
  const unrelatedFinding = withClaimBundles(
    finding,
    [
      {
        path: 'src/query.ts',
        startLine: 99,
        endLine: 99,
        contentDigest: 'a'.repeat(64),
        kind: 'source',
      },
    ],
    [
      {
        path: 'src/query.ts',
        startLine: 99,
        endLine: 99,
        contentDigest: 'a'.repeat(64),
        kind: 'source',
      },
    ],
  );

  expect(scoreFindings(roleNotApplicable, plan, [unrelatedFinding], 'vulnerable')).toMatchObject({
    truePositives: 0,
    falseNegatives: 1,
    unmatchedUnadjudicatedCount: 1,
  });
});

test('rejects an impossible fully-evidenced score with an unaccounted mislocalized match', () => {
  expect(() =>
    FindingScoreSchema.parse({
      ...scoreFindings(answerKey, plan, [finding], 'vulnerable'),
      matchedLocalizedCount: 0,
      matchedMislocalizedCount: 1,
    }),
  ).toThrow('True positives must equal fully localized expected-finding matches');
});

test('keeps the expected-finding identity after inapplicable findings are filtered', () => {
  const filteredIdentityKey = CorpusAnswerKeySchema.parse({
    ...answerKey,
    expectedFindings: [
      {
        ...expectedFinding,
        findingId: 'not-applicable-first',
        staticReviewApplicable: false,
        evidenceRoles: expectedFinding.evidenceRoles.map((role) => ({
          ...role,
          ranges: [{ path: 'src/query.ts', startLine: 99, endLine: 99 }],
        })),
      },
      expectedFinding,
    ],
    adjudicationStatus: 'provisional',
    reviewers: ['reviewer-one'],
    independentReviews: undefined,
  });

  expect(scoreFindings(filteredIdentityKey, plan, [finding], 'vulnerable')).toMatchObject({
    truePositives: 1,
    matchedLocalizedCount: 1,
    matchedMislocalizedCount: 0,
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
      pathReachability: scorePathReachability(answerKey, plan),
      findingScore: scoreFindings(answerKey, plan, [finding], 'vulnerable'),
      planKeys: ['injection\0src/**'],
      findingKeys: ['injection\0high\0src/query.ts\0line7'],
      durationMs: 10,
      errorCode: null,
      modelCostCeilingState: disabledModelCostCeilingState,
    },
    {
      caseId: 'real-js-001',
      variant: 'vulnerable',
      repetition: 2,
      status: 'completed',
      reviewedPlanFingerprint: null,
      pathReachability: scorePathReachability(answerKey, plan),
      findingScore: scoreFindings(answerKey, plan, [finding], 'vulnerable'),
      planKeys: ['injection\0src/**'],
      findingKeys: ['injection\0high\0src/query.ts\0line7'],
      durationMs: 30,
      errorCode: null,
      modelCostCeilingState: disabledModelCostCeilingState,
    },
    {
      caseId: 'real-js-001',
      variant: 'vulnerable',
      repetition: 3,
      status: 'failed',
      reviewedPlanFingerprint: null,
      pathReachability: null,
      findingScore: null,
      planKeys: [],
      findingKeys: [],
      durationMs: 50,
      errorCode: 'provider-failure',
      modelCostCeilingState: disabledModelCostCeilingState,
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
    allTerminalDurationMsP95: 50,
    completedDurationMsP95: 30,
  });
});

test('does not treat different cases as repeated outputs when measuring agreement', () => {
  const first: EvaluationTrial = {
    caseId: 'real-js-001',
    variant: 'vulnerable',
    repetition: 1,
    status: 'completed',
    reviewedPlanFingerprint: null,
    pathReachability: scorePathReachability(answerKey, plan),
    findingScore: scoreFindings(answerKey, plan, [finding], 'vulnerable'),
    planKeys: ['injection\0src/**'],
    findingKeys: ['injection\0high\0src/query.ts\0line7'],
    durationMs: 10,
    errorCode: null,
    modelCostCeilingState: disabledModelCostCeilingState,
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
