import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelProvider } from '@purista/harness/testing';

import { createJailedReadOnlyFilesystem } from '../../src/platform/filesystem/index.js';
import { HarnessExecutionConfigurationSchema } from '../../src/platform/harness/audit-harness.js';
import { buildStageIsolatedCanonicalInput, runStageIsolatedEvaluation } from './stage-isolated.js';
import { StageIsolatedEvaluationStagePackSchema } from './stage-isolated.schema.js';
import { stageIsolatedRubricFingerprint } from './stage-isolated-adjudication-agent.contract.js';

test('runs the no-tools semantic evaluator only after the closed planning stage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stage-isolated-'));
  await writeFile(join(root, 'reviewed.unknown'), 'value = request.input;\n', 'utf8');
  const product = new FakeModelProvider();
  product.enqueueObject({
    object: {},
    toolCalls: [{ id: 'read-01', name: 'repo_read', arguments: { path: 'reviewed.unknown' } }],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'tool_calls',
  });
  product.enqueueObject({
    object: {
      vectors: [
        {
          title: 'Wrong reachable scope',
          rationale: 'Review a different boundary.',
          enabled: true,
          scopeGlobs: ['reviewed.unknown'],
          reviewObligations: [
            {
              riskStatement: 'The intended boundary must be reviewed.',
              evidenceRequirement: 'Inspect the scoped source.',
            },
          ],
          limitations: [],
        },
      ],
      additionalObservations: [],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const canonical = {
    stage: 'planning' as const,
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    request: {
      targetFingerprint: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      targetDisplayName: 'fixture',
      inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
      sourcePaths: ['reviewed.unknown'],
      context: [],
      createdAt: '2026-08-03T12:00:00.000Z',
    },
  };
  const rubric = {
    rubricId: 'rubric-01',
    stage: 'planning' as const,
    expectedOutcomes: [
      {
        expectedOutcomeId: 'outcome-01',
        objective: 'Review the intended boundary.',
        requiredRiskCondition: 'The required condition is considered.',
        evidenceRequirements: ['Compare scope intent.'],
        requiredRoles: [],
      },
    ],
  };
  const rubricFingerprint = stageIsolatedRubricFingerprint(rubric);
  const pack = StageIsolatedEvaluationStagePackSchema.parse({
    schemaVersion: 4,
    packId: 'stage-pack-01',
    stage: 'planning',
    corpusPackId: 'corpus-pack-01',
    corpusPackVersion: '1.0.0',
    corpusManifestFingerprint: 'c'.repeat(64),
    caseId: 'case-01',
    variant: 'vulnerable',
    repetition: 1,
    planProfile: 'planning-generated',
    corpusSourceDigest: 'c'.repeat(64),
    targetFingerprint: canonical.targetFingerprint,
    contextDigest: canonical.contextDigest,
    workflowProtocolFingerprint: 'd'.repeat(64),
    stageProtocolFingerprint: 'e'.repeat(64),
    evaluatorProtocolFingerprint: 'f'.repeat(64),
    provider: 'openai',
    model: 'fixture-product',
    route: 'primary',
    evaluatorProvider: 'openai',
    evaluatorModel: 'fixture-evaluator',
    evaluatorRoute: 'primary',
    productInput: {
      stage: 'planning',
      referenceId: 'stage-result-01',
      fingerprint: buildStageIsolatedCanonicalInput(canonical).fingerprint,
    },
    expectedOutcome: {
      privateReferenceId: 'rubric-01',
      fingerprint: rubricFingerprint,
      expectedOutcomeCount: 1,
    },
  });
  const evaluator = new FakeModelProvider();
  evaluator.enqueueObject({
    object: {
      expectedOutcomes: [
        {
          expectedOutcomeId: 'outcome-01',
          disposition: 'missing',
          productOutputIds: [],
          roleLocalizations: [],
        },
      ],
      unexpectedProductOutputIds: ['stage-output-5d5159267445bb8d'],
    },
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: 'stop',
  });
  const result = await runStageIsolatedEvaluation({
    pack,
    modelProvider: product,
    providerIdentity: 'openai',
    filesystem: await createJailedReadOnlyFilesystem({ targetRoot: root }),
    sessionId: 'stage-product-01',
    modelName: 'fixture-product',
    harnessExecution: HarnessExecutionConfigurationSchema.parse({}),
    modelCacheRoutingKey: undefined,
    modelPricing: {},
    cacheRoutingEnabled: false,
    canonicalInput: canonical,
    semanticEvaluator: {
      rubric: {
        ...rubric,
        rubricFingerprint,
      },
      modelProvider: evaluator,
      providerIdentity: 'openai',
      modelName: 'fixture-evaluator',
      route: 'primary',
      harnessExecution: HarnessExecutionConfigurationSchema.parse({}),
      modelCacheRoutingKey: undefined,
      modelPricing: {},
      cacheRoutingEnabled: false,
    },
  });
  expect(result.completion.status).toBe('completed');
  expect(result.semanticOutcome.missingExpectedOutcomeIds).toEqual(['outcome-01']);
  expect(product.requests).toHaveLength(2);
  expect(evaluator.requests).toHaveLength(1);
  expect(JSON.stringify(evaluator.requests)).not.toContain('reviewed.unknown');
});
