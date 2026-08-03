import { expect, test } from 'bun:test';

import { compareEvaluationRuns, renderEvaluationRunComparison } from './comparison.js';
import { RealWorldEvaluationRunSchema } from './corpus.schema.js';

function providerRun(runId: string, promptProtocolFingerprint: string) {
  return RealWorldEvaluationRunSchema.parse({
    schemaVersion: 8,
    runId,
    packId: 'comparison-pack',
    packVersion: '1.0.0',
    corpusManifestDigest: 'b'.repeat(64),
    populationDigest: 'c'.repeat(64),
    benchmarkProtocolFingerprint: 'd'.repeat(64),
    mode: 'provider',
    provider: 'openai',
    model: 'test-model',
    verificationMode: 'same-route',
    verificationRouteFingerprint: 'a'.repeat(64),
    selectedSplit: 'development',
    findingCoverage: 'targeted',
    evidenceQualification: 'diagnostic',
    repetitions: 5,
    planProfile: 'reviewed-plan',
    executionBudget: {
      modelTimeoutMs: 20_000,
      runTimeoutMs: 30_000,
      modelRetry: 'default',
    },
    maxParallelVectors: 1,
    modelCostCeilingState: {
      configuredUsd: null,
      accumulatedEstimatedCostUsd: null,
      reached: false,
    },
    promptProtocolFingerprint,
    startedAt: '2026-07-29T12:00:00.000Z',
    finishedAt: '2026-07-29T12:00:01.000Z',
    trials: [
      {
        caseId: 'comparison-case',
        variant: 'vulnerable',
        repetition: 1,
        status: 'completed',
        reviewedPlanFingerprint: null,
        planScore: null,
        findingScore: {
          truePositives: 1,
          falsePositives: 0,
          falseNegatives: 0,
          findingPrecision: 1,
          findingRecall: 1,
          findingF1: 1,
          notApplicableExpectedFindingCount: 0,
          unnecessaryVectorCount: 0,
          matchedLocalizedCount: 1,
          matchedMislocalizedCount: 0,
          unmatchedAdjudicatedFalsePositiveCount: 0,
          unmatchedUnadjudicatedCount: 0,
          patchedMatchingFindingCount: 0,
          localizationAccuracy: 1,
          pairedPersistence: null,
        },
        planKeys: [],
        findingKeys: ['other\u0000high\u0000source.txt\u00001'],
        durationMs: 10,
        errorCode: null,
      },
    ],
    reliability: {
      completedTrials: 1,
      incompleteTrials: 0,
      failedTrials: 0,
      cancelledTrials: 0,
      completionRate: 1,
      planJaccard: null,
      findingJaccard: 1,
      findingRecallMedian: 1,
      findingRecallMinimum: 1,
      durationMsMedian: 10,
      durationMsP95: 10,
    },
    safetyViolations: 0,
    gatePassed: true,
  });
}

test('compares matching provider artifacts without model or source content', () => {
  const fingerprint = 'a'.repeat(64);
  const comparison = compareEvaluationRuns(
    providerRun('comparison-baseline', fingerprint),
    providerRun('comparison-candidate', fingerprint),
  );
  expect(comparison.comparable).toBe(true);
  expect(comparison.metrics?.truePositives.delta).toBe(0);
  expect(renderEvaluationRunComparison(comparison)).toContain('Comparable: yes');
});

test('rejects a comparison across evaluator-owned case selectors', () => {
  const fingerprint = 'a'.repeat(64);
  const baseline = providerRun('selector-baseline', fingerprint);
  const candidate = RealWorldEvaluationRunSchema.parse({
    ...providerRun('selector-candidate', fingerprint),
    caseIdFilter: 'different-case',
  });
  const comparison = compareEvaluationRuns(baseline, candidate);
  expect(comparison.comparable).toBe(false);
  expect(comparison.incompatibilities).toContain('Different case selector.');
});

test('rejects comparisons with a different corpus content, population, or protocol', () => {
  const fingerprint = 'a'.repeat(64);
  const baseline = providerRun('identity-baseline', fingerprint);

  const differences = [
    { field: 'corpusManifestDigest', incompatibility: 'Different corpus manifest.' },
    { field: 'populationDigest', incompatibility: 'Different selected corpus population.' },
    { field: 'benchmarkProtocolFingerprint', incompatibility: 'Different benchmark protocol.' },
  ] as const;
  for (const [index, difference] of differences.entries()) {
    const candidate = RealWorldEvaluationRunSchema.parse({
      ...providerRun(`identity-${index}`, fingerprint),
      [difference.field]: 'f'.repeat(64),
    });
    const comparison = compareEvaluationRuns(baseline, candidate);
    expect(comparison.comparable).toBe(false);
    expect(comparison.incompatibilities).toContain(difference.incompatibility);
  }
});

test('rejects a provider artifact that lacks a prompt identity', () => {
  const fingerprint = 'b'.repeat(64);
  const missingPromptProtocol = RealWorldEvaluationRunSchema.safeParse({
    ...providerRun('comparison-missing-prompt', fingerprint),
    promptProtocolFingerprint: undefined,
  });
  expect(missingPromptProtocol.success).toBe(false);
});

test('rejects comparison across verifier routes', () => {
  const baseline = providerRun('same-route', 'c'.repeat(64));
  const independent = RealWorldEvaluationRunSchema.parse({
    ...providerRun('independent-route', 'c'.repeat(64)),
    verificationMode: 'independent-route',
    verificationRouteFingerprint: 'd'.repeat(64),
  });
  const comparison = compareEvaluationRuns(baseline, independent);
  expect(comparison.comparable).toBe(false);
  expect(comparison.incompatibilities).toContain('Different verification mode.');
  expect(comparison.incompatibilities).toContain('Different verification route.');
});

test('rejects a private-holdout comparison when its steward attestation differs', () => {
  const fingerprint = 'd'.repeat(64);
  const baseline = RealWorldEvaluationRunSchema.parse({
    ...providerRun('holdout-baseline', fingerprint),
    selectedSplit: 'private-holdout',
    holdoutAttestation: {
      attestationId: 'holdout-attestation-01',
      payloadDigest: 'a'.repeat(64),
      publicKeyFingerprint: 'b'.repeat(64),
      issuedAt: '2026-07-30T12:00:00.000Z',
    },
  });
  const candidate = RealWorldEvaluationRunSchema.parse({
    ...baseline,
    runId: 'holdout-candidate',
    holdoutAttestation: {
      ...baseline.holdoutAttestation,
      payloadDigest: 'c'.repeat(64),
    },
  });
  const comparison = compareEvaluationRuns(baseline, candidate);
  expect(comparison.comparable).toBe(false);
  expect(comparison.incompatibilities).toContain('Different private-holdout attestation.');
});

test('compares a frozen same-route primary-model experiment without allowing an ensemble', () => {
  const baseline = providerRun('model-baseline', 'd'.repeat(64));
  const candidate = RealWorldEvaluationRunSchema.parse({
    ...providerRun('model-candidate', 'd'.repeat(64)),
    model: 'another-model',
    verificationRouteFingerprint: 'e'.repeat(64),
  });
  const comparison = compareEvaluationRuns(baseline, candidate, 'primary-model-experiment');
  expect(comparison.comparable).toBe(true);
  expect(comparison.kind).toBe('primary-model-experiment');

  const independent = RealWorldEvaluationRunSchema.parse({
    ...candidate,
    verificationMode: 'independent-route',
  });
  const invalid = compareEvaluationRuns(baseline, independent, 'primary-model-experiment');
  expect(invalid.comparable).toBe(false);
  expect(invalid.incompatibilities).toContain(
    'Primary-model experiments require same-route verification.',
  );
});

test('rejects comparison across vector-concurrency settings and rejects incomplete artifacts', () => {
  const fingerprint = 'e'.repeat(64);
  const baseline = providerRun('concurrency-one', fingerprint);
  const parallel = RealWorldEvaluationRunSchema.parse({
    ...providerRun('concurrency-two', fingerprint),
    maxParallelVectors: 2,
  });
  const changed = compareEvaluationRuns(baseline, parallel);
  expect(changed.comparable).toBe(false);
  expect(changed.incompatibilities).toContain('Different vector concurrency.');

  const missingConcurrency = RealWorldEvaluationRunSchema.safeParse({
    ...providerRun('concurrency-missing', fingerprint),
    maxParallelVectors: undefined,
  });
  expect(missingConcurrency.success).toBe(false);
});

test('rejects comparison across finding-label coverage classes', () => {
  const fingerprint = 'f'.repeat(64);
  const baseline = providerRun('targeted-baseline', fingerprint);
  const exhaustive = RealWorldEvaluationRunSchema.parse({
    ...providerRun('exhaustive-candidate', fingerprint),
    findingCoverage: 'exhaustive',
  });
  const comparison = compareEvaluationRuns(baseline, exhaustive);
  expect(comparison.comparable).toBe(false);
  expect(comparison.incompatibilities).toContain('Different finding-label coverage.');
});
