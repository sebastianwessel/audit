import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/security-reviewer-harness.js';
import { PlanModelInputSchema } from '../agents/planning/contract.js';
import { runPlanningStage } from './planning.js';

test('creates a source-inspected draft for an unknown-language source file', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'security-reviewer-planning-stage-'));
  await writeFile(join(targetRoot, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {},
    toolCalls: [
      {
        id: 'planning-source-inspection',
        name: 'repo_grep',
        arguments: {
          pattern: 'request',
          mode: 'identifier',
          caseSensitive: true,
        },
      },
    ],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  });
  provider.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Review request handling',
          rationale: 'The source accepts a request value.',
          enabled: true,
          scopeGlobs: ['reviewed.unknown'],
          reviewObligations: [
            {
              obligationId: 'request-handling-01',
              riskStatement: 'The request value could require a security review.',
              evidenceRequirement: 'Inspect the request handling source.',
            },
          ],
          limitations: [],
        },
      ],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });

  const result = await runPlanningStage({
    modelProvider: provider,
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    request: PlanModelInputSchema.parse({
      targetFingerprint: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      targetDisplayName: 'unknown-language fixture',
      inventorySummary: { fileCount: 1, totalBytes: 22, languageHints: [] },
      sourcePaths: ['reviewed.unknown'],
      context: [],
      createdAt: '2026-08-03T12:00:00.000Z',
    }),
    sessionId: 'planning-stage-unknown-language-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
  });

  expect(result).toMatchObject({
    status: 'completed',
    output: { vectors: [{ scopeGlobs: ['reviewed.unknown'] }] },
    modelObservation: {
      stage: 'planning',
      status: 'completed',
      usage: { modelCallCount: 2 },
      toolUsage: { successfulGrepFilesCallCount: 1 },
    },
  });
});
