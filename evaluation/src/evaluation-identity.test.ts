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
  planProfile: 'audit-reviewed-plan' as const,
  executionBudget: {
    modelTimeoutMs: 120_000,
    runTimeoutMs: 150_000,
    modelRetry: 'default' as const,
  },
  maxParallelVectors: 1,
  promptProtocolFingerprint: 'b'.repeat(64),
  semanticPlanEvaluator: null,
};

test('binds the benchmark protocol to exact source population, evaluator fixtures, and execution configuration', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
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
  const changedAnswerKeyPack = {
    ...pack,
    cases: pack.cases.map((loaded) =>
      loaded.case.caseId === 'ossf-cve-2018-16492'
        ? {
            ...loaded,
            answerKey: {
              ...loaded.answerKey,
              notes: `${loaded.answerKey.notes} Updated evaluator-only calibration note.`,
            },
          }
        : loaded,
    ),
  };
  expect(
    evaluationBenchmarkProtocolFingerprint({
      pack: changedAnswerKeyPack,
      ...baseInput,
    }),
  ).not.toBe(protocol);
  const changedReviewedPlanPack = {
    ...pack,
    cases: pack.cases.map((loaded) =>
      loaded.case.caseId === 'ossf-cve-2018-16492'
        ? {
            ...loaded,
            reviewedPlan: {
              ...loaded.reviewedPlan,
              vectors: loaded.reviewedPlan.vectors.map((vector, index) =>
                index === 0
                  ? { ...vector, rationale: `${vector.rationale} Updated evaluator fixture.` }
                  : vector,
              ),
            },
          }
        : loaded,
    ),
  };
  expect(
    evaluationBenchmarkProtocolFingerprint({
      pack: changedReviewedPlanPack,
      ...baseInput,
    }),
  ).not.toBe(protocol);
  expect(
    evaluationBenchmarkProtocolFingerprint({
      pack: changedReviewedPlanPack,
      ...baseInput,
      planProfile: 'planning-generated',
    }),
  ).toBe(
    evaluationBenchmarkProtocolFingerprint({
      pack,
      ...baseInput,
      planProfile: 'planning-generated',
    }),
  );
});
