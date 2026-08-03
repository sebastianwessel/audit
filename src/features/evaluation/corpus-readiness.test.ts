import { expect, test } from 'bun:test';

import { loadCorpusPack } from './corpus.js';
import {
  assessCorpusReadiness,
  deriveEvaluationEvidenceQualification,
  describeEvaluationEvidenceQualification,
} from './corpus-readiness.js';
import { CorpusReadinessReportSchema } from './corpus-readiness.schema.js';
import { renderCorpusReadinessReport } from './corpus-readiness-report.js';

test('keeps synthetic and semantic fixtures out of real-world reliability readiness', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
  const readiness = assessCorpusReadiness(pack, '2026-07-29T16:00:00.000Z');

  expect(readiness.counts.caseCount).toBe(4);
  expect(readiness.counts.realWorldCaseCount).toBe(1);
  expect(readiness.counts.realWorldPairedProjectCount).toBe(1);
  expect(readiness.counts.realWorldLanguageFamilyCount).toBe(1);
  expect(readiness.counts.realWorldDualReviewedPairedProjectCount).toBe(0);
  expect(readiness.counts.dualReviewedPatchedNegativeProjectCount).toBe(0);
  expect(readiness.counts.dualReviewedPrivateHoldoutRealWorldPairedProjectCount).toBe(0);
  expect(readiness.counts.dualReviewedRealWorldLanguageFamilyCount).toBe(0);
  expect(readiness.counts.coveredRequiredControlFamilyCount).toBe(0);
  expect(readiness.byControlFamily).toContainEqual({
    family: 'dynamic-state-ownership',
    realWorldPairedProjectCount: 1,
    dualReviewedRealWorldPairedProjectCount: 0,
  });
  expect(readiness.byControlFamily).toContainEqual({
    family: 'injection-outbound-boundary',
    realWorldPairedProjectCount: 0,
    dualReviewedRealWorldPairedProjectCount: 0,
  });
  expect(readiness.byEvidenceOrigin).toEqual([
    { key: 'real-world', caseCount: 1, projectCount: 1 },
    { key: 'semantic-regression', caseCount: 1, projectCount: 1 },
    { key: 'synthetic', caseCount: 2, projectCount: 2 },
  ]);
  expect(readiness.pilotReady).toBe(false);
  expect(readiness.reliabilityGateReady).toBe(false);
  expect(readiness.limitations).toContain(
    'dual-reviewed repository-disjoint real-world paired projects: 0/100; add 100 more.',
  );
  expect(renderCorpusReadinessReport(readiness)).toContain(
    'Provider reliability gate ready: **no**',
  );
  expect(renderCorpusReadinessReport(readiness)).toContain(
    '## Development control-family coverage',
  );
});

test('qualifies a run separately from its workflow finding gate', () => {
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness: { pilotReady: false, reliabilityGateReady: false },
    }),
  ).toBe('diagnostic');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness: { pilotReady: true, reliabilityGateReady: false },
    }),
  ).toBe('development-pilot');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'private-holdout',
      readiness: { pilotReady: true, reliabilityGateReady: true },
      holdoutAttestation: {
        attestationId: 'holdout-attestation-01',
        payloadDigest: 'a'.repeat(64),
        publicKeyFingerprint: 'b'.repeat(64),
        issuedAt: '2026-07-30T12:00:00.000Z',
      },
    }),
  ).toBe('private-holdout');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'private-holdout',
      readiness: { pilotReady: true, reliabilityGateReady: true },
    }),
  ).toBe('diagnostic');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'test',
      readiness: { pilotReady: true, reliabilityGateReady: true },
    }),
  ).toBe('diagnostic');
  expect(describeEvaluationEvidenceQualification(undefined)).toContain('not eligible');
});

test('retains complete readiness distributions and limitations beyond retired ceilings', async () => {
  const pack = await loadCorpusPack('evaluation/corpora');
  const readiness = assessCorpusReadiness(pack, '2026-08-03T12:00:00.000Z');
  const distributions = Array.from({ length: 129 }, (_, index) => ({
    key: `distribution-${String(index)}`,
    caseCount: 0,
    projectCount: 0,
  }));
  const limitations = Array.from({ length: 33 }, (_, index) => `limitation ${String(index)}`);
  const parsed = CorpusReadinessReportSchema.parse({
    ...readiness,
    byEvidenceOrigin: distributions,
    byLanguage: distributions,
    byDataset: distributions,
    limitations,
  });
  expect(parsed.byLanguage).toHaveLength(129);
  expect(parsed.limitations).toHaveLength(33);
});
