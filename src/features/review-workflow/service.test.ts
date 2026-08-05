import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonValue } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';
import { createPlan as createDraftPlan } from '../attack-planning/index.js';
import { modelStagesForAudit } from '../audit-execution/model-stage-observations.js';
import { createModelCostCeiling } from '../model-operations/model-operations.js';
import { createReviewService } from './service.js';

function enqueueEvidenceMap(provider: FakeModelProvider, path: string): void {
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      facts: [
        {
          factId: 'fact-input-01',
          role: 'input',
          statement: 'The approved source receives the reviewed input.',
          evidence: [{ path, startLine: 1 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
        {
          factId: 'fact-source-01',
          role: 'operation',
          statement: 'The approved source contains the reviewed operation.',
          evidence: [{ path, startLine: 1 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [],
      limitations: [],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
}

function enqueueSourcePosture(provider: FakeModelProvider): void {
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      assessments: [
        {
          assessmentId: 'posture-test-obligation-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          summary: 'The scoped source supports later investigation of this obligation.',
          evidenceMapFactIds: ['fact-input-01', 'fact-source-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
}

function enqueueScopedInspection(provider: FakeModelProvider): void {
  provider.enqueueObject({
    object: {},
    toolCalls: [
      {
        id: 'test-scoped-inspection',
        name: 'repo_grep',
        arguments: {
          pattern: '__audit_test_no_match__',
          mode: 'literal',
          caseSensitive: true,
        },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  });
}

function investigationClosures(disposition: 'candidate-raised' | 'no-source-backed-candidate') {
  return [
    {
      planObligation: { obligationId: 'test-obligation-01' },
      disposition,
      evidenceMapFactIds: ['fact-input-01', 'fact-source-01'],
      limitations: [],
    },
  ];
}

function discoverySeed(vectorId: string) {
  return {
    seedId: 'seed-review-01',
    vectorId,
    hypothesis: 'The reviewed source may require security follow-up.',
    planObligations: [{ obligationId: 'test-obligation-01' }],
    evidenceMapFactIds: ['fact-input-01', 'fact-source-01'],
    limitations: [],
  };
}

function wrappedVerificationResult(result: JsonValue): JsonValue {
  return { result };
}

test('review service creates an executable plan and audits it directly', async () => {
  const target = await mkdtemp(join(tmpdir(), 'audit-service-'));
  await writeFile(
    join(target, 'query.ts'),
    String.raw`const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
`,
    'utf8',
  );
  const provider = new FakeModelProvider();
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Review query injection',
          rationale: 'Input reaches a query.',
          enabled: true,
          scopeGlobs: ['**/*.ts'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'Input could change query semantics.',
              evidenceRequirement: 'Inspect source evidence for input and query construction.',
            },
          ],
          limitations: [],
        },
      ],
      additionalObservations: [
        {
          observationId: 'review-unrelated-boundary',
          title: 'Review an unrelated boundary',
          rationale: 'This suggestion needs a human decision before audit execution.',
          scopeGlobs: ['not-present/**'],
          reviewObligations: [
            {
              obligationId: 'unrelated-boundary-01',
              riskStatement: 'An unrelated boundary may require a later security review.',
              evidenceRequirement: 'Inspect that boundary only after human promotion.',
            },
          ],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  enqueueEvidenceMap(provider, 'query.ts');
  enqueueSourcePosture(provider);
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: { seeds: [], closures: investigationClosures('no-source-backed-candidate') },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const service = createReviewService(provider);
  const created = await service.createPlan({
    targetRoot: target,
    targetDisplayName: 'fixture',
    createdAt: '2026-07-27T12:00:00.000Z',
    sessionId: 'service-plan-01',
  });
  expect(created.plan.planId).toStartWith('plan-');
  expect(created.plan.additionalObservations).toHaveLength(1);
  expect(created.modelObservation.usage.modelCallCount).toBe(2);
  expect(created.modelObservation.stages).toMatchObject([
    { stage: 'planning', status: 'completed', usage: { modelCallCount: 2 } },
  ]);
  const executablePlan = created.plan;
  const audited = await service.audit({
    targetRoot: target,
    targetDisplayName: 'fixture',
    plan: executablePlan,
    runId: 'service-audit-01',
    generatedAt: '2026-07-27T12:02:00.000Z',
    sessionId: 'service-audit-01',
  });
  expect(audited.report.findings).toHaveLength(0);
  expect(audited.report.coverage).toHaveLength(1);
  expect(audited.modelObservation.usage.modelCallCount).toBe(6);
  expect(audited.report.coverage[0]?.modelObservation).toMatchObject({
    stage: 'investigation',
    status: 'completed',
    usage: { modelCallCount: 2 },
  });
  const investigation = audited.report.coverage[0]?.modelObservation;
  if (investigation === undefined) throw new Error('Expected an investigation observation.');
  const experimentalReport = {
    ...audited.report,
    coverage: audited.report.coverage.map((coverage) => ({
      ...coverage,
      countercheckObservations: [
        {
          ...investigation,
          stage: 'countercheck' as const,
          stageId: 'countercheck-experiment-01',
        },
      ],
    })),
  };
  expect(modelStagesForAudit(experimentalReport).map((stage) => stage.stage)).toEqual([
    'evidence-mapping',
    'source-posture',
    'investigation',
    'countercheck',
  ]);
});

test('retries one failed agent invocation without expanding the approved audit scope', async () => {
  const target = await mkdtemp(join(tmpdir(), 'audit-retry-service-'));
  await writeFile(join(target, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Review bounded source',
          rationale: 'The file needs an evidence review.',
          enabled: true,
          scopeGlobs: ['reviewed.unknown'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'The bounded source could require security follow-up.',
              evidenceRequirement: 'Inspect source evidence only inside the approved file.',
            },
          ],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const service = createReviewService(provider);
  const created = await service.createPlan({
    targetRoot: target,
    targetDisplayName: 'retry-fixture',
    createdAt: '2026-07-29T12:00:00.000Z',
    sessionId: 'retry-plan-01',
  });
  enqueueEvidenceMap(provider, 'reviewed.unknown');
  enqueueSourcePosture(provider);
  provider.enqueueObject({
    object: { seeds: [{}], closures: investigationClosures('candidate-raised') },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: { seeds: [], closures: investigationClosures('no-source-backed-candidate') },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const audited = await service.audit({
    targetRoot: target,
    targetDisplayName: 'retry-fixture',
    plan: created.plan,
    runId: 'retry-audit-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    sessionId: 'retry-audit-01',
  });
  expect(audited.report.coverage[0]).toMatchObject({ outcome: 'completed', findingCount: 0 });
  expect(provider.requests).toHaveLength(9);
});

test('rejects a plan whose fingerprint does not match before provider dispatch', async () => {
  const provider = new FakeModelProvider();
  const service = createReviewService(provider);
  const target = await mkdtemp(join(tmpdir(), 'audit-plan-mismatch-'));
  await writeFile(join(target, 'fixture.ts'), 'export const fixture = true;\n', 'utf8');
  const draft = createDraftPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    createdAt: '2026-07-27T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review injection',
        rationale: 'Review source.',
        enabled: true,
        scopeGlobs: ['**/*'],
        reviewObligations: [
          {
            obligationId: 'service-obligation-01',
            riskStatement: 'The source could expose a security concern.',
            evidenceRequirement: 'Inspect source evidence inside the approved scope.',
          },
        ],
        limitations: [],
      },
    ],
  });
  await expect(
    service.audit({
      targetRoot: target,
      targetDisplayName: 'fixture',
      plan: draft,
      runId: 'service-audit-02',
      generatedAt: '2026-07-27T12:02:00.000Z',
      sessionId: 'service-audit-02',
    }),
  ).rejects.toThrow('does not match');
  expect(provider.requests).toHaveLength(0);
});

test('rejects an edited plan before opening the target root or dispatching a provider', async () => {
  const provider = new FakeModelProvider();
  const service = createReviewService(provider);
  const sealed = createDraftPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    createdAt: '2026-07-27T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review injection',
        rationale: 'Review source.',
        enabled: true,
        scopeGlobs: ['**/*'],
        reviewObligations: [
          {
            obligationId: 'service-obligation-01',
            riskStatement: 'The source could expose a security concern.',
            evidenceRequirement: 'Inspect source evidence inside the approved scope.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const sealedVector = sealed.vectors[0];
  if (sealedVector === undefined) throw new Error('Fixture requires one vector.');
  const edited = {
    ...sealed,
    vectors: [{ ...sealedVector, scopeGlobs: ['private/**'] }],
  };

  await expect(
    service.audit({
      targetRoot: join(tmpdir(), 'audit-missing-target'),
      targetDisplayName: 'fixture',
      plan: edited,
      runId: 'service-audit-edited',
      generatedAt: '2026-07-27T12:02:00.000Z',
      sessionId: 'service-audit-edited',
    }),
  ).rejects.toThrow('edited without being resealed');
  expect(provider.requests).toHaveLength(0);
});

test('rejects a plan with no enabled vectors before opening the target root or dispatching a provider', async () => {
  const provider = new FakeModelProvider();
  const service = createReviewService(provider);
  const sealed = createDraftPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    createdAt: '2026-07-27T12:00:00.000Z',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    vectors: [
      {
        title: 'Review injection',
        rationale: 'Review source.',
        enabled: true,
        scopeGlobs: ['**/*'],
        reviewObligations: [
          {
            obligationId: 'service-obligation-01',
            riskStatement: 'The source could expose a security concern.',
            evidenceRequirement: 'Inspect source evidence inside the approved scope.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const vector = sealed.vectors[0];
  if (vector === undefined) throw new Error('Fixture requires one vector.');

  await expect(
    service.audit({
      targetRoot: join(tmpdir(), 'audit-missing-target'),
      targetDisplayName: 'fixture',
      plan: { ...sealed, vectors: [{ ...vector, enabled: false }] },
      runId: 'service-audit-disabled',
      generatedAt: '2026-07-27T12:02:00.000Z',
      sessionId: 'service-audit-disabled',
    }),
  ).rejects.toThrow('requires at least one enabled vector');
  expect(provider.requests).toHaveLength(0);
});

test('does not persist a model claim outside the approved vector scope', async () => {
  const target = await mkdtemp(join(tmpdir(), 'audit-scoped-service-'));
  await writeFile(join(target, 'allowed.ts'), 'export const safe = true;\n', 'utf8');
  await writeFile(join(target, 'private.ts'), "const token = 'super-secret-value';\n", 'utf8');
  const provider = new FakeModelProvider();
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Review allowed source',
          rationale: 'The approved file may contain a secret.',
          enabled: true,
          scopeGlobs: ['allowed.ts'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'The approved file could contain a secret literal.',
              evidenceRequirement: 'Inspect source evidence only inside the approved scope.',
            },
          ],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const service = createReviewService(provider);
  const created = await service.createPlan({
    targetRoot: target,
    targetDisplayName: 'fixture',
    createdAt: '2026-07-27T12:00:00.000Z',
    sessionId: 'scoped-plan-01',
  });
  const vector = created.plan.vectors[0];
  if (vector === undefined) throw new Error('Missing scoped vector.');
  enqueueEvidenceMap(provider, 'allowed.ts');
  enqueueSourcePosture(provider);
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      seeds: [discoverySeed(vector.vectorId)],
      closures: investigationClosures('candidate-raised'),
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      groundings: [
        {
          seedId: 'seed-review-01',
          candidate: {
            vectorId: vector.vectorId,
            statement: 'Private secret',
            claimEvidenceBundles: [
              {
                role: 'operation',
                explanation: 'The selected source fact establishes the operation.',
                selections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
              },
              {
                role: 'unsafe-condition',
                explanation: 'The selected input fact establishes the unsafe condition.',
                selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
              },
            ],
            planObligations: [{ obligationId: 'test-obligation-01' }],
            evidenceMapFactIds: ['fact-input-01', 'fact-source-01'],
            limitations: [],
          },
          nullReason: null,
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const audited = await service.audit({
    targetRoot: target,
    targetDisplayName: 'fixture',
    plan: created.plan,
    runId: 'scoped-audit-01',
    generatedAt: '2026-07-27T12:02:00.000Z',
    sessionId: 'scoped-audit-01',
  });
  expect(audited.report.findings).toHaveLength(0);
  expect(audited.report.errors.map((error) => error.code)).toContain('validation-output-shape');
});

test('routes a map-bound candidate through scoped inspection to an independent verifier', async () => {
  const target = await mkdtemp(join(tmpdir(), 'audit-verifier-service-'));
  await writeFile(
    join(target, 'query.ts'),
    String.raw`const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
`,
    'utf8',
  );
  const provider = new FakeModelProvider();
  const verifierProvider = new FakeModelProvider();
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Review query injection',
          rationale: 'Input may be interpolated into a query.',
          enabled: true,
          scopeGlobs: ['query.ts'],
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              riskStatement: 'Request input could change query semantics.',
              evidenceRequirement: 'Inspect scoped source evidence before independent review.',
            },
          ],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const service = createReviewService(provider, undefined, {
    independentVerifierRoute: {
      route: 'independent',
      modelProvider: verifierProvider,
      modelName: 'independent-fixture-model',
      modelPricing: {},
      modelCacheRoutingKey: undefined,
      cacheRoutingEnabled: false,
      fingerprint: 'd'.repeat(64),
    },
  });
  const created = await service.createPlan({
    targetRoot: target,
    targetDisplayName: 'verifier-fixture',
    createdAt: '2026-07-29T12:00:00.000Z',
    sessionId: 'verifier-plan-01',
  });
  const vector = created.plan.vectors[0];
  if (vector === undefined) throw new Error('Missing verifier vector.');
  enqueueEvidenceMap(provider, 'query.ts');
  enqueueSourcePosture(provider);
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      seeds: [discoverySeed(vector.vectorId)],
      closures: investigationClosures('candidate-raised'),
    },
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    finishReason: 'stop',
  });
  enqueueScopedInspection(provider);
  provider.enqueueObject({
    object: {
      groundings: [
        {
          seedId: 'seed-review-01',
          candidate: {
            statement: 'Query includes a request-controlled value',
            claimEvidenceBundles: [
              {
                role: 'operation',
                explanation: 'The selected source fact establishes the query operation.',
                selections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
              },
              {
                role: 'unsafe-condition',
                explanation: 'The selected input fact establishes the unsafe condition.',
                selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    finishReason: 'stop',
  });
  enqueueScopedInspection(verifierProvider);
  verifierProvider.enqueueObject({
    object: wrappedVerificationResult({
      decision: 'accepted',
      reasonCode: 'claim-supported',
      reason: 'The source supports the stated risk.',
      claimEvidenceBundles: [
        {
          role: 'operation',
          explanation: 'The selected source fact establishes the query operation.',
          selections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
        },
        {
          role: 'unsafe-condition',
          explanation: 'The selected input fact establishes the unsafe condition.',
          selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No scoped control negates the hypothesis.',
        evidenceSelections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
      },
      obligationReconciliations: [
        {
          planObligation: { obligationId: 'test-obligation-01' },
          disposition: 'supports-claim',
          explanation: 'The scoped source supports this approved obligation.',
          evidenceSelections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
        },
      ],
      postureReconciliations: [
        {
          assessmentId: 'posture-test-obligation-01',
          disposition: 'supports-claim',
          explanation: 'The posture aligns with the scoped source inspection.',
          evidenceSelections: [{ factId: 'fact-source-01', evidenceIndex: 0 }],
        },
      ],
    }),
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    finishReason: 'stop',
  });
  const audited = await service.audit({
    targetRoot: target,
    targetDisplayName: 'verifier-fixture',
    plan: created.plan,
    runId: 'verifier-audit-01',
    generatedAt: '2026-07-29T12:02:00.000Z',
    sessionId: 'verifier-audit-01',
  });
  expect(audited.report.findings).toHaveLength(1);
  expect(audited.report.errors).toEqual([]);
  expect(audited.report.coverage[0]?.verificationObservations).toMatchObject([
    { stage: 'verification', status: 'completed' },
  ]);
  expect(audited.modelObservation.stages).toMatchObject([
    { stage: 'evidence-mapping', usage: { modelCallCount: 2 } },
    { stage: 'source-posture', usage: { modelCallCount: 2 } },
    { stage: 'investigation', usage: { modelCallCount: 2 } },
    { stage: 'candidate-grounding', usage: { modelCallCount: 2 } },
    { stage: 'verification', usage: { modelCallCount: 2 } },
  ]);
  expect(audited.modelObservation.stages).toEqual(
    expect.arrayContaining([expect.objectContaining({ stage: 'verification' })]),
  );
  expect(provider.requests).toHaveLength(10);
  expect(verifierProvider.requests).toHaveLength(2);
});

test('uses a caller-owned cost guard with any positive queue capacity and rejects competing configuration', () => {
  const ceiling = createModelCostCeiling({
    configuredUsd: 1,
    pricing: { inputPerMillion: 1, outputPerMillion: 1, source: 'catalogue' },
  });
  const service = createReviewService(new FakeModelProvider(), undefined, {
    modelCostCeiling: ceiling,
    maxParallelVectors: 128,
  });
  expect(service.modelCostCeiling()).toBe(ceiling);
  expect(service.modelCostCeilingState()).toEqual(ceiling.state());
  expect(() =>
    createReviewService(new FakeModelProvider(), undefined, {
      modelCostCeiling: ceiling,
      maxEstimatedCostUsd: 1,
    }),
  ).toThrow('either a shared model-cost ceiling or a configured ceiling');
});
