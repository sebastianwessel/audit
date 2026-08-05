import { expect, test } from 'bun:test';
import { FakeModelProvider } from '@purista/harness/testing';
import { createPlan } from '../../src/features/attack-planning/plan.js';
import { catalogueModelPricing } from '../../src/features/model-operations/model-pricing-catalogue.js';
import { HarnessExecutionConfigurationSchema } from '../../src/platform/harness/audit-harness.js';

import { CorpusAnswerKeySchema } from './corpus.schema.js';
import {
  evaluateGeneratedPlanSemantics,
  reviewGeneratedPlanSemantics,
} from './plan-semantic-agent.js';

test('runs the isolated semantic evaluator without repository tools', async () => {
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      scenarios: [
        {
          scenarioId: 'scenario-01',
          outcome: 'covered',
          vectorIds: ['vector-01'],
        },
      ],
      vectors: [
        {
          vectorId: 'vector-01',
          outcome: 'relevant',
          scenarioIds: ['scenario-01'],
        },
      ],
      observations: [
        {
          observationId: 'observation-01',
          outcome: 'appropriate',
          scenarioIds: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const output = await reviewGeneratedPlanSemantics({
    provider: 'openai',
    modelProvider: provider,
    modelName: 'fixture',
    execution: HarnessExecutionConfigurationSchema.parse({}),
    sessionId: 'semantic-evaluator-test',
    request: {
      planId: 'plan-1234567890abcdef',
      planDigest: 'a'.repeat(64),
      vectors: [
        {
          vectorId: 'vector-01',
          title: 'Review the source boundary',
          rationale: 'The review needs one bounded vector.',
          enabled: true,
          scopeGlobs: ['src/**'],
          reviewObligations: [
            {
              obligationId: 'obligation-01',
              riskStatement: 'A security boundary might be violated.',
              evidenceRequirement: 'Review the operation and condition.',
            },
          ],
          limitations: [],
        },
      ],
      observations: [
        {
          observationId: 'observation-01',
          title: 'Review an optional adjacent boundary',
          rationale: 'This remains a human-review suggestion unless deliberately promoted.',
          scopeGlobs: ['operations/**'],
          reviewObligations: [
            {
              obligationId: 'observation-obligation-01',
              riskStatement: 'An adjacent boundary may merit later human review.',
              evidenceRequirement: 'A human decides whether project evidence creates audit work.',
            },
          ],
          limitations: ['Not executable audit work.'],
        },
      ],
      scenarios: [
        {
          scenarioId: 'scenario-01',
          objective: 'Review the source boundary.',
          sourceOnlyApplicable: true,
          requiredRiskCondition: 'The boundary might be violated.',
          evidenceRequirements: ['Review the operation and condition.'],
        },
      ],
    },
  });
  expect(output.scenarios[0]).toMatchObject({ outcome: 'covered' });
  expect(output.vectors[0]).toMatchObject({ outcome: 'relevant' });
  expect(output.observations[0]).toMatchObject({ outcome: 'appropriate' });
  expect(provider.requests).toHaveLength(1);
  expect(JSON.stringify(provider.requests)).not.toContain('repo_read');
  expect(JSON.stringify(provider.requests)).not.toContain('startLine');
});

test('records a source-free incomplete evaluator observation instead of throwing raw provider errors', async () => {
  const plan = createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'semantic-evaluator-test',
    inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
    createdAt: '2026-08-03T12:00:00.000Z',
    vectors: [
      {
        title: 'Review one source boundary',
        rationale: 'The evaluator must assess this exact vector.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'obligation-01',
            riskStatement: 'A security boundary might be violated.',
            evidenceRequirement: 'Review the operation and condition.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Expected evaluator vector.');
  const answerKey = CorpusAnswerKeySchema.parse({
    schemaVersion: 6,
    caseId: 'semantic-evaluator-test',
    findingCoverage: 'targeted',
    expectedPlanScenarios: [
      {
        scenarioId: 'scenario-01',
        objective: 'Review the source boundary.',
        sourceOnlyApplicable: true,
        requiredRiskCondition: 'The boundary might be violated.',
        evidenceRequirements: ['Review the operation and condition.'],
        relevantPaths: ['src/app.txt'],
        expectedFindingIds: ['expected-01'],
      },
    ],
    expectedFindings: [
      {
        findingId: 'expected-01',
        staticReviewApplicable: true,
        evidenceRoles: [
          {
            role: 'operation',
            notApplicable: false,
            ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
          },
          {
            role: 'unsafe-condition',
            notApplicable: false,
            ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
          },
        ],
      },
    ],
    patchedExpectation: 'no-matching-finding',
    staticReviewApplicable: true,
    adjudicationStatus: 'provisional',
    reviewers: ['plan-semantic-evaluator'],
    independentReviews: [
      {
        reviewer: 'plan-semantic-evaluator',
        reviewerKind: 'ai-assisted',
        reviewedAt: '2026-08-03T12:00:00.000Z',
        decision: 'include',
        findingCoverage: 'targeted',
        expectedPlanScenarios: [
          {
            scenarioId: 'scenario-01',
            objective: 'Review the source boundary.',
            sourceOnlyApplicable: true,
            requiredRiskCondition: 'The boundary might be violated.',
            evidenceRequirements: ['Review the operation and condition.'],
            relevantPaths: ['src/app.txt'],
            expectedFindingIds: ['expected-01'],
          },
        ],
        expectedFindings: [
          {
            findingId: 'expected-01',
            staticReviewApplicable: true,
            evidenceRoles: [
              {
                role: 'operation',
                notApplicable: false,
                ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
              },
              {
                role: 'unsafe-condition',
                notApplicable: false,
                ranges: [{ path: 'src/app.txt', startLine: 1, endLine: 1 }],
              },
            ],
          },
        ],
        patchedExpectation: 'no-matching-finding',
        staticReviewApplicable: true,
        notes: 'Evaluator-only test key.',
      },
    ],
    notes: 'Evaluator-only test key.',
  });
  const diagnostics: object[] = [];
  const result = await evaluateGeneratedPlanSemantics({
    provider: 'openai',
    modelProvider: new FakeModelProvider(),
    modelName: 'gpt-5.6-terra',
    execution: HarnessExecutionConfigurationSchema.parse({}),
    sessionId: 'semantic-evaluator-failure-test',
    binding: {
      runId: 'run-01',
      trialId: 'trial-01',
      packId: 'pack-01',
      packVersion: '0.1.0',
      caseId: answerKey.caseId,
      variant: 'vulnerable',
      repetition: 1,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      contextDigest: plan.contextDigest,
      answerKeyScenarioDigest: 'c'.repeat(64),
      reviewerProtocolFingerprint: 'd'.repeat(64),
      reviewerRoute: 'primary',
    },
    plan,
    answerKey,
    reviewer: 'plan-semantic-evaluator',
    reviewedAt: '2026-08-03T12:00:00.000Z',
    modelPricing: catalogueModelPricing({ provider: 'openai', model: 'gpt-5.6-terra' }),
    evaluatorFailureDiagnosticSink: {
      evaluationRunId: 'run-01',
      protocolFingerprint: 'd'.repeat(64),
      now: () => '2026-08-04T12:00:00.000Z',
      write: async (diagnostic) => {
        diagnostics.push(diagnostic);
        expect(diagnostic).toMatchObject({
          stage: 'plan-semantic-adjudication',
          stageId: 'plan-semantic-trial-01',
          scopeFingerprint: plan.planDigest,
        });
      },
    },
  });
  expect(result).toMatchObject({
    status: 'incomplete',
    modelObservation: {
      stage: 'plan-semantic-adjudication',
      status: 'failed',
      usage: { modelCallCount: 1 },
    },
  });
  expect(diagnostics).toHaveLength(1);
});
