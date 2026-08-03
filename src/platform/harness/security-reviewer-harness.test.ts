import { expect, test } from 'bun:test';
import { FakeModelProvider } from '@purista/harness/testing';
import { verifyModelFindings } from '../../features/audit-execution/investigation/verify.js';
import {
  createSecurityReviewerHarness,
  HarnessExecutionConfigurationSchema,
  harnessProviderRetry,
  type ReviewToolset,
} from './security-reviewer-harness.js';

const targetFingerprint = 'a'.repeat(64);
const contextDigest = 'b'.repeat(64);

const toolset: ReviewToolset = {
  listFiles: async () => ({
    entries: [{ path: 'src/query.ts', sizeBytes: 42, languageHint: 'typescript' }],
  }),
  readFile: async () => ({
    path: 'src/query.ts',
    startLine: 1,
    endLine: 1,
    text: String.raw`const sql = \`SELECT * FROM users WHERE id = '\${userId}'\`;`,
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
  const harness = createSecurityReviewerHarness(provider, toolset);
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

test('does not silently cap one agent invocation at 64 tool rounds', async () => {
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
  const harness = createSecurityReviewerHarness(provider, toolset);
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
  expect(harnessProviderRetry('default')).toEqual({ maxAttempts: 1 });
  expect(harnessProviderRetry('disabled')).toBeFalse();
});

test('mounts an independently owned scoped verifier agent', async () => {
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      decision: 'ACCEPTED',
      reason: 'The cited source line supports the stated risk.',
      operationEvidence: { factId: 'fact-query-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-query-01', evidenceIndex: 0 },
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
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const harness = createSecurityReviewerHarness(provider, toolset);
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
            statement: 'The query operation is in scope.',
            evidence: [
              {
                path: 'src/query.ts',
                startLine: 1,
                snippet: 'query construction',
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
        statement: 'Unsafe query construction',
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 1,
            snippet: 'query construction',
            kind: 'source',
            role: 'operation',
          },
          {
            path: 'src/query.ts',
            startLine: 1,
            snippet: 'interpolated value',
            kind: 'source',
            role: 'unsafe-condition',
          },
        ],
        planObligations: [{ obligationId: 'harness-obligation-01' }],
        evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
        sourcePostureAssessmentIds: ['posture-harness-obligation-01'],
        limitations: [],
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
    });
    expect(result.decision).toBe('accepted');
  } finally {
    await session.close();
    await harness.shutdown();
  }
});

test('mounts a separately scoped countercheck agent that cannot create a finding', async () => {
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      decision: 'ACCEPTED',
      reason: 'A second scoped inspection still supports this exact hypothesis.',
      operationEvidence: { factId: 'fact-query-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
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
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const harness = createSecurityReviewerHarness(provider, toolset);
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
            statement: 'The query operation is in scope.',
            evidence: [
              {
                path: 'src/query.ts',
                startLine: 1,
                snippet: 'query construction',
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
        statement: 'Unsafe query construction',
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 1,
            snippet: 'query construction',
            kind: 'source',
            role: 'operation',
          },
          {
            path: 'src/query.ts',
            startLine: 1,
            snippet: 'interpolated value',
            kind: 'source',
            role: 'unsafe-condition',
          },
        ],
        planObligations: [{ obligationId: 'harness-obligation-01' }],
        evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
        sourcePostureAssessmentIds: ['posture-harness-obligation-01'],
        limitations: [],
      },
      availableSourcePaths: ['src/query.ts'],
      context: [],
      inspectionRequirement: {
        required: true,
        allowedToolIds: ['repo_read', 'repo_grep'],
      },
    });
    expect(result.decision).toBe('accepted');
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
        evidence: [
          {
            path: 'src/query.ts',
            startLine: 1,
            snippet: 'invented',
            kind: 'source',
            role: 'operation',
          },
          {
            path: 'src/query.ts',
            startLine: 1,
            snippet: 'invented',
            kind: 'source',
            role: 'unsafe-condition',
          },
        ],
        planObligations: [{ obligationId: 'harness-obligation-01' }],
        evidenceMapFactIds: ['fact-query-01'],
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
  expect(grounded.verified[0]?.evidence[0]?.snippet).toContain('SELECT');
  expect(grounded.verified[0]?.evidence[0]?.snippet).not.toBe('invented');
});
