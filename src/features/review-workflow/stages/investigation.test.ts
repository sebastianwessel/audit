import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/security-reviewer-harness.js';
import { AuditInvestigationRequestSchema } from '../../audit-execution/audit.schema.js';
import { runInvestigationStage } from './investigation.js';

test('runs the investigator with a bounded source view and records its own stage ledger', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'security-reviewer-investigation-stage-'));
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
            statement: 'The approved source contains the reviewed operation.',
            evidence: [
              {
                path: 'reviewed.unknown',
                startLine: 1,
                snippet: 'value = request.input;',
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
  const targetRoot = await mkdtemp(join(tmpdir(), 'security-reviewer-investigation-failure-'));
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
            statement: 'The approved source contains the reviewed operation.',
            evidence: [
              {
                path: 'reviewed.unknown',
                startLine: 1,
                snippet: 'value = request.input;',
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
      errorCode: expect.stringContaining('validation-output-'),
      recoveredErrorCodes: [],
      usage: { modelCallCount: 1, inputTokens: 3, outputTokens: 2 },
    },
  });
});
