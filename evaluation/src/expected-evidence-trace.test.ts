import { expect, test } from 'bun:test';
import {
  CorpusAnswerKeySchema,
  type ExpectedEvidenceRoleTrace,
  ExpectedEvidenceRoleTraceSchema,
} from './corpus.schema.js';
import {
  firstIncompleteExpectedEvidenceStage,
  traceDiscoveryEvidence,
} from './expected-evidence-trace.js';

const base = {
  findingId: 'expected-finding-01',
  role: 'operation' as const,
  planScoped: true,
  mapperSelected: true,
  postureReconciled: true,
  discoverySeeded: true,
  groundingSelected: true,
  verifierSelected: true,
  terminalVerifierSelected: true,
  terminalCompleted: true,
};

test('identifies the first missing evaluator-only role stage in fixed workflow order', () => {
  const cases: readonly [keyof typeof base, ExpectedEvidenceRoleTrace['firstIncompleteStage']][] = [
    ['planScoped', 'planning-scope'],
    ['mapperSelected', 'evidence-mapping'],
    ['postureReconciled', 'source-posture'],
    ['discoverySeeded', 'investigation'],
    ['groundingSelected', 'candidate-grounding'],
    ['verifierSelected', 'verification'],
    ['terminalCompleted', 'terminal'],
  ];
  for (const [field, expected] of cases) {
    expect(firstIncompleteExpectedEvidenceStage({ ...base, [field]: false })).toBe(expected);
  }
  expect(firstIncompleteExpectedEvidenceStage(base)).toBe('complete');
});

test('accepts only source-free trace fields', () => {
  expect(
    ExpectedEvidenceRoleTraceSchema.parse({ ...base, firstIncompleteStage: 'complete' }),
  ).toMatchObject({ findingId: 'expected-finding-01', role: 'operation' });
  expect(() =>
    ExpectedEvidenceRoleTraceSchema.parse({
      ...base,
      firstIncompleteStage: 'complete',
      path: 'sensitive-source.ts',
    }),
  ).toThrow();
});

test('counts discovery coverage only when its map basis preserves the expected location', () => {
  const expectedFindings = [
    {
      findingId: 'expected-finding-01',
      staticReviewApplicable: true,
      evidenceRoles: [
        {
          role: 'operation' as const,
          notApplicable: false,
          ranges: [{ path: 'src/reviewed.unknown', startLine: 10, endLine: 10 }],
        },
        {
          role: 'unsafe-condition' as const,
          notApplicable: false,
          ranges: [{ path: 'src/reviewed.unknown', startLine: 11, endLine: 11 }],
        },
      ],
    },
  ];
  const expectedPlanScenarios = [
    {
      scenarioId: 'scenario-001',
      objective: 'Review the bounded operation.',
      sourceOnlyApplicable: true,
      requiredRiskCondition: 'The operation may be unsafe.',
      evidenceRequirements: ['Inspect the operation.'],
      relevantPaths: ['src/reviewed.unknown'],
      expectedFindingIds: ['expected-finding-01'],
    },
  ];
  const answerKey = CorpusAnswerKeySchema.parse({
    schemaVersion: 6,
    caseId: 'case-001',
    findingCoverage: 'targeted',
    expectedPlanScenarios,
    expectedFindings,
    patchedExpectation: 'no-matching-finding',
    staticReviewApplicable: true,
    adjudicationStatus: 'ai-assisted',
    reviewers: ['evaluation-reviewer'],
    independentReviews: [
      {
        reviewer: 'evaluation-reviewer',
        reviewerKind: 'ai-assisted',
        reviewedAt: '2026-08-04T00:00:00.000Z',
        decision: 'include',
        findingCoverage: 'targeted',
        expectedPlanScenarios,
        expectedFindings,
        patchedExpectation: 'no-matching-finding',
        staticReviewApplicable: true,
        notes: 'Focused evaluator-only trace fixture.',
      },
    ],
    notes: 'Focused evaluator-only trace fixture.',
  });
  const evidenceMap = {
    facts: [
      {
        factId: 'operation-fact',
        role: 'operation' as const,
        evidence: [
          {
            path: 'src/reviewed.unknown',
            startLine: 10,
            contentDigest: 'a'.repeat(64),
            kind: 'source' as const,
          },
        ],
        planObligations: [{ obligationId: 'obligation-001' }],
      },
      {
        factId: 'nearby-fact',
        role: 'input' as const,
        evidence: [
          {
            path: 'src/reviewed.unknown',
            startLine: 11,
            contentDigest: 'b'.repeat(64),
            kind: 'source' as const,
          },
        ],
        planObligations: [{ obligationId: 'obligation-001' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  };
  const trace = ExpectedEvidenceRoleTraceSchema.parse({
    ...base,
    discoverySeeded: false,
    groundingSelected: false,
    verifierSelected: false,
    terminalVerifierSelected: false,
    terminalCompleted: false,
    firstIncompleteStage: 'investigation',
  });

  const unrelatedSelection = traceDiscoveryEvidence([trace], answerKey, evidenceMap, [
    'nearby-fact',
  ]);
  expect(unrelatedSelection[0]?.discoverySeeded).toBe(false);

  const matchingSelection = traceDiscoveryEvidence([trace], answerKey, evidenceMap, [
    'operation-fact',
  ]);
  expect(matchingSelection[0]?.discoverySeeded).toBe(true);
});
