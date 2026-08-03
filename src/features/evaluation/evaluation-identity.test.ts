import { expect, test } from 'bun:test';

import { loadCorpusPack } from './corpus.js';
import {
  evaluationBenchmarkProtocolFingerprint,
  evaluationPopulationDigest,
} from './evaluation-identity.js';

const baseInput = {
  split: 'development' as const,
  mode: 'provider' as const,
  provider: 'openai',
  model: 'fixture-model',
  verificationMode: 'same-route' as const,
  verificationRouteFingerprint: 'a'.repeat(64),
  repetitions: 5,
  planProfile: 'reviewed-plan' as const,
  measurementScope: 'full-workflow' as const,
  executionBudget: {
    modelTimeoutMs: 120_000,
    runTimeoutMs: 150_000,
    modelRetry: 'default' as const,
  },
  maxParallelVectors: 1,
  promptProtocolFingerprint: 'b'.repeat(64),
};

test('binds the benchmark protocol to exact source population and execution configuration', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
  const allPopulation = evaluationPopulationDigest({ pack, split: 'development' });
  const selectedPopulation = evaluationPopulationDigest({
    pack,
    split: 'development',
    caseIdFilter: 'ossf-cve-2018-16492',
  });
  expect(selectedPopulation).not.toBe(allPopulation);
  const protocol = evaluationBenchmarkProtocolFingerprint({ pack, ...baseInput });
  expect(
    evaluationBenchmarkProtocolFingerprint({
      pack,
      ...baseInput,
      maxParallelVectors: 2,
    }),
  ).not.toBe(protocol);
  expect(
    evaluationBenchmarkProtocolFingerprint({
      pack,
      ...baseInput,
      caseIdFilter: 'ossf-cve-2018-16492',
    }),
  ).not.toBe(protocol);
});
