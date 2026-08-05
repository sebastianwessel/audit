import { expect, test } from 'bun:test';
import { ModelError } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';

import { HarnessExecutionConfigurationSchema } from '../../src/platform/harness/audit-harness.js';

import {
  StageIsolatedAdjudicationModelInputSchema,
  StageIsolatedAdjudicationModelOutputSchema,
  stageIsolatedProductOutputFingerprint,
  stageIsolatedRubricFingerprint,
  validateStageIsolatedAdjudicationResponse,
} from './stage-isolated-adjudication-agent.contract.js';
import { stageIsolatedAdjudicationAgentInstructions } from './stage-isolated-adjudication-agent.instructions.js';
import { adjudicateIsolatedStage } from './stage-isolated-adjudication-agent.js';

const rubric = {
  rubricId: 'stage-rubric-01',
  stage: 'verification' as const,
  expectedOutcomes: [
    {
      expectedOutcomeId: 'expected-outcome-01',
      objective: 'Verify the scoped boundary condition.',
      requiredRiskCondition: 'Untrusted input can reach an unsafe operation.',
      evidenceRequirements: ['Confirm the operation and unsafe condition.'],
      requiredRoles: ['operation' as const, 'unsafe-condition' as const],
    },
  ],
};

const productStageOutput = {
  stage: 'verification' as const,
  stageResultId: 'stage-result-01',
  outputs: [
    {
      productOutputId: 'product-output-01',
      semanticClaim: 'The product result identifies the required boundary condition.',
    },
    {
      productOutputId: 'product-output-02',
      semanticClaim: 'The product result identifies an unrelated observation.',
    },
  ],
  roleLocalizations: [
    {
      localizationId: 'localization-01',
      productOutputId: 'product-output-01',
      role: 'operation' as const,
    },
    {
      localizationId: 'localization-02',
      productOutputId: 'product-output-01',
      role: 'unsafe-condition' as const,
    },
  ],
};

const request = {
  expectedOutcomeRubric: {
    ...rubric,
    rubricFingerprint: stageIsolatedRubricFingerprint(rubric),
  },
  productStageOutput: {
    ...productStageOutput,
    stageResultFingerprint: stageIsolatedProductOutputFingerprint(productStageOutput),
  },
};

const response = {
  expectedOutcomes: [
    {
      expectedOutcomeId: 'expected-outcome-01',
      disposition: 'matched' as const,
      productOutputIds: ['product-output-01'],
      roleLocalizations: [
        { role: 'operation' as const, localizationIds: ['localization-01'] },
        { role: 'unsafe-condition' as const, localizationIds: ['localization-02'] },
      ],
    },
  ],
  unexpectedProductOutputIds: ['product-output-02'],
};

test('accepts a complete evaluator-only mapping with exact output and role-localization closure', () => {
  const parsedRequest = StageIsolatedAdjudicationModelInputSchema.parse(request);
  const parsedResponse = StageIsolatedAdjudicationModelOutputSchema.parse(response);

  expect(
    validateStageIsolatedAdjudicationResponse({
      request: parsedRequest,
      response: parsedResponse,
    }),
  ).toEqual(parsedResponse);
});

test('rejects a rubric whose fingerprint does not bind its source-free content', () => {
  expect(() =>
    StageIsolatedAdjudicationModelInputSchema.parse({
      ...request,
      expectedOutcomeRubric: {
        ...request.expectedOutcomeRubric,
        rubricFingerprint: 'f'.repeat(64),
      },
    }),
  ).toThrow('rubric fingerprint');
});

test('rejects a product projection whose fingerprint does not bind its source-free content', () => {
  expect(() =>
    StageIsolatedAdjudicationModelInputSchema.parse({
      ...request,
      productStageOutput: {
        ...request.productStageOutput,
        stageResultFingerprint: 'f'.repeat(64),
      },
    }),
  ).toThrow('product projection fingerprint');
});

test('rejects source, prompt, tool, priority, fix, and admission fields', () => {
  expect(() =>
    StageIsolatedAdjudicationModelInputSchema.parse({
      ...request,
      source: 'source content is forbidden',
    }),
  ).toThrow();
  expect(() =>
    StageIsolatedAdjudicationModelInputSchema.parse({
      ...request,
      productStageOutput: { ...request.productStageOutput, prompt: 'prompt content is forbidden' },
    }),
  ).toThrow();
  expect(() =>
    StageIsolatedAdjudicationModelInputSchema.parse({
      ...request,
      productStageOutput: {
        ...request.productStageOutput,
        toolResult: 'tool content is forbidden',
      },
    }),
  ).toThrow();
  expect(() =>
    StageIsolatedAdjudicationModelOutputSchema.parse({
      ...response,
      priority: 'critical',
    }),
  ).toThrow();
  expect(() =>
    StageIsolatedAdjudicationModelOutputSchema.parse({
      ...response,
      proposedFix: 'change the implementation',
    }),
  ).toThrow();
  expect(() =>
    StageIsolatedAdjudicationModelOutputSchema.parse({
      ...response,
      productAdmissionConclusion: 'accept the finding',
    }),
  ).toThrow();
  expect(() =>
    StageIsolatedAdjudicationModelInputSchema.parse({
      ...request,
      productStageOutput: { ...request.productStageOutput, sourcePath: 'src/private.ts' },
    }),
  ).toThrow();
});

test('runs one evaluator-only Purista call without filesystem or repository tools', async () => {
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: response,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const output = await adjudicateIsolatedStage({
    provider: 'openai',
    modelProvider: provider,
    modelName: 'fixture',
    execution: HarnessExecutionConfigurationSchema.parse({}),
    sessionId: 'stage-isolated-adjudicator-test',
    request: StageIsolatedAdjudicationModelInputSchema.parse(request),
    route: 'primary',
    stageId: 'stage-isolated-adjudicator-test',
    modelPricing: {},
    cacheRoutingEnabled: false,
    scopeFingerprint: 'a'.repeat(64),
  });
  expect(output).toMatchObject({ status: 'completed', output: response });
  expect(provider.requests).toHaveLength(1);
  expect(JSON.stringify(provider.requests)).not.toContain('repo_read');
});

test('writes only a safe opt-in diagnostic when the isolated evaluator provider fails', async () => {
  const provider = new FakeModelProvider();
  provider.object = async () => {
    throw new ModelError('source text must never persist', {
      provider: 'openai',
      model: 'fixture',
      method: 'object',
      reason: 'http_error',
      status: 400,
      providerCode: 'invalid_json_schema',
      providerMessage: 'source text must never persist',
      providerBody: { secret: 'source text must never persist' },
    });
  };
  const diagnostics: object[] = [];
  const result = await adjudicateIsolatedStage({
    provider: 'openai',
    modelProvider: provider,
    modelName: 'fixture',
    execution: HarnessExecutionConfigurationSchema.parse({}),
    sessionId: 'stage-isolated-adjudicator-failure-test',
    request: StageIsolatedAdjudicationModelInputSchema.parse(request),
    route: 'primary',
    stageId: 'stage-isolated-adjudicator-failure-test',
    modelPricing: {},
    cacheRoutingEnabled: false,
    scopeFingerprint: 'a'.repeat(64),
    evaluatorFailureDiagnosticSink: {
      evaluationRunId: 'stage-evaluation-01',
      protocolFingerprint: 'b'.repeat(64),
      now: () => '2026-08-04T12:00:00.000Z',
      write: async (diagnostic) => {
        diagnostics.push(diagnostic);
      },
    },
  });

  expect(result).toMatchObject({ status: 'failed', errorCode: 'provider-http-error' });
  expect(diagnostics).toHaveLength(1);
  expect(JSON.stringify(diagnostics)).not.toContain('source text must never persist');
  expect(diagnostics[0]).toMatchObject({
    errorClass: 'model-error',
    modelFailure: { reason: 'http_error', status: 400, providerCode: 'invalid_json_schema' },
  });
});

test('rejects incomplete, overlapping, and invalid role-localization closure at the contract boundary', () => {
  const parsedRequest = StageIsolatedAdjudicationModelInputSchema.parse(request);

  expect(() =>
    validateStageIsolatedAdjudicationResponse({
      request: parsedRequest,
      response: StageIsolatedAdjudicationModelOutputSchema.parse({
        ...response,
        expectedOutcomes: [],
        unexpectedProductOutputIds: ['product-output-01', 'product-output-02'],
      }),
    }),
  ).toThrow('must close every expected outcome exactly once');

  expect(() =>
    validateStageIsolatedAdjudicationResponse({
      request: parsedRequest,
      response: StageIsolatedAdjudicationModelOutputSchema.parse({
        ...response,
        unexpectedProductOutputIds: ['product-output-01', 'product-output-02'],
      }),
    }),
  ).toThrow('must be known and disjoint');

  expect(() =>
    validateStageIsolatedAdjudicationResponse({
      request: parsedRequest,
      response: StageIsolatedAdjudicationModelOutputSchema.parse({
        ...response,
        expectedOutcomes: [
          {
            ...response.expectedOutcomes[0],
            roleLocalizations: [
              { role: 'operation', localizationIds: ['localization-02'] },
              { role: 'unsafe-condition', localizationIds: ['localization-01'] },
            ],
          },
        ],
      }),
    }),
  ).toThrow('must be known, role-consistent');
});

test('keeps the evaluator instruction no-tools and outside product admission', () => {
  expect(stageIsolatedAdjudicationAgentInstructions).toContain('no-tools');
  expect(stageIsolatedAdjudicationAgentInstructions).toContain(
    'cannot alter product audit admission',
  );
  expect(stageIsolatedAdjudicationAgentInstructions).toContain('Do not request or use tools');
});
