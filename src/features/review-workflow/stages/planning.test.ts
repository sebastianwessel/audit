import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';
import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/audit-harness.js';
import { PlanModelInputSchema, PlanModelRequestSchema } from '../agents/planning/contract.js';
import { runPlanningStage } from './planning.js';

test('creates a source-inspected business-level draft for an unknown-language source file', async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), 'audit-planning-stage-'));
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
          title: 'Review tenant data isolation',
          rationale: 'The surrounding architecture identifies a tenant-boundary obligation.',
          enabled: true,
          scopeGlobs: ['reviewed.unknown'],
          reviewObligations: [
            {
              obligationId: 'tenant-boundary-01',
              riskStatement: 'Tenant-scoped data could be exposed outside its intended boundary.',
              evidenceRequirement: 'Inspect the scoped source that receives tenant-bound input.',
            },
          ],
          limitations: [],
        },
      ],
      additionalObservations: [
        {
          observationId: 'review-session-boundary',
          title: 'Review session-boundary propagation',
          rationale: 'A human may choose to extend the executable plan to this boundary.',
          scopeGlobs: ['reviewed.unknown'],
          reviewObligations: [
            {
              obligationId: 'session-boundary-01',
              riskStatement: 'A session boundary may not preserve caller identity.',
              evidenceRequirement: 'Inspect session creation and identity propagation.',
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
    request: PlanModelRequestSchema.parse({
      targetFingerprint: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      targetDisplayName: 'unknown-language fixture',
      inventorySummary: { fileCount: 1, totalBytes: 22, languageHints: [] },
      sourcePaths: ['reviewed.unknown'],
      context: [
        {
          path: 'context/architecture.md',
          title: 'Tenant architecture',
          kind: 'architecture',
          sensitivity: 'internal',
          appliesTo: ['reviewed.unknown'],
          body: 'Requests are expected to remain within a tenant boundary.',
          digest: 'c'.repeat(64),
        },
      ],
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
    output: {
      vectors: [{ scopeGlobs: ['reviewed.unknown'], title: 'Review tenant data isolation' }],
      additionalObservations: [{ observationId: 'review-session-boundary' }],
    },
    modelObservation: {
      stage: 'planning',
      status: 'completed',
      usage: { modelCallCount: 2 },
      toolUsage: { successfulGrepFilesCallCount: 1 },
    },
  });

  const initialInput = firstPlannerModelInput(provider);
  expect(initialInput).toMatchObject({
    sourcePaths: ['reviewed.unknown'],
    inspectionRequirement: {
      required: true,
      allowedToolIds: ['repo_read', 'repo_grep'],
    },
  });
  expect(initialInput.context).toMatchObject([
    { path: 'context/architecture.md', kind: 'architecture', appliesTo: ['reviewed.unknown'] },
  ]);
  expect(Object.hasOwn(initialInput, 'findings')).toBeFalse();
  expect(Object.hasOwn(initialInput, 'answerKey')).toBeFalse();
  expect(JSON.stringify(initialInput)).not.toContain('value = request.input');
});

/** Test-only projection of the first model input; it never persists or logs the request. */
function firstPlannerModelInput(provider: FakeModelProvider) {
  const request = provider.requests[0];
  if (request === undefined) throw new Error('The planner did not make an initial model request.');
  if (!('messages' in request)) throw new Error('The planner made a non-message model request.');
  const message = request.messages.find((entry) => entry.role === 'user');
  if (message === undefined || typeof message.content !== 'string') {
    throw new Error('The planner did not send a JSON user input.');
  }
  return PlanModelInputSchema.parse(JSON.parse(message.content));
}
