import { expect, test } from 'bun:test';
import { FakeModelProvider } from '@purista/harness/testing';
import { verifyModelFindings } from '../../features/audit-execution/investigation/verify.js';
import {
  createAuditHarness,
  EffectivelyUnboundedHarnessAgentIterations,
  HarnessExecutionConfigurationSchema,
  harnessProviderRetry,
  type ReviewToolset,
} from './audit-harness.js';

const targetFingerprint = 'a'.repeat(64);
const contextDigest = 'b'.repeat(64);

function queryClaimEvidenceBundles() {
  return [
    {
      role: 'operation' as const,
      evidence: [
        {
          path: 'src/query.ts',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source' as const,
          role: 'operation' as const,
        },
      ],
    },
    {
      role: 'unsafe-condition' as const,
      evidence: [
        {
          path: 'src/query.ts',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source' as const,
          role: 'unsafe-condition' as const,
        },
      ],
    },
  ];
}

function harnessNarrative() {
  return {
    statement: 'The reviewed operation may be reached with an unsafe condition.',
    roleExplanations: [
      { role: 'operation' as const, explanation: 'The operation evidence identifies the action.' },
      {
        role: 'unsafe-condition' as const,
        explanation: 'The condition evidence identifies the unsafe state.',
      },
    ],
    limitations: [],
  };
}

const toolset: ReviewToolset = {
  listFiles: async () => ({
    entries: [{ path: 'src/query.ts', sizeBytes: 42, languageHint: 'typescript' }],
  }),
  readFile: async () => ({
    path: 'src/query.ts',
    startLine: 1,
    endLine: 1,
    lines: [
      {
        line: 1,
        text: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
      },
    ],
  }),
  grepFiles: async () => ({ matches: [] }),
};

test('uses the deterministic Purista provider to create a strict draft plan', async () => {
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Review query injection',
          rationale: 'Queries may interpolate input.',
          enabled: true,
          scopeGlobs: ['src/**'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'Data could change query semantics.',
              evidenceRequirement: 'Inspect source evidence for query construction.',
            },
          ],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const harness = createAuditHarness(provider, toolset);
  const session = await harness.getSession('test-plan-01');
  try {
    const plan = await session.workflows.create_plan.prompt({
      targetFingerprint,
      contextDigest,
      targetDisplayName: 'fixture',
      inventorySummary: { fileCount: 1, totalBytes: 42, languageHints: ['typescript'] },
      sourcePaths: ['src/query.ts'],
      context: [],
      createdAt: '2026-07-27T12:00:00.000Z',
    });
    expect(plan.planId).toStartWith('plan-');
    expect(plan.vectors[0]?.title).toBe('Review query injection');
    expect(provider.requests).toHaveLength(1);
  } finally {
    await session.close();
    await harness.shutdown();
  }
});

test('uses an effectively unbounded iteration setting rather than a hidden Harness default', async () => {
  expect(EffectivelyUnboundedHarnessAgentIterations).toBe(Number.MAX_SAFE_INTEGER);
  expect(Number.isSafeInteger(EffectivelyUnboundedHarnessAgentIterations)).toBeTrue();

  const provider = new FakeModelProvider();
  for (let index = 0; index < 65; index += 1) {
    provider.enqueueObject({
      object: {},
      toolCalls: [
        {
          id: `tool-round-${index + 1}`,
          name: 'repo_grep',
          arguments: { pattern: 'query', mode: 'literal', caseSensitive: true },
        },
      ],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'tool_calls',
    });
  }
  provider.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Review query injection',
          rationale: 'Queries may interpolate input.',
          enabled: true,
          scopeGlobs: ['src/**'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'Data could change query semantics.',
              evidenceRequirement: 'Inspect source evidence for query construction.',
            },
          ],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const harness = createAuditHarness(provider, toolset);
  const session = await harness.getSession('test-plan-over-64-rounds');
  try {
    const plan = await session.workflows.create_plan.prompt({
      targetFingerprint,
      contextDigest,
      targetDisplayName: 'fixture',
      inventorySummary: { fileCount: 1, totalBytes: 42, languageHints: ['typescript'] },
      sourcePaths: ['src/query.ts'],
      context: [],
      createdAt: '2026-07-27T12:00:00.000Z',
    });
    expect(plan.vectors).toHaveLength(1);
    expect(provider.requests).toHaveLength(66);
  } finally {
    await session.close();
    await harness.shutdown();
  }
});

test('rejects an execution budget whose run deadline is shorter than its model deadline', () => {
  expect(() =>
    HarnessExecutionConfigurationSchema.parse({
      modelTimeoutMs: 30_000,
      runTimeoutMs: 20_000,
      modelRetry: 'disabled',
    }),
  ).toThrow('runTimeoutMs must be at least modelTimeoutMs');
});

test('has no default execution deadline and accepts an explicit long operational deadline', () => {
  expect(HarnessExecutionConfigurationSchema.parse({})).toMatchObject({
    modelTimeoutMs: 0,
    runTimeoutMs: 0,
  });
  expect(
    HarnessExecutionConfigurationSchema.parse({
      modelTimeoutMs: 3_600_000,
      runTimeoutMs: 7_200_000,
    }),
  ).toMatchObject({ modelTimeoutMs: 3_600_000, runTimeoutMs: 7_200_000 });
});

test('keeps provider calls one-shot because the scoped lifecycle owns retry', () => {
  expect(harnessProviderRetry('default')).toBeTrue();
  expect(harnessProviderRetry('disabled')).toBeFalse();
});

test('mounts an independently owned scoped verifier agent', async () => {
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      result: {
        decision: 'ACCEPTED',
        reasonCode: 'CLAIM-SUPPORTED',
        reason: 'The cited source line supports the stated risk.',
        claimEvidenceBundles: [
          {
            role: 'operation',
            selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
            explanation: 'The query operation is selected from the evidence map.',
          },
          {
            role: 'unsafe-condition',
            selections: [{ factId: 'fact-query-01', evidenceIndex: 1 }],
            explanation: 'The unsafe condition is selected from the evidence map.',
          },
        ],
        controlAssessment: {
          conclusion: 'no-effective-control-found',
          explanation: 'No scoped control negates this hypothesis.',
          evidenceSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
        },
        obligationReconciliations: [
          {
            planObligation: { obligationId: 'harness-obligation-01' },
            disposition: 'supports-claim',
            explanation: 'The scoped source supports this approved obligation.',
            evidenceSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
          },
        ],
        postureReconciliations: [
          {
            assessmentId: 'posture-harness-obligation-01',
            disposition: 'supports-claim',
            explanation: 'The posture aligns with the scoped source inspection.',
            evidenceSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
          },
        ],
      },
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const harness = createAuditHarness(provider, toolset);
  const session = await harness.getSession('test-verifier-01');
  try {
    const result = await session.workflows.verify_hypothesis.prompt({
      verificationId: 'verification-01',
      vector: {
        vectorId: 'vector-injection-01',
        vectorDigest: 'a'.repeat(64),
        title: 'Review injection',
        rationale: 'Review query construction.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'harness-obligation-01',
            riskStatement: 'Source could support the reviewed hypothesis.',
            evidenceRequirement: 'Inspect scoped source evidence.',
          },
        ],
        limitations: [],
      },
      evidenceMap: {
        facts: [
          {
            factId: 'fact-query-01',
            role: 'operation',
            evidence: [
              {
                path: 'src/query.ts',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
              },
              {
                path: 'src/query.ts',
                startLine: 2,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
              },
            ],
            planObligations: [{ obligationId: 'harness-obligation-01' }],
          },
        ],
        unansweredPlanObligations: [],
        limitations: [],
      },
      sourcePosture: {
        assessments: [
          {
            assessmentId: 'posture-harness-obligation-01',
            obligationId: 'harness-obligation-01',
            conclusion: 'risk-supported',
            evidenceMapFactIds: ['fact-query-01'],
            limitations: [],
          },
        ],
        limitations: [],
      },
      hypothesis: {
        vectorId: 'vector-injection-01',
        narrative: harnessNarrative(),
        claimEvidenceBundles: queryClaimEvidenceBundles(),
        planObligations: [{ obligationId: 'harness-obligation-01' }],
        evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
        claimEvidenceSelections: [
          { role: 'operation', selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }] },
          {
            role: 'unsafe-condition',
            selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
          },
        ],
        sourcePostureAssessmentIds: ['posture-harness-obligation-01'],
      },
      evidenceSelectionBasis: {
        hypothesisSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
        requiredControlFactIds: [],
        controlSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
        obligationSelections: [
          {
            planObligation: { obligationId: 'harness-obligation-01' },
            selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
          },
        ],
        postureSelections: [
          {
            assessmentId: 'posture-harness-obligation-01',
            selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
          },
        ],
      },
      availableSourcePaths: ['src/query.ts'],
      context: [],
      inspectionRequirement: {
        required: true,
        allowedToolIds: ['repo_read', 'repo_grep'],
      },
      retryGuidance: { kind: 'initial' },
    });
    expect(result.result.decision).toBe('accepted');
  } finally {
    await session.close();
    await harness.shutdown();
  }
});

test('mounts a separately scoped countercheck agent that cannot create a finding', async () => {
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      result: {
        decision: 'ACCEPTED',
        reasonCode: 'CLAIM-SUPPORTED',
        reason: 'A second scoped inspection still supports this exact hypothesis.',
        claimEvidenceBundles: [
          {
            role: 'operation',
            selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
            explanation: 'The query operation is selected from the evidence map.',
          },
          {
            role: 'unsafe-condition',
            selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
            explanation: 'The unsafe condition is selected from the evidence map.',
          },
        ],
        controlAssessment: {
          conclusion: 'no-effective-control-found',
          explanation: 'No scoped control negates this hypothesis.',
          evidenceSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
        },
        obligationReconciliations: [
          {
            planObligation: { obligationId: 'harness-obligation-01' },
            disposition: 'supports-claim',
            explanation: 'The scoped source supports this approved obligation.',
            evidenceSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
          },
        ],
        postureReconciliations: [
          {
            assessmentId: 'posture-harness-obligation-01',
            disposition: 'supports-claim',
            explanation: 'The posture aligns with the scoped source inspection.',
            evidenceSelections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
          },
        ],
      },
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const harness = createAuditHarness(provider, toolset);
  const session = await harness.getSession('test-countercheck-01');
  try {
    const result = await session.workflows.countercheck_hypothesis.prompt({
      countercheckId: 'countercheck-01',
      vector: {
        vectorId: 'vector-injection-01',
        vectorDigest: 'a'.repeat(64),
        title: 'Review injection',
        rationale: 'Review query construction.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'harness-obligation-01',
            riskStatement: 'Source could support the reviewed hypothesis.',
            evidenceRequirement: 'Inspect scoped source evidence.',
          },
        ],
        limitations: [],
      },
      evidenceMap: {
        facts: [
          {
            factId: 'fact-query-01',
            role: 'operation',
            evidence: [
              {
                path: 'src/query.ts',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
              },
            ],
            planObligations: [{ obligationId: 'harness-obligation-01' }],
          },
        ],
        unansweredPlanObligations: [],
        limitations: [],
      },
      sourcePosture: {
        assessments: [
          {
            assessmentId: 'posture-harness-obligation-01',
            obligationId: 'harness-obligation-01',
            conclusion: 'risk-supported',
            evidenceMapFactIds: ['fact-query-01'],
            limitations: [],
          },
        ],
        limitations: [],
      },
      hypothesis: {
        vectorId: 'vector-injection-01',
        narrative: harnessNarrative(),
        claimEvidenceBundles: queryClaimEvidenceBundles(),
        planObligations: [{ obligationId: 'harness-obligation-01' }],
        evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
        claimEvidenceSelections: [
          { role: 'operation', selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }] },
          {
            role: 'unsafe-condition',
            selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
          },
        ],
        sourcePostureAssessmentIds: ['posture-harness-obligation-01'],
      },
      availableSourcePaths: ['src/query.ts'],
      context: [],
      inspectionRequirement: {
        required: true,
        allowedToolIds: ['repo_read', 'repo_grep'],
      },
      retryGuidance: { kind: 'initial' },
    });
    expect(result.result.decision).toBe('accepted');
    expect(result).not.toHaveProperty('findings');
  } finally {
    await session.close();
    await harness.shutdown();
  }
});

test('verifies model findings against actual source lines and the approved vector', () => {
  const vector = {
    vectorId: 'vector-injection-01',
    vectorDigest: 'a'.repeat(64),
    title: 'Review injection',
    rationale: 'Review input reaching queries.',
    enabled: true,
    scopeGlobs: ['src/**'],
    reviewObligations: [
      {
        obligationId: 'harness-obligation-01',
        riskStatement: 'Source could support injection risk.',
        evidenceRequirement: 'Any persisted finding cites source evidence.',
      },
    ],
    limitations: [],
  };
  const grounded = verifyModelFindings(
    vector,
    [
      {
        vectorId: 'vector-injection-01',
        statement: 'Query issue',
        claimEvidenceBundles: [
          {
            role: 'operation',
            explanation: 'The operation is selected.',
            evidence: [
              {
                path: 'src/query.ts',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
                role: 'operation',
              },
            ],
          },
          {
            role: 'unsafe-condition',
            explanation: 'The condition is selected.',
            evidence: [
              {
                path: 'src/query.ts',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
                role: 'unsafe-condition',
              },
            ],
          },
        ],
        planObligations: [{ obligationId: 'harness-obligation-01' }],
        evidenceMapFactIds: ['fact-query-01'],
        claimEvidenceSelections: [
          { role: 'operation', selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }] },
          {
            role: 'unsafe-condition',
            selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }],
          },
        ],
        sourcePostureAssessmentIds: ['posture-harness-obligation-01'],
        limitations: [],
      },
    ],
    [
      {
        path: 'src/query.ts',
        content: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
        languageHint: 'typescript',
      },
    ],
  );
  expect(grounded.verified[0]?.claimEvidenceBundles[0]?.evidence[0]?.contentDigest).toMatch(
    /^[a-f0-9]{64}$/u,
  );
  expect(grounded.verified[0]?.claimEvidenceBundles[0]?.evidence[0]?.contentDigest).not.toBe(
    'a'.repeat(64),
  );
});
