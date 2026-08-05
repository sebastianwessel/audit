import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/audit-harness.js';
import { AuditInvestigationRequestSchema } from '../../audit-execution/audit.schema.js';
import { runInvestigationStage } from './investigation.js';

test('runs the investigator with a bounded source view and records its own stage ledger', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-investigation-stage-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {},
    toolCalls: [
      {
        id: 'investigation-scoped-inspection',
        name: 'repo_grep',
        arguments: { pattern: 'request', mode: 'literal', caseSensitive: true },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  });
  provider.enqueueObject({
    object: {
      seeds: [],
      closures: [
        {
          planObligation: { obligationId: 'test-obligation-01' },
          disposition: 'no-source-backed-candidate',
          evidenceMapFactIds: ['fact-source-01'],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop',
  });

  const result = await runInvestigationStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: AuditInvestigationRequestSchema.parse({
      vector: {
        vectorId: 'vector-unknown-01',
        vectorDigest: 'a'.repeat(64),
        title: 'Review bounded source',
        rationale: 'Review the approved source for security weaknesses.',
        enabled: true,
        scopeGlobs: ['reviewed.unknown'],
        reviewObligations: [
          {
            obligationId: 'test-obligation-01',
            riskStatement: 'The approved source could expose request-controlled data.',
            evidenceRequirement: 'Any claim is source-backed and inside the approved scope.',
          },
        ],
        limitations: [],
      },
      availableSourcePaths: ['reviewed.unknown'],
      evidenceMap: {
        facts: [
          {
            factId: 'fact-source-01',
            role: 'operation',
            evidence: [
              {
                path: 'reviewed.unknown',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
              },
            ],
            planObligations: [{ obligationId: 'test-obligation-01' }],
          },
        ],
        unansweredPlanObligations: [],
        limitations: [],
      },
      sourcePosture: {
        assessments: [
          {
            assessmentId: 'posture-test-obligation-01',
            obligationId: 'test-obligation-01',
            conclusion: 'risk-supported',
            evidenceMapFactIds: ['fact-source-01'],
            limitations: [],
          },
        ],
        limitations: [],
      },
      limitations: [],
    }),
    context: [],
    sessionId: 'investigation-stage-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result.seeds).toEqual([]);
  expect(result.modelObservation).toMatchObject({
    stage: 'investigation',
    status: 'completed',
    usage: { modelCallCount: 2, inputTokens: 4, outputTokens: 3 },
    toolUsage: { readFileCallCount: 0, grepFilesCallCount: 1 },
  });
});

test('fails closed when the investigator output cannot satisfy its contract', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-investigation-failure-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: { findings: [{}] },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop',
  });

  const result = await runInvestigationStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: AuditInvestigationRequestSchema.parse({
      vector: {
        vectorId: 'vector-unknown-02',
        vectorDigest: 'b'.repeat(64),
        title: 'Review bounded source',
        rationale: 'Review the approved source for security weaknesses.',
        enabled: true,
        scopeGlobs: ['reviewed.unknown'],
        reviewObligations: [
          {
            obligationId: 'test-obligation-01',
            riskStatement: 'The approved source could expose request-controlled data.',
            evidenceRequirement: 'Any claim is source-backed and inside the approved scope.',
          },
        ],
        limitations: [],
      },
      availableSourcePaths: ['reviewed.unknown'],
      evidenceMap: {
        facts: [
          {
            factId: 'fact-source-01',
            role: 'operation',
            evidence: [
              {
                path: 'reviewed.unknown',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
              },
            ],
            planObligations: [{ obligationId: 'test-obligation-01' }],
          },
        ],
        unansweredPlanObligations: [],
        limitations: [],
      },
      sourcePosture: {
        assessments: [
          {
            assessmentId: 'posture-test-obligation-01',
            obligationId: 'test-obligation-01',
            conclusion: 'risk-supported',
            evidenceMapFactIds: ['fact-source-01'],
            limitations: [],
          },
        ],
        limitations: [],
      },
      limitations: [],
    }),
    context: [],
    sessionId: 'investigation-stage-02',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    seeds: [],
    modelObservation: {
      stage: 'investigation',
      status: 'failed',
      errorCode: expect.stringMatching(/^validation-output-[a-f0-9]{64}-2$/u),
      recoveredErrorCodes: [],
      usage: { modelCallCount: 1, inputTokens: 3, outputTokens: 2 },
    },
  });
});

test('projects model-authored investigation limitations to the closed canonical token', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-investigation-limitation-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {},
    toolCalls: [
      {
        id: 'investigation-limitation-inspection',
        name: 'repo_read',
        arguments: { path: 'reviewed.unknown' },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  });
  provider.enqueueObject({
    object: {
      seeds: [],
      closures: [
        {
          planObligation: { obligationId: 'test-obligation-01' },
          disposition: 'no-source-backed-candidate',
          evidenceMapFactIds: ['fact-source-01'],
          limitations: ['The model-authored limitation must not enter a canonical artifact.'],
        },
      ],
    },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop',
  });

  const result = await runInvestigationStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: AuditInvestigationRequestSchema.parse({
      vector: {
        vectorId: 'vector-unknown-03',
        vectorDigest: 'c'.repeat(64),
        title: 'Review bounded source',
        rationale: 'Review the approved source for security weaknesses.',
        enabled: true,
        scopeGlobs: ['reviewed.unknown'],
        reviewObligations: [
          {
            obligationId: 'test-obligation-01',
            riskStatement: 'The approved source could expose request-controlled data.',
            evidenceRequirement: 'Any claim is source-backed and inside the approved scope.',
          },
        ],
        limitations: [],
      },
      availableSourcePaths: ['reviewed.unknown'],
      evidenceMap: {
        facts: [
          {
            factId: 'fact-source-01',
            role: 'operation',
            evidence: [
              {
                path: 'reviewed.unknown',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
              },
            ],
            planObligations: [{ obligationId: 'test-obligation-01' }],
          },
        ],
        unansweredPlanObligations: [],
        limitations: [],
      },
      sourcePosture: {
        assessments: [
          {
            assessmentId: 'posture-test-obligation-01',
            obligationId: 'test-obligation-01',
            conclusion: 'risk-supported',
            evidenceMapFactIds: ['fact-source-01'],
            limitations: [],
          },
        ],
        limitations: [],
      },
      limitations: [],
    }),
    context: [],
    sessionId: 'investigation-stage-03',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    closures: [
      {
        planObligation: { obligationId: 'test-obligation-01' },
        limitations: ['model-declared-limitation'],
      },
    ],
    modelObservation: {
      stage: 'investigation',
      status: 'completed',
      usage: { modelCallCount: 2, inputTokens: 4, outputTokens: 3 },
    },
  });
  expect(JSON.stringify(result)).not.toContain('model-authored limitation');
});
