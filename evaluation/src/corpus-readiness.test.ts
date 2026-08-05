import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

import { sha256 } from '../../src/shared/contracts/core.js';
import { type LoadedCorpusPack, loadCorpusPack } from './corpus.js';
import {
  CorpusAnswerKeySchema,
  CorpusCaseSchema,
  type DevelopmentCalibration,
} from './corpus.schema.js';
import {
  assessCorpusReadiness,
  deriveEvaluationEvidenceQualification,
  describeEvaluationEvidenceQualification,
} from './corpus-readiness.js';
import { CorpusReadinessReportSchema } from './corpus-readiness.schema.js';
import { renderCorpusReadinessReport } from './corpus-readiness-report.js';

test('keeps synthetic and semantic fixtures out of reliability readiness while exposing the reviewed real-world pair for internal calibration', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
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
  expect(readiness.counts.developmentCalibrationDeclaredProjectCount).toBe(1);
  expect(readiness.counts.developmentCalibrationEligibleProjectCount).toBe(1);
  expect(readiness.developmentCalibrationAvailable).toBe(true);
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
  const ossf = pack.cases.find((entry) => entry.case.caseId === 'ossf-cve-2018-16492');
  if (ossf?.answerKey.developmentCalibration === undefined) {
    throw new Error(
      'Expected the reviewed OpenSSF pair to carry development-calibration evidence.',
    );
  }
  expect(ossf.answerKey.developmentCalibration.protocolFingerprint).toBe(
    sha256(await readFile('evaluation/data/corpora/CALIBRATION_PROTOCOL.md', 'utf8')),
  );
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

test('makes a fully recorded AI-assisted paired case available only for internal development calibration', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const calibratedPack = withDevelopmentCalibration(pack, developmentCalibrationRecord());
  const readiness = assessCorpusReadiness(calibratedPack, '2026-08-03T18:00:00.000Z');

  expect(readiness.developmentCalibrationAvailable).toBe(true);
  expect(readiness.counts.developmentCalibrationDeclaredProjectCount).toBe(1);
  expect(readiness.counts.developmentCalibrationEligibleProjectCount).toBe(1);
  expect(readiness.pilotReady).toBe(false);
  expect(readiness.reliabilityGateReady).toBe(false);
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness,
    }),
  ).toBe('development-calibration');
  expect(renderCorpusReadinessReport(readiness)).toContain(
    'Internal development-calibration evidence: **available**',
  );
  expect(describeEvaluationEvidenceQualification('development-calibration')).toContain(
    'not a model-quality',
  );

  const qualifyingCase = calibratedPack.cases.find(
    (loaded) => loaded.case.caseId === 'ossf-cve-2018-16492',
  );
  const unqualifiedCase = calibratedPack.cases.find(
    (loaded) => loaded.case.caseId !== 'ossf-cve-2018-16492',
  );
  if (qualifyingCase === undefined || unqualifiedCase === undefined) {
    throw new Error('The corpus fixture requires both qualified and unqualified cases.');
  }
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness: assessCorpusReadiness(calibratedPack, '2026-08-03T18:00:00.000Z', [
        qualifyingCase,
      ]),
    }),
  ).toBe('development-calibration');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness: assessCorpusReadiness(calibratedPack, '2026-08-03T18:00:00.000Z', [
        unqualifiedCase,
      ]),
    }),
  ).toBe('diagnostic');
});

test('keeps high uncertainty, open conflict, and unconfirmed patch records diagnostic', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const highUncertainty = assessCorpusReadiness(
    withDevelopmentCalibration(pack, {
      ...developmentCalibrationRecord(),
      uncertainty: 'high',
    }),
    '2026-08-03T18:00:00.000Z',
  );
  const openConflict = assessCorpusReadiness(
    withDevelopmentCalibration(pack, {
      ...developmentCalibrationRecord(),
      conflictStatus: 'open',
      conflictNote: 'The source-only review disagreement is still open.',
    }),
    '2026-08-03T18:00:00.000Z',
  );
  const unconfirmedPatch = assessCorpusReadiness(
    withDevelopmentCalibration(pack, {
      ...developmentCalibrationRecord(),
      causalPatchValidation: {
        ...developmentCalibrationRecord().causalPatchValidation,
        outcome: 'inconclusive',
      },
    }),
    '2026-08-03T18:00:00.000Z',
  );

  for (const readiness of [highUncertainty, openConflict, unconfirmedPatch]) {
    expect(readiness.developmentCalibrationAvailable).toBe(false);
    expect(readiness.pilotReady).toBe(false);
    expect(readiness.reliabilityGateReady).toBe(false);
    expect(
      deriveEvaluationEvidenceQualification({
        selectedSplit: 'development',
        readiness,
      }),
    ).toBe('diagnostic');
  }
  expect(highUncertainty.counts.developmentCalibrationHighUncertaintyProjectCount).toBe(1);
  expect(openConflict.counts.developmentCalibrationOpenConflictProjectCount).toBe(1);
  expect(unconfirmedPatch.counts.developmentCalibrationCausalPatchUnconfirmedProjectCount).toBe(1);
});

test('requires conflict evidence and distinct source-pinned pair identities for calibration metadata', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const target = pack.cases.find((loaded) => loaded.case.caseId === 'ossf-cve-2018-16492');
  if (target === undefined)
    throw new Error('Expected the OpenSSF real-world pair in the seed corpus.');

  expect(
    CorpusAnswerKeySchema.safeParse({
      ...target.answerKey,
      developmentCalibration: {
        ...developmentCalibrationRecord(),
        conflictStatus: 'open',
      },
    }).success,
  ).toBe(false);
  expect(
    CorpusCaseSchema.safeParse({
      ...target.case,
      patchedRevision: target.case.vulnerableRevision,
      sourceDigests: {
        ...target.case.sourceDigests,
        patched: target.case.sourceDigests.vulnerable,
      },
    }).success,
  ).toBe(false);
});

test('qualifies a run separately from its workflow finding gate', () => {
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness: {
        developmentCalibrationAvailable: false,
        pilotReady: false,
        reliabilityGateReady: false,
      },
    }),
  ).toBe('diagnostic');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness: {
        developmentCalibrationAvailable: true,
        pilotReady: false,
        reliabilityGateReady: false,
      },
    }),
  ).toBe('development-calibration');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'development',
      readiness: {
        developmentCalibrationAvailable: true,
        pilotReady: true,
        reliabilityGateReady: false,
      },
    }),
  ).toBe('development-pilot');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'private-holdout',
      readiness: {
        developmentCalibrationAvailable: true,
        pilotReady: true,
        reliabilityGateReady: true,
      },
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
      readiness: {
        developmentCalibrationAvailable: true,
        pilotReady: true,
        reliabilityGateReady: true,
      },
    }),
  ).toBe('diagnostic');
  expect(
    deriveEvaluationEvidenceQualification({
      selectedSplit: 'test',
      readiness: {
        developmentCalibrationAvailable: true,
        pilotReady: true,
        reliabilityGateReady: true,
      },
    }),
  ).toBe('diagnostic');
  expect(describeEvaluationEvidenceQualification(undefined)).toContain('not eligible');
});

test('retains complete readiness distributions and limitations beyond retired ceilings', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
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

function developmentCalibrationRecord(): DevelopmentCalibration {
  return {
    protocolFingerprint: 'a'.repeat(64),
    causalPatchValidation: {
      outcome: 'confirmed' as const,
      validator: 'internal-source-review-2026-08-03',
      validatedAt: '2026-08-03T18:00:00.000Z',
      notes:
        'The patched source removes the reviewed vulnerable condition without relying on execution.',
    },
    uncertainty: 'moderate' as const,
    conflictStatus: 'none' as const,
  };
}

function withDevelopmentCalibration(
  pack: LoadedCorpusPack,
  developmentCalibration: DevelopmentCalibration,
): LoadedCorpusPack {
  return {
    ...pack,
    cases: pack.cases.map((loaded) =>
      loaded.case.caseId === 'ossf-cve-2018-16492'
        ? {
            ...loaded,
            answerKey: CorpusAnswerKeySchema.parse({
              ...loaded.answerKey,
              developmentCalibration,
            }),
          }
        : loaded,
    ),
  };
}
