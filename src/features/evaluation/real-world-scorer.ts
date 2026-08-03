import type { AttackPlan } from '../attack-planning/plan.schema.js';
import type { Finding } from '../audit-execution/audit.schema.js';
import { type ModelPricing, summarizeModelStages } from '../model-operations/model-operations.js';

import type {
  CorpusAnswerKey,
  CorpusVariant,
  EvaluationMeasurementScope,
  EvaluationTrial,
  FindingScore,
  PlanEvaluationProfile,
  PlanScore,
  ReliabilitySummary,
} from './corpus.schema.js';

export function scorePlan(answerKey: CorpusAnswerKey, plan: AttackPlan): PlanScore {
  const enabled = plan.vectors.filter((vector) => vector.enabled);
  const applicableScenarioIds = new Set(
    applicablePlanScenarios(answerKey).map((scenario) => scenario.scenarioId),
  );
  const expectedPaths = new Set(
    applicablePlanScenarios(answerKey).flatMap((scenario) => scenario.relevantPaths),
  );
  const coveredPaths = new Set(
    applicablePlanScenarios(answerKey)
      .filter((scenario) => scenario.relevantPaths.every((path) => vectorScopesPath(enabled, path)))
      .flatMap((scenario) => scenario.relevantPaths),
  );
  return {
    expectedScenarioCount: applicableScenarioIds.size,
    scopedScenarioCount: applicablePlanScenarios(answerKey).filter((scenario) =>
      scenario.relevantPaths.every((path) => vectorScopesPath(enabled, path)),
    ).length,
    notApplicableScenarioCount: answerKey.expectedPlanScenarios.length - applicableScenarioIds.size,
    relevantPathCoverage: ratio(coveredPaths.size, expectedPaths.size),
    generatedVectorCount: enabled.length,
  };
}

function vectorScopesPath(
  vectors: readonly AttackPlan['vectors'][number][],
  path: string,
): boolean {
  return vectors.some((vector) => vector.scopeGlobs.some((glob) => globMatches(path, glob)));
}

export function scoreFindings(
  answerKey: CorpusAnswerKey,
  _plan: AttackPlan,
  findings: readonly Finding[],
  variant: CorpusVariant,
): FindingScore {
  const expectedFindings = applicableExpectedFindings(answerKey);
  const staticReviewEligible = answerKey.staticReviewApplicable;
  const findingEntries = findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => left.finding.findingId.localeCompare(right.finding.findingId));
  const expectedEntries = expectedFindings
    .map((expected, index) => ({ expected, index }))
    .sort((left, right) => left.expected.findingId.localeCompare(right.expected.findingId));
  const matchedExpectedByFinding = maximumFindingMatching(expectedEntries, findingEntries);
  const matchedFindingIndexes = new Set(matchedExpectedByFinding.keys());
  let truePositives = 0;
  let localizedMatches = 0;
  let mislocalizedMatches = 0;
  for (const [findingIndex, expectedIndex] of matchedExpectedByFinding) {
    const finding = findings[findingIndex];
    const expected = answerKey.expectedFindings[expectedIndex];
    if (finding === undefined || expected === undefined) continue;
    if (variant === 'vulnerable') {
      truePositives += 1;
      if (expected.evidenceRoles.every((role) => findingHasExpectedRoleEvidence(finding, role))) {
        localizedMatches += 1;
      } else {
        mislocalizedMatches += 1;
      }
    }
  }
  const unmatchedCount = findings.length - matchedFindingIndexes.size;
  const matchedPatchedFindings =
    staticReviewEligible && variant !== 'vulnerable' ? matchedFindingIndexes.size : 0;
  const unmatchedAdjudicated =
    staticReviewEligible && answerKey.findingCoverage === 'exhaustive' ? unmatchedCount : 0;
  const falsePositives = matchedPatchedFindings + unmatchedAdjudicated;
  const falseNegatives = variant === 'vulnerable' ? expectedFindings.length - truePositives : 0;
  const precision =
    staticReviewEligible && answerKey.findingCoverage === 'exhaustive'
      ? ratio(truePositives, truePositives + falsePositives)
      : null;
  const recall = staticReviewEligible ? ratio(truePositives, truePositives + falseNegatives) : null;
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    findingPrecision: precision,
    findingRecall: recall,
    findingF1: f1(precision, recall),
    notApplicableExpectedFindingCount: answerKey.expectedFindings.length - expectedFindings.length,
    unnecessaryVectorCount: falsePositives,
    matchedLocalizedCount: localizedMatches,
    matchedMislocalizedCount: mislocalizedMatches,
    unmatchedAdjudicatedFalsePositiveCount: unmatchedAdjudicated,
    unmatchedUnadjudicatedCount:
      staticReviewEligible && answerKey.findingCoverage === 'targeted' ? unmatchedCount : 0,
    patchedMatchingFindingCount: matchedPatchedFindings,
    localizationAccuracy: ratio(localizedMatches, truePositives),
    pairedPersistence:
      variant === 'vulnerable' ? null : ratio(matchedPatchedFindings, Math.max(1, findings.length)),
  };
}

function applicableExpectedFindings(
  answerKey: CorpusAnswerKey,
): readonly CorpusAnswerKey['expectedFindings'][number][] {
  return answerKey.staticReviewApplicable
    ? answerKey.expectedFindings.filter((finding) => finding.staticReviewApplicable)
    : [];
}

function applicablePlanScenarios(
  answerKey: CorpusAnswerKey,
): readonly CorpusAnswerKey['expectedPlanScenarios'][number][] {
  const applicableFindingIds = new Set(
    applicableExpectedFindings(answerKey).map((finding) => finding.findingId),
  );
  return answerKey.expectedPlanScenarios.filter((scenario) =>
    scenario.expectedFindingIds.some((findingId) => applicableFindingIds.has(findingId)),
  );
}

/**
 * Produces a maximum-cardinality expected-finding/finding matching. Each
 * output can evidence at most one expected issue, so an early overlapping
 * match cannot hide a later, uniquely matchable expected issue. Ordering by
 * stable identifiers makes ties independent of the model's array order.
 */
function maximumFindingMatching(
  expectedEntries: readonly {
    expected: CorpusAnswerKey['expectedFindings'][number];
    index: number;
  }[],
  findingEntries: readonly { finding: Finding; index: number }[],
): ReadonlyMap<number, number> {
  const expectedByFinding = new Map<number, number>();
  const findingByExpected = new Map<number, number>();
  const candidateIndexesByExpected = new Map<number, number[]>();
  for (const { expected, index: expectedIndex } of expectedEntries) {
    const candidates = findingEntries
      .filter(({ finding }) =>
        expected.evidenceRoles.some((role) => findingHasExpectedRoleEvidence(finding, role)),
      )
      .sort((left, right) => {
        const leftComplete = expected.evidenceRoles.every((role) =>
          findingHasExpectedRoleEvidence(left.finding, role),
        );
        const rightComplete = expected.evidenceRoles.every((role) =>
          findingHasExpectedRoleEvidence(right.finding, role),
        );
        if (leftComplete !== rightComplete) return leftComplete ? -1 : 1;
        return left.finding.findingId.localeCompare(right.finding.findingId);
      })
      .map(({ index }) => index);
    candidateIndexesByExpected.set(expectedIndex, candidates);
  }
  const assign = (expectedIndex: number, visitedFindingIndexes: Set<number>): boolean => {
    const candidates = candidateIndexesByExpected.get(expectedIndex) ?? [];
    for (const findingIndex of candidates) {
      if (visitedFindingIndexes.has(findingIndex)) continue;
      visitedFindingIndexes.add(findingIndex);
      const previouslyMatchedExpected = expectedByFinding.get(findingIndex);
      if (
        previouslyMatchedExpected === undefined ||
        assign(previouslyMatchedExpected, visitedFindingIndexes)
      ) {
        expectedByFinding.set(findingIndex, expectedIndex);
        findingByExpected.set(expectedIndex, findingIndex);
        return true;
      }
    }
    return false;
  };
  for (const { index } of expectedEntries) assign(index, new Set());
  return expectedByFinding;
}

function findingHasExpectedRoleEvidence(
  finding: Finding,
  expectedRole: CorpusAnswerKey['expectedFindings'][number]['evidenceRoles'][number],
): boolean {
  if (expectedRole.notApplicable) return true;
  return finding.evidence.some(
    (evidence) =>
      evidence.role === expectedRole.role &&
      expectedRole.ranges.some(
        (range) =>
          evidence.path === range.path &&
          evidence.startLine <= range.endLine &&
          (evidence.endLine ?? evidence.startLine) >= range.startLine,
      ),
  );
}

export function normalizedPlanKeys(plan: AttackPlan): string[] {
  return plan.vectors
    .filter((vector) => vector.enabled)
    .map((vector) => `${vector.title}\0${vector.scopeGlobs.join(',')}`)
    .sort();
}

export function normalizedFindingKeys(findings: readonly Finding[], plan: AttackPlan): string[] {
  const knownVectorIds = new Set(plan.vectors.map((vector) => vector.vectorId));
  return findings
    .flatMap((finding) => {
      const evidence = primaryEvidence(finding);
      return evidence === undefined || !knownVectorIds.has(finding.vectorId)
        ? []
        : [`${finding.vectorId}\0${evidence.path}\0${evidence.startLine}`];
    })
    .sort();
}

function primaryEvidence(finding: Finding) {
  return finding.evidence.find((evidence) => evidence.role === 'operation') ?? finding.evidence[0];
}

export function summarizeReliability(
  trials: readonly EvaluationTrial[],
  modelPricing: ModelPricing = {},
  planProfile: PlanEvaluationProfile = 'generated-plan',
  measurementScope: EvaluationMeasurementScope = 'full-workflow',
): ReliabilitySummary {
  const completed = trials.filter((trial) => trial.status === 'completed');
  const recallValues =
    measurementScope === 'planning-only'
      ? []
      : completed.flatMap((trial) =>
          trial.findingScore?.findingRecall === null || trial.findingScore === null
            ? []
            : [trial.findingScore.findingRecall],
        );
  const durations = completed.map((trial) => trial.durationMs).sort((left, right) => left - right);
  const observations = trials
    .map((trial) => trial.modelObservation)
    .filter(
      (observation): observation is NonNullable<typeof observation> =>
        observation !== null && observation !== undefined,
    );
  const modelObservation =
    observations.length === 0
      ? null
      : summarizeModelStages(
          observations.flatMap((observation) => observation.stages),
          modelPricing,
        );
  return {
    completedTrials: completed.length,
    incompleteTrials: trials.filter((trial) => trial.status === 'incomplete').length,
    failedTrials: trials.filter((trial) => trial.status === 'failed').length,
    cancelledTrials: trials.filter((trial) => trial.status === 'cancelled').length,
    completionRate: ratio(completed.length, trials.length),
    planJaccard:
      planProfile === 'generated-plan'
        ? averageRepeatedAgreement(completed, (trial) => trial.planKeys)
        : null,
    findingJaccard:
      measurementScope === 'planning-only'
        ? null
        : averageRepeatedAgreement(completed, (trial) => trial.findingKeys),
    findingRecallMedian: percentile(recallValues, 0.5),
    findingRecallMinimum: recallValues.length === 0 ? null : Math.min(...recallValues),
    durationMsMedian: percentile(durations, 0.5),
    durationMsP95: percentile(durations, 0.95),
    modelObservation,
  };
}

function globMatches(path: string, glob: string): boolean {
  const expression = glob
    .replace(/[|\\{}()[\]^$+?.]/gu, '\\$&')
    .replaceAll('**/', '(?:.*/)?')
    .replaceAll('**', '.*')
    .replaceAll('*', '[^/]*');
  return new RegExp(`^${expression}$`, 'u').test(path);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function f1(precision: number | null, recall: number | null): number | null {
  return precision === null || recall === null || precision + recall === 0
    ? null
    : (2 * precision * recall) / (precision + recall);
}

function averagePairwiseJaccard(values: readonly (readonly string[])[]): number | null {
  if (values.length < 2) return null;
  const pairs: number[] = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const first = values[left];
      const second = values[right];
      if (first === undefined || second === undefined) continue;
      const union = new Set([...first, ...second]);
      const intersection = first.filter((value) => second.includes(value)).length;
      pairs.push(union.size === 0 ? 1 : intersection / union.size);
    }
  }
  return pairs.length === 0
    ? null
    : pairs.reduce((total, value) => total + value, 0) / pairs.length;
}

/** Compares repeats only within the same case and variant; cross-case sets are not reliability data. */
function averageRepeatedAgreement(
  trials: readonly EvaluationTrial[],
  select: (trial: EvaluationTrial) => readonly string[],
): number | null {
  const groups = new Map<string, EvaluationTrial[]>();
  for (const trial of trials) {
    const key = `${trial.caseId}\0${trial.variant}`;
    const group = groups.get(key) ?? [];
    group.push(trial);
    groups.set(key, group);
  }
  const agreements = [...groups.values()]
    .map((group) => averagePairwiseJaccard(group.map(select)))
    .filter((value): value is number => value !== null);
  return agreements.length === 0
    ? null
    : agreements.reduce((total, value) => total + value, 0) / agreements.length;
}

function percentile(values: readonly number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1);
  return sorted[index] ?? null;
}
