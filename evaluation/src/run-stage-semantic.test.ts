import { expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelError } from '@purista/harness';
import { FakeModelProvider } from '@purista/harness/testing';

import { RuntimeConfigurationSchema } from '../../src/platform/configuration/environment.js';
import {
  createStageSemanticEvaluatorPack,
  runStageSemanticEvaluation,
} from './run-stage-semantic.js';
import {
  stageIsolatedProductOutputFingerprint,
  stageIsolatedRubricFingerprint,
} from './stage-isolated-adjudication-agent.contract.js';
import type { StageSemanticEvaluatorPack } from './stage-semantic-pack.schema.js';

const evaluatorPack = (): StageSemanticEvaluatorPack => {
  const rubric = {
    rubricId: 'rubric-01',
    stage: 'planning' as const,
    expectedOutcomes: [
      {
        expectedOutcomeId: 'expected-01',
        objective: 'Review the stated boundary.',
        requiredRiskCondition: 'The stated condition is assessed.',
        evidenceRequirements: ['Compare the source-free product claim.'],
        requiredRoles: [],
      },
    ],
  };
  const rubricFingerprint = stageIsolatedRubricFingerprint(rubric);
  const productStageOutput = {
    stage: 'planning' as const,
    stageResultId: 'product-result-01',
    outputs: [
      { productOutputId: 'product-output-01', semanticClaim: 'A reviewed boundary exists.' },
    ],
    roleLocalizations: [],
  };
  return createStageSemanticEvaluatorPack({
    schemaVersion: 1,
    pack: {
      schemaVersion: 4,
      packId: 'stage-pack-01',
      stage: 'planning',
      corpusPackId: 'corpus-pack-01',
      corpusPackVersion: '1.0.0',
      corpusManifestFingerprint: 'a'.repeat(64),
      caseId: 'case-01',
      variant: 'vulnerable',
      repetition: 1,
      planProfile: 'planning-generated',
      corpusSourceDigest: 'b'.repeat(64),
      targetFingerprint: 'c'.repeat(64),
      contextDigest: 'c'.repeat(64),
      workflowProtocolFingerprint: 'd'.repeat(64),
      stageProtocolFingerprint: 'e'.repeat(64),
      evaluatorProtocolFingerprint: 'f'.repeat(64),
      provider: 'openai',
      model: 'gpt-4o-mini',
      route: 'primary',
      evaluatorProvider: 'openai',
      evaluatorModel: 'gpt-4o-mini',
      evaluatorRoute: 'primary',
      productInput: {
        stage: 'planning',
        referenceId: 'product-result-01',
        fingerprint: '2'.repeat(64),
      },
      expectedOutcome: {
        privateReferenceId: 'rubric-01',
        fingerprint: rubricFingerprint,
        expectedOutcomeCount: 1,
      },
    },
    canonicalInputFingerprint: '2'.repeat(64),
    rubric: {
      ...rubric,
      rubricFingerprint,
    },
    productStageOutput: {
      ...productStageOutput,
      stageResultFingerprint: stageIsolatedProductOutputFingerprint(productStageOutput),
    },
  });
};

function runtime() {
  return {
    configuration: RuntimeConfigurationSchema.parse({
      provider: 'openai',
      model: 'gpt-4o-mini',
      publicArtifactDirectory: '.audit-artifacts',
      privateWorkDirectory: '.audit-work',
      evaluationCorpusRoot: 'evaluation/data/corpora',
      evaluationOutputRoot: 'evaluation/runs',
      maxParallelVectors: 1,
      modelPricing: {},
      verificationMode: 'same-route',
    }),
    environment: {},
  };
}

test('rejects missing and malformed command inputs before provider construction', async () => {
  await expect(runStageSemanticEvaluation([])).rejects.toThrow('Invalid stage-semantic');
  await expect(
    runStageSemanticEvaluation(['--pack', '/missing', '--output', '/tmp/stage-semantic'], {
      loadPack: async () => {
        throw new Error('not reached');
      },
      loadRuntimeConfiguration: async () => runtime(),
    }),
  ).rejects.toThrow('not reached');
});

test('validates the selected evaluator transport before reading an evaluator pack', async () => {
  const source = await readFile(new URL('./run-stage-semantic.ts', import.meta.url), 'utf8');
  expect(source.indexOf('assertLiveHarnessStructuredOutputCompatibility({')).toBeLessThan(
    source.indexOf('loadStageSemanticEvaluatorPack)'),
  );
});

test('rejects a semantic pack whose canonical-input fingerprint differs from its sealed reference', () => {
  const pack = evaluatorPack();
  expect(() =>
    createStageSemanticEvaluatorPack({
      ...pack,
      canonicalInputFingerprint: 'f'.repeat(64),
    }),
  ).toThrow('canonical input');
});

test('writes only source-free checkpoint/report projections and reuses a completed exact checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stage-semantic-command-'));
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      expectedOutcomes: [
        {
          expectedOutcomeId: 'expected-01',
          disposition: 'missing',
          productOutputIds: [],
          roleLocalizations: [],
        },
      ],
      unexpectedProductOutputIds: ['product-output-01'],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const pack = evaluatorPack();
  const options = ['--pack', 'private-stage-pack.json', '--output', root];
  await expect(
    runStageSemanticEvaluation(options, {
      loadPack: async () => pack,
      loadRuntimeConfiguration: async () => runtime(),
      modelProvider: provider,
      now: () => '2026-08-03T12:00:00.000Z',
    }),
  ).resolves.toBe(0);
  expect(provider.requests).toHaveLength(1);
  const checkpoint = await readFile(
    join(root, 'stage-semantic/stage-pack-01.checkpoint.json'),
    'utf8',
  );
  const report = await readFile(join(root, 'stage-semantic/stage-pack-01.json'), 'utf8');
  expect(checkpoint).not.toContain('A reviewed boundary exists.');
  expect(report).not.toContain('product-output-01');
  expect(report).not.toContain('expected-01');

  await expect(
    runStageSemanticEvaluation(options, {
      loadPack: async () => pack,
      loadRuntimeConfiguration: async () => runtime(),
      now: () => '2026-08-03T12:00:01.000Z',
    }),
  ).resolves.toBe(0);
  expect(provider.requests).toHaveLength(1);
});

test('rejects a changed evaluator-private binding before provider construction on resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stage-semantic-binding-'));
  const pack = evaluatorPack();
  const provider = new FakeModelProvider();
  provider.enqueueObject({
    object: {
      expectedOutcomes: [
        {
          expectedOutcomeId: 'expected-01',
          disposition: 'missing',
          productOutputIds: [],
          roleLocalizations: [],
        },
      ],
      unexpectedProductOutputIds: ['product-output-01'],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const options = ['--pack', 'private-stage-pack.json', '--output', root];
  await runStageSemanticEvaluation(options, {
    loadPack: async () => pack,
    loadRuntimeConfiguration: async () => runtime(),
    modelProvider: provider,
  });
  const changed = createStageSemanticEvaluatorPack({
    ...pack,
    pack: {
      ...pack.pack,
      productInput: { ...pack.pack.productInput, fingerprint: '4'.repeat(64) },
    },
    canonicalInputFingerprint: '4'.repeat(64),
  });
  await expect(
    runStageSemanticEvaluation([...options, '--resume', 'true'], {
      loadPack: async () => changed,
      loadRuntimeConfiguration: async () => runtime(),
    }),
  ).rejects.toThrow('does not match the sealed evaluator pack');
  expect(provider.requests).toHaveLength(1);
});

test('persists an opt-in source-free diagnostic for an isolated evaluator provider failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stage-semantic-diagnostic-'));
  const provider = new FakeModelProvider();
  provider.object = async () => {
    throw new ModelError('source text must never persist', {
      provider: 'openai',
      model: 'gpt-4o-mini',
      method: 'object',
      reason: 'http_error',
      status: 400,
      providerCode: 'invalid_json_schema',
      providerMessage: 'source text must never persist',
    });
  };
  await expect(
    runStageSemanticEvaluation(
      ['--pack', 'private-stage-pack.json', '--output', root, '--debug-diagnostics', 'true'],
      {
        loadPack: async () => evaluatorPack(),
        loadRuntimeConfiguration: async () => runtime(),
        modelProvider: provider,
        now: () => '2026-08-04T12:00:00.000Z',
      },
    ),
  ).resolves.toBe(3);

  const diagnosticsDirectory = join(root, 'stage-semantic', 'stage-pack-01.work', 'diagnostics');
  const files = await readdir(diagnosticsDirectory);
  expect(files).toHaveLength(1);
  const diagnosticFile = files[0];
  if (diagnosticFile === undefined) throw new Error('Expected one evaluator diagnostic.');
  const diagnostic = await readFile(join(diagnosticsDirectory, diagnosticFile), 'utf8');
  expect(diagnostic).toContain('provider-http-error');
  expect(diagnostic).not.toContain('source text must never persist');
});
