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
import { CandidateGroundingRequestSchema } from '../../audit-execution/candidate-grounding/contract.js';
import { createSourceEvidenceResolver } from '../../audit-execution/source-evidence-resolver.js';
import { createSourceSnapshot } from '../../target-inventory/source-snapshot.js';

import { runCandidateGroundingStage } from './candidate-grounding.js';

test('recovers one complete seed basis per source child without duplicate outcomes', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-grounding-overflow-'));
  await writeFile(join(targetRoot, 'a.unknown'), 'value = request.a;\n', 'utf8');
  await writeFile(join(targetRoot, 'b.unknown'), 'value = request.b;\n', 'utf8');
  const provider = new OverflowFirstObjectProvider();
  enqueueScopedSearch(provider, 'a-search');
  provider.enqueueObject(nullGroundingOutput('seed-a'));
  enqueueScopedSearch(provider, 'b-search');
  provider.enqueueObject(nullGroundingOutput('seed-b'));

  const result = await runCandidateGroundingStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: request(['seed-a', 'seed-b']),
    sourceEvidence: evidenceFor([
      { path: 'a.unknown', content: 'value = request.a;\n', languageHint: null },
      { path: 'b.unknown', content: 'value = request.b;\n', languageHint: null },
    ]),
    context: [],
    sessionId: 'candidate-grounding-overflow-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    status: 'completed',
    output: {
      groundings: [
        { seedId: 'seed-a', disposition: 'no-source-backed-candidate' },
        { seedId: 'seed-b', disposition: 'no-source-backed-candidate' },
      ],
    },
    modelObservation: { recoveredErrorCodes: ['provider-context-overflow'] },
  });
});

test('fails explicitly when a seed crosses recovered source children', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-grounding-cross-scope-'));
  await writeFile(join(targetRoot, 'a.unknown'), 'value = request.a;\n', 'utf8');
  await writeFile(join(targetRoot, 'b.unknown'), 'value = request.b;\n', 'utf8');
  const provider = new OverflowFirstObjectProvider();

  const result = await runCandidateGroundingStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: request(['seed-cross']),
    sourceEvidence: evidenceFor([
      { path: 'a.unknown', content: 'value = request.a;\n', languageHint: null },
      { path: 'b.unknown', content: 'value = request.b;\n', languageHint: null },
    ]),
    context: [],
    sessionId: 'candidate-grounding-cross-scope-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({ status: 'failed', errorCode: 'provider-context-overflow' });
});

test('retries an unbindable candidate output in the same scoped source basis', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-grounding-validation-retry-'));
  await writeFile(join(targetRoot, 'a.unknown'), 'value = request.a;\n', 'utf8');
  await writeFile(join(targetRoot, 'b.unknown'), 'value = request.b;\n', 'utf8');
  const provider = new FakeModelProvider();
  enqueueScopedSearch(provider, 'invalid-grounding-inspection');
  provider.enqueueObject({
    object: {
      groundings: [
        {
          candidate: {
            statement: 'The selected map evidence supports a candidate.',
            claimEvidenceBundles: [
              {
                role: 'operation',
                explanation: 'The operation is selected from the map.',
                selections: [{ factId: 'fact-a', evidenceIndex: 9 }],
              },
              {
                role: 'unsafe-condition',
                explanation: 'The condition is selected from the map.',
                selections: [{ factId: 'fact-a', evidenceIndex: 0 }],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop',
  });
  enqueueScopedSearch(provider, 'repaired-grounding-inspection');
  provider.enqueueObject(nullGroundingOutput('seed-a'));

  const result = await runCandidateGroundingStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: request(['seed-a']),
    sourceEvidence: evidenceFor([
      { path: 'a.unknown', content: 'value = request.a;\n', languageHint: null },
      { path: 'b.unknown', content: 'value = request.b;\n', languageHint: null },
    ]),
    context: [],
    sessionId: 'candidate-grounding-validation-retry-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'default' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    status: 'completed',
    output: {
      groundings: [{ seedId: 'seed-a', disposition: 'no-source-backed-candidate' }],
    },
    modelObservation: {
      recoveredErrorCodes: ['provider-response-invalid'],
      toolUsage: { grepFilesCallCount: 2 },
    },
  });
  expect(provider.requests).toHaveLength(4);
});

function evidenceFor(
  sources: readonly { path: string; content: string; languageHint: string | null }[],
) {
  return createSourceEvidenceResolver({
    sourceSnapshot: createSourceSnapshot(sources),
    sourcePaths: sources.map((source) => source.path),
  });
}

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

function nullGroundingOutput(_seedId: string) {
  return {
    object: {
      groundings: [{ candidate: null, nullReason: 'no-source-backed-candidate' }],
    },
    usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    finishReason: 'stop' as const,
  };
}

function request(seedIds: readonly string[]) {
  const seeds = seedIds.map((seedId) => {
    const factIds =
      seedId === 'seed-a' ? ['fact-a'] : seedId === 'seed-b' ? ['fact-b'] : ['fact-a', 'fact-b'];
    return {
      seedId,
      vectorId: 'vector-unknown-01',
      hypothesis: 'The mapped operation could mishandle request-controlled data.',
      planObligations: [{ obligationId: 'test-obligation-01' }],
      evidenceMapFactIds: factIds,
      sourcePostureAssessmentIds: [
        seedId === 'seed-a' ? 'posture-a' : seedId === 'seed-b' ? 'posture-b' : 'posture-cross',
      ],
      limitations: [],
    };
  });
  return CandidateGroundingRequestSchema.parse({
    vector: {
      vectorId: 'vector-unknown-01',
      vectorDigest: 'a'.repeat(64),
      title: 'Review bounded source',
      rationale: 'Review the approved source for security weaknesses.',
      enabled: true,
      scopeGlobs: ['*.unknown'],
      reviewObligations: [
        {
          obligationId: 'test-obligation-01',
          riskStatement: 'The approved source could expose request-controlled data.',
          evidenceRequirement: 'Any claim is source-backed and inside the approved scope.',
        },
      ],
      limitations: [],
    },
    availableSourcePaths: ['a.unknown', 'b.unknown'],
    evidenceMap: {
      facts: [sourceFact('fact-a', 'a.unknown'), sourceFact('fact-b', 'b.unknown')],
      unansweredPlanObligations: [],
      limitations: [],
    },
    sourcePosture: {
      assessments: [
        {
          assessmentId: 'posture-a',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-a'],
          limitations: [],
        },
        {
          assessmentId: 'posture-b',
          obligationId: 'test-obligation-02',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-b'],
          limitations: [],
        },
        {
          assessmentId: 'posture-cross',
          obligationId: 'test-obligation-03',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-a', 'fact-b'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    seeds,
  });
}

function sourceFact(factId: string, path: string) {
  return {
    factId,
    role: 'operation' as const,
    evidence: [{ path, startLine: 1, contentDigest: 'a'.repeat(64), kind: 'source' as const }],
    planObligations: [{ obligationId: 'test-obligation-01' }],
  };
}
