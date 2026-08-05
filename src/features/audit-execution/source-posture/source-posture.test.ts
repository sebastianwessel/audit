import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type JsonValue,
  ModelError,
  type ObjectRequest,
  type ObjectResponse,
} from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/audit-harness.js';
import { SourcePostureRequestSchema } from '../../audit-execution/phase-input/contract.js';
import { SourcePostureModelInputSchema } from './agent/contract.js';

import { runSourcePostureStage } from './source-posture.js';

test('fails closed when a tool-guided posture completes without scoped source inspection', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-source-posture-stage-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      assessments: [
        {
          assessmentId: 'posture-test-obligation-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-contradicted',
          summary: 'The scoped evidence contradicts the risk-positive obligation.',
          evidenceMapFactIds: ['fact-source-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop',
  });

  const result = await runSourcePostureStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: SourcePostureRequestSchema.parse({
      vector: vector(),
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
      limitations: [],
    }),
    context: [],
    sessionId: 'source-posture-stage-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    status: 'failed',
    errorCode: 'coverage-incomplete',
    modelObservation: {
      stage: 'source-posture',
      status: 'failed',
      usage: { modelCallCount: 1, inputTokens: 3, outputTokens: 2 },
      toolUsage: { readFileCallCount: 0, grepFilesCallCount: 0 },
    },
  });
});

test('records a source-backed not-applicable posture as a neutral outcome', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-source-posture-not-applicable-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  enqueueScopedSearch(provider, 'not-applicable-inspection');
  provider.enqueueObject({
    object: {
      assessments: [
        {
          assessmentId: 'posture-test-obligation-01',
          obligationId: 'test-obligation-01',
          conclusion: 'not-applicable',
          summary: 'The scoped source does not represent the reviewed operation.',
          evidenceMapFactIds: ['fact-source-01'],
          notApplicableReason: 'no-relevant-operation-in-scope',
          limitations: [],
        },
      ],
      limitations: [],
    },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop',
  });

  const result = await runSourcePostureStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: SourcePostureRequestSchema.parse({
      vector: vector(),
      availableSourcePaths: ['reviewed.unknown'],
      evidenceMap: {
        facts: [sourceFact('fact-source-01', 'reviewed.unknown')],
        unansweredPlanObligations: [],
        limitations: [],
      },
      limitations: [],
    }),
    context: [],
    sessionId: 'source-posture-stage-not-applicable-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    status: 'completed',
    output: {
      assessments: [
        {
          conclusion: 'not-applicable',
          notApplicableReason: 'no-relevant-operation-in-scope',
        },
      ],
    },
    modelObservation: { toolUsage: { successfulGrepFilesCallCount: 1 } },
  });
  const initialInput = firstSourcePostureModelInput(provider);
  expect(Object.hasOwn(initialInput, 'findings')).toBeFalse();
  expect(Object.hasOwn(initialInput, 'priority')).toBeFalse();
});

test('does not persist a recovered posture that references evidence outside its child scope', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-source-posture-overflow-'));
  await writeFile(join(targetRoot, 'a.unknown'), 'value = request.a;\n', 'utf8');
  await writeFile(join(targetRoot, 'b.unknown'), 'value = request.b;\n', 'utf8');
  const provider = new OverflowFirstObjectProvider();
  enqueueScopedSearch(provider, 'a-search');
  provider.enqueueObject(postureOutput('fact-source-b'));
  let persistedLeafCount = 0;

  const result = await runSourcePostureStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: SourcePostureRequestSchema.parse({
      vector: { ...vector(), scopeGlobs: ['*.unknown'] },
      availableSourcePaths: ['a.unknown', 'b.unknown'],
      evidenceMap: {
        facts: [sourceFact('fact-source-a', 'a.unknown'), sourceFact('fact-source-b', 'b.unknown')],
        unansweredPlanObligations: [],
        limitations: [],
      },
      limitations: [],
    }),
    context: [],
    sessionId: 'source-posture-stage-overflow-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
    overflowTopology: {
      phaseInputFingerprint: '0'.repeat(64),
      onTransition: async () => undefined,
      onRecoveredLeafCompleted: async () => {
        persistedLeafCount += 1;
      },
    },
  });

  expect(result).toMatchObject({ status: 'failed', errorCode: 'artifact-invalid' });
  expect(persistedLeafCount).toBe(0);
});

class OverflowFirstObjectProvider extends FakeModelProvider {
  private firstObjectCall = true;

  public override async object<T extends JsonValue>(
    request: ObjectRequest<T>,
  ): Promise<ObjectResponse<T>> {
    if (this.firstObjectCall) {
      this.firstObjectCall = false;
      throw new ModelError('The provider rejected the context.', {
        provider: 'test',
        model: 'test-model',
        method: 'object',
        reason: 'context_length_exceeded',
      });
    }
    return super.object(request);
  }
}

function enqueueScopedSearch(provider: FakeModelProvider, id: string): void {
  provider.enqueueObject({
    object: {},
    toolCalls: [
      {
        id,
        name: 'repo_grep',
        arguments: { pattern: 'value', mode: 'literal', caseSensitive: true },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  });
}

function postureOutput(factId: string) {
  return {
    object: {
      assessments: [
        {
          assessmentId: 'posture-test-obligation-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-contradicted',
          summary: 'The scoped evidence contradicts the risk-positive obligation.',
          evidenceMapFactIds: [factId],
          limitations: [],
        },
      ],
      limitations: [],
    },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop' as const,
  };
}

function sourceFact(factId: string, path: string) {
  return {
    factId,
    role: 'operation' as const,
    evidence: [{ path, startLine: 1, contentDigest: 'a'.repeat(64), kind: 'source' as const }],
    planObligations: [{ obligationId: 'test-obligation-01' }],
  };
}

/** Test-only inspection of in-memory provider input; it is never persisted or logged. */
function firstSourcePostureModelInput(provider: FakeModelProvider) {
  const request = provider.requests[0];
  if (request === undefined)
    throw new Error('The posture stage did not make an initial model request.');
  if (!('messages' in request))
    throw new Error('The posture stage made a non-message model request.');
  const message = request.messages.find((entry) => entry.role === 'user');
  if (message === undefined || typeof message.content !== 'string') {
    throw new Error('The posture stage did not send a JSON user input.');
  }
  return SourcePostureModelInputSchema.parse(JSON.parse(message.content));
}

function vector() {
  return {
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
  };
}
