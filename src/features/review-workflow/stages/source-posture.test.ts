import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/security-reviewer-harness.js';
import { SourcePostureRequestSchema } from '../../audit-execution/phase-input/contract.js';

import { runSourcePostureStage } from './source-posture.js';

test('fails closed when a tool-guided posture completes without scoped source inspection', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'security-reviewer-source-posture-stage-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      assessments: [
        {
          assessmentId: 'posture-test-obligation-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-contradicted',
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
