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
import { runDeveloperGuidanceStage } from './developer-guidance.js';

test('marks developer guidance incomplete when overflow cannot be recovered without persisting advice', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-guidance-overflow-'));
  await writeFile(join(targetRoot, 'a.unknown'), 'value = request.input;\n', 'utf8');
  await writeFile(join(targetRoot, 'b.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new OverflowFirstObjectProvider();

  const result = await runDeveloperGuidanceStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: request(['a.unknown', 'b.unknown']),
    context: [],
    sessionId: 'guidance-overflow-001',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    status: 'failed',
    errorCode: 'provider-context-overflow',
    modelObservation: {
      recoveredErrorCodes: ['provider-context-overflow'],
      toolUsage: { successfulGrepFilesCallCount: 0 },
    },
  });
  expect(provider.requests).toHaveLength(0);
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

function request(availableSourcePaths: string[]) {
  return {
    guidanceId: 'guidance-001',
    finding: {
      findingId: 'finding-001',
      vectorId: 'vector-001',
      narrative: {
        statement: 'The reviewed operation may be reached with an unsafe condition.',
        roleExplanations: [
          {
            role: 'operation' as const,
            explanation: 'The operation evidence identifies the action.',
          },
          {
            role: 'unsafe-condition' as const,
            explanation: 'The condition evidence identifies the unsafe state.',
          },
        ],
        limitations: [],
      },
      claimEvidenceBundles: [
        {
          role: 'operation' as const,
          evidence: [
            {
              path: 'a.unknown',
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
              path: 'a.unknown',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source' as const,
              role: 'unsafe-condition' as const,
            },
          ],
        },
      ],
      planObligations: [{ obligationId: 'obligation-001' }],
      status: 'accepted' as const,
      verification: { status: 'verified' as const, checks: ['scope' as const] },
    },
    vector: {
      vectorId: 'vector-001',
      vectorDigest: 'b'.repeat(64),
      title: 'Reviewed boundary',
      rationale: 'Review the approved source boundary.',
      enabled: true,
      scopeGlobs: ['*.unknown'],
      reviewObligations: [
        {
          obligationId: 'obligation-001',
          riskStatement: 'The boundary could expose protected operations.',
          evidenceRequirement: 'Inspect the source-backed operation and controls.',
        },
      ],
      limitations: [],
    },
    availableSourcePaths,
    context: [],
  };
}
