import { canonicalJson, sha256 } from '../../shared/contracts/core.js';
import type { LoadedCorpusCase, LoadedCorpusPack } from './corpus.js';
import {
  CorpusControlFamilySchema,
  type CorpusSplit,
  type EvaluationEvidenceQualification,
  EvaluationEvidenceQualificationSchema,
} from './corpus.schema.js';
import {
  type CorpusReadinessCriterion,
  type CorpusReadinessReport,
  CorpusReadinessReportSchema,
} from './corpus-readiness.schema.js';
import type { HoldoutAttestationReference } from './holdout-attestation.schema.js';

const controlFamilyMinimumPairs = 5;

/**
 * Measures whether trusted corpus data is sufficient for the approved pilot
 * and reliability claims. It does not score a model or inspect target source.
 */
export function assessCorpusReadiness(pack: LoadedCorpusPack, generatedAt: string) {
  const realWorldCases = pack.cases.filter((loaded) => loaded.case.evidenceOrigin === 'real-world');
  const pairedCases = pack.cases.filter((loaded) => loaded.case.variantMode === 'paired');
  const realWorldPaired = realWorldCases.filter((loaded) => loaded.case.variantMode === 'paired');
  const developmentRealWorldPaired = realWorldPaired.filter(
    (loaded) => loaded.case.split === 'development',
  );
  const developmentDualReviewed = developmentRealWorldPaired.filter(isDualReviewed);
  const realWorldDualReviewedPaired = realWorldPaired.filter(isDualReviewed);
  const dualReviewedPatchedNegative = realWorldDualReviewedPaired.filter(
    (loaded) => loaded.answerKey.patchedExpectation === 'no-matching-finding',
  );
  const privateHoldoutRealWorldPaired = realWorldPaired.filter(
    (loaded) => loaded.case.split === 'private-holdout',
  );
  const dualReviewedPrivateHoldout = privateHoldoutRealWorldPaired.filter(isDualReviewed);
  const byControlFamily = controlFamilyReadiness(developmentRealWorldPaired);
  const coveredRequiredControlFamilyCount = byControlFamily.filter(
    (entry) => entry.dualReviewedRealWorldPairedProjectCount >= controlFamilyMinimumPairs,
  ).length;
  const realWorldLanguageFamilyCount = new Set(
    realWorldPaired.map((loaded) => loaded.case.language),
  ).size;
  const dualReviewedRealWorldLanguageFamilyCount = new Set(
    realWorldDualReviewedPaired.map((loaded) => loaded.case.language),
  ).size;

  const criteria: CorpusReadinessCriterion[] = [
    criterion(
      'pilot-development-pairs',
      'pilot',
      'repository-disjoint-pairs',
      distinctProjects(developmentDualReviewed),
      30,
      'dual-reviewed development real-world paired projects',
    ),
    criterion(
      'pilot-development-control-families',
      'pilot',
      'control-families',
      coveredRequiredControlFamilyCount,
      CorpusControlFamilySchema.options.length,
      `required development control families with at least ${controlFamilyMinimumPairs} real-world paired projects each`,
    ),
    criterion(
      'reliability-real-world-pairs',
      'reliability-gate',
      'repository-disjoint-pairs',
      distinctProjects(realWorldDualReviewedPaired),
      100,
      'dual-reviewed repository-disjoint real-world paired projects',
    ),
    criterion(
      'reliability-patched-negative-pairs',
      'reliability-gate',
      'repository-disjoint-pairs',
      distinctProjects(dualReviewedPatchedNegative),
      25,
      'dual-reviewed real-world paired projects with a patched negative',
    ),
    criterion(
      'reliability-language-families',
      'reliability-gate',
      'language-families',
      dualReviewedRealWorldLanguageFamilyCount,
      3,
      'dual-reviewed real-world paired language families',
    ),
    criterion(
      'reliability-private-holdout',
      'reliability-gate',
      'repository-disjoint-pairs',
      distinctProjects(dualReviewedPrivateHoldout),
      1,
      'dual-reviewed private-holdout real-world paired projects',
    ),
  ];
  const pilotReady = criteria.filter((item) => item.level === 'pilot').every((item) => item.met);
  const reliabilityGateReady = criteria.every((item) => item.met);
  const limitations = criteria.filter((item) => !item.met).map((item) => item.detail);

  return CorpusReadinessReportSchema.parse({
    schemaVersion: 1,
    packId: pack.manifest.packId,
    packVersion: pack.manifest.packVersion,
    generatedAt,
    counts: {
      caseCount: pack.cases.length,
      realWorldCaseCount: realWorldCases.length,
      pairedCaseCount: pairedCases.length,
      realWorldPairedProjectCount: distinctProjects(realWorldPaired),
      realWorldDualReviewedPairedProjectCount: distinctProjects(realWorldDualReviewedPaired),
      dualReviewedPatchedNegativeProjectCount: distinctProjects(dualReviewedPatchedNegative),
      developmentRealWorldPairedProjectCount: distinctProjects(developmentRealWorldPaired),
      developmentDualReviewedRealWorldPairedProjectCount: distinctProjects(developmentDualReviewed),
      privateHoldoutRealWorldPairedProjectCount: distinctProjects(privateHoldoutRealWorldPaired),
      dualReviewedPrivateHoldoutRealWorldPairedProjectCount: distinctProjects(
        dualReviewedPrivateHoldout,
      ),
      realWorldLanguageFamilyCount,
      dualReviewedRealWorldLanguageFamilyCount,
      coveredRequiredControlFamilyCount,
    },
    byEvidenceOrigin: distribution(pack.cases, (loaded) => loaded.case.evidenceOrigin),
    byLanguage: distribution(pack.cases, (loaded) => loaded.case.language),
    byDataset: distribution(pack.cases, (loaded) => loaded.case.datasetId),
    byControlFamily,
    criteria,
    pilotReady,
    reliabilityGateReady,
    limitations,
  });
}

/**
 * Stable, source-free identity of the readiness decision that a private
 * holdout steward approves. `generatedAt` is deliberately excluded: it is
 * operational metadata, not part of the evidence decision.
 */
export function corpusReadinessDecisionDigest(pack: LoadedCorpusPack): string {
  const { generatedAt: _generatedAt, ...decision } = assessCorpusReadiness(
    pack,
    '1970-01-01T00:00:00.000Z',
  );
  return sha256(canonicalJson(decision));
}

/**
 * Fails closed for quality claims: a workflow gate is only an operational
 * result until independent corpus readiness and the selected split justify a
 * narrower evidence statement.
 */
export function deriveEvaluationEvidenceQualification(
  input: Readonly<{
    selectedSplit: CorpusSplit;
    readiness: Pick<CorpusReadinessReport, 'pilotReady' | 'reliabilityGateReady'>;
    /** A verified attestation binds an externally controlled holdout to a readiness decision. */
    holdoutAttestation?: HoldoutAttestationReference;
  }>,
): EvaluationEvidenceQualification {
  if (input.selectedSplit === 'private-holdout' && input.holdoutAttestation !== undefined) {
    return EvaluationEvidenceQualificationSchema.parse('private-holdout');
  }
  if (input.selectedSplit === 'development' && input.readiness.pilotReady) {
    return EvaluationEvidenceQualificationSchema.parse('development-pilot');
  }
  return EvaluationEvidenceQualificationSchema.parse('diagnostic');
}

/** Single owned human wording for persisted evaluation evidence qualification. */
export function describeEvaluationEvidenceQualification(
  qualification: EvaluationEvidenceQualification | undefined,
): string {
  switch (qualification) {
    case 'development-pilot':
      return 'development pilot only; not a provider-reliability claim';
    case 'private-holdout':
      return 'private-holdout evidence; interpret only against the preregistered reliability decision';
    case 'diagnostic':
    case undefined:
      return 'diagnostic only; not eligible for a provider-quality or reliability claim';
  }
}

function controlFamilyReadiness(cases: readonly LoadedCorpusCase[]) {
  return CorpusControlFamilySchema.options.map((family) => {
    const matching = cases.filter((loaded) => loaded.case.controlFamilies.includes(family));
    return {
      family,
      realWorldPairedProjectCount: distinctProjects(matching),
      dualReviewedRealWorldPairedProjectCount: distinctProjects(matching.filter(isDualReviewed)),
    };
  });
}

function criterion(
  criterionId: string,
  level: CorpusReadinessCriterion['level'],
  unit: CorpusReadinessCriterion['unit'],
  observedCount: number,
  minimumCount: number,
  label: string,
): CorpusReadinessCriterion {
  const met = observedCount >= minimumCount;
  return {
    criterionId,
    level,
    unit,
    observedCount,
    minimumCount,
    met,
    detail: met
      ? `${label}: ${observedCount}/${minimumCount} minimum met.`
      : `${label}: ${observedCount}/${minimumCount}; add ${minimumCount - observedCount} more.`,
  };
}

function isDualReviewed(loaded: LoadedCorpusCase): boolean {
  return loaded.answerKey.adjudicationStatus === 'dual-reviewed';
}

function distinctProjects(cases: readonly LoadedCorpusCase[]): number {
  return new Set(cases.map((loaded) => loaded.case.projectId)).size;
}

function distribution(
  cases: readonly LoadedCorpusCase[],
  keyFor: (loaded: LoadedCorpusCase) => string,
) {
  const caseCounts = new Map<string, number>();
  const projectsByKey = new Map<string, Set<string>>();
  for (const loaded of cases) {
    const key = keyFor(loaded);
    caseCounts.set(key, (caseCounts.get(key) ?? 0) + 1);
    const projects = projectsByKey.get(key) ?? new Set<string>();
    projects.add(loaded.case.projectId);
    projectsByKey.set(key, projects);
  }
  return [...caseCounts.entries()]
    .map(([key, caseCount]) => ({
      key,
      caseCount,
      projectCount: projectsByKey.get(key)?.size ?? 0,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}
