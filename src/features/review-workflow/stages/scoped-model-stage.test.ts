import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelError } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';

import { createJailedReadOnlyFilesystem } from '../../../platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../../platform/harness/security-reviewer-harness.js';
import type { ContextOverflowTopologyEvent } from '../runtime/context-overflow.js';

import { runScopedModelStage } from './scoped-model-stage.js';

const contextOverflow = () =>
  new ModelError('The provider rejected the context.', {
    provider: 'test',
    model: 'test-model',
    method: 'object',
    reason: 'context_length_exceeded',
  });

test('recovers a provider-signalled context overflow through the real scoped stage lifecycle', async () => {
  const targetRoot = await createTarget();
  const calls: string[][] = [];
  const topology: ContextOverflowTopologyEvent[] = [];
  const result = await runScopedModelStage<string[]>({
    stage: 'evidence-mapping',
    route: 'primary',
    stageId: 'overflow-stage-01',
    modelProvider: new FakeModelProvider(),
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    availableSourcePaths: ['b.unknown', 'a.unknown'],
    context: [],
    sessionId: 'overflow-stage-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
    overflowTopology: {
      onTransition: async (event) => {
        topology.push(event);
      },
    },
    invoke: async (_session, _attempt, scope) => {
      calls.push([...scope.sourcePaths]);
      if (calls.length === 1) throw contextOverflow();
      return [...scope.sourcePaths];
    },
    reduceRecoveredOutputs: (leaves) => leaves.flatMap((leaf) => leaf.output),
  });

  expect(result).toMatchObject({
    status: 'completed',
    output: ['a.unknown', 'b.unknown'],
    modelObservation: {
      recoveredErrorCodes: ['provider-context-overflow'],
      usage: { modelCallCount: 0 },
    },
  });
  expect(calls).toEqual([['a.unknown', 'b.unknown'], ['a.unknown'], ['b.unknown']]);
  expect(topology.map((event) => `${event.childKey}:${event.attempt}:${event.state}`)).toEqual([
    'root:1:pending',
    'root:1:running',
    'root:1:overflowed',
    'root/left:1:pending',
    'root/left:1:running',
    'root/left:1:completed',
    'root/right:1:pending',
    'root/right:1:running',
    'root/right:1:completed',
  ]);
  expect(
    topology.filter((event) => event.state === 'completed').map((event) => event.modelObservation),
  ).toMatchObject([
    { stage: 'evidence-mapping', status: 'completed', toolUsage: { toolCallCount: 0 } },
    { stage: 'evidence-mapping', status: 'completed', toolUsage: { toolCallCount: 0 } },
  ]);
});

test('retries a transient stage invocation without expanding its approved scope', async () => {
  const targetRoot = await createTarget();
  const calls: string[][] = [];
  const result = await runScopedModelStage<string>({
    stage: 'investigation',
    route: 'primary',
    stageId: 'retry-stage-01',
    modelProvider: new FakeModelProvider(),
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    availableSourcePaths: ['a.unknown', 'b.unknown'],
    context: [],
    sessionId: 'retry-stage-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'default' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
    invoke: async (_session, _attempt, scope) => {
      calls.push([...scope.sourcePaths]);
      if (calls.length === 1) throw new Error('transient provider failure');
      return 'recovered';
    },
  });

  expect(result).toMatchObject({
    status: 'completed',
    output: 'recovered',
    modelObservation: { recoveredErrorCodes: ['provider-failure'] },
  });
  expect(calls).toEqual([
    ['a.unknown', 'b.unknown'],
    ['a.unknown', 'b.unknown'],
  ]);
});

test('fails closed when a source-deciding planning stage returns without reading or searching source', async () => {
  const targetRoot = await createTarget();
  const result = await runScopedModelStage<string>({
    stage: 'planning',
    route: 'primary',
    stageId: 'planning-inspection-required-01',
    modelProvider: new FakeModelProvider(),
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot }),
    availableSourcePaths: ['a.unknown'],
    context: [],
    sessionId: 'planning-inspection-required-01',
    modelName: undefined,
    harnessExecution: HarnessExecutionConfigurationSchema.parse({ modelRetry: 'disabled' }),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
    requireScopedSourceInspection: true,
    invoke: async () => 'uninspected draft',
  });

  expect(result).toMatchObject({
    status: 'failed',
    errorCode: 'coverage-incomplete',
    modelObservation: { status: 'failed', usage: { modelCallCount: 0 } },
  });
});

async function createTarget(): Promise<string> {
  const targetRoot = await mkdtemp(join(tmpdir(), 'security-reviewer-scoped-stage-'));
  await writeFile(join(targetRoot, 'a.unknown'), 'a\n', 'utf8');
  await writeFile(join(targetRoot, 'b.unknown'), 'b\n', 'utf8');
  return targetRoot;
}
