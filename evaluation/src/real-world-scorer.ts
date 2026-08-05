import {
  type AttackPlan,
  claimEvidenceItems,
} from '../../src/features/attack-planning/plan.schema.js';
import type { Finding } from '../../src/features/audit-execution/audit.schema.js';
import { createFindingId } from '../../src/features/audit-execution/synthesis/identity.js';
import {
  type ModelPricing,
  summarizeModelStages,
} from '../../src/features/model-operations/model-operations.js';
import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';

import type {
  CorpusAnswerKey,
  CorpusVariant,
  EvaluationTrial,
  FindingScore,
  PathReachabilityScore,
  PlanEvaluationProfile,
  ReliabilitySummary,
  TerminalFindingEvidenceMatch,
} from './corpus.schema.js';

export function scorePathReachability(
  answerKey: CorpusAnswerKey,
  plan: AttackPlan,
): PathReachabilityScore {
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
    eligibleScenarioCount: applicableScenarioIds.size,
    pathReachableScenarioCount: applicablePlanScenarios(answerKey).filter((scenario) =>
      scenario.relevantPaths.every((path) => vectorScopesPath(enabled, path)),
    ).length,
    notApplicableScenarioCount: answerKey.expectedPlanScenarios.length - applicableScenarioIds.size,
    relevantPathCoverage: ratio(coveredPaths.size, expectedPaths.size),
    enabledVectorCount: enabled.length,
  };
}

export function vectorScopesPath(
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
  terminalMatches: readonly TerminalFindingEvidenceMatch[] = terminalFindingEvidenceMatches(
    answerKey,
    findings,
  ),
): FindingScore {
  const expectedFindings = applicableExpectedFindings(answerKey);
  const staticReviewEligible = answerKey.staticReviewApplicable;
  const matchesByExpectedFindingId = new Map(
    terminalMatches.map((match) => [match.expectedFindingId, match] as const),
  );
  const completeMatches = terminalMatches.filter(hasCompleteTerminalRoleEvidence);
  const completeMatchedFindingIds = new Set(
    completeMatches.flatMap((match) =>
      match.terminalFindingId === null ? [] : [match.terminalFindingId],
    ),
  );
  let truePositives = 0;
  let localizedMatches = 0;
  let mislocalizedMatches = 0;
  const matchedExpectedFindingIds: string[] = [];
  for (const expected of expectedFindings) {
    const match = matchesByExpectedFindingId.get(expected.findingId);
    if (match?.terminalFindingId === null || match === undefined) continue;
    if (variant === 'vulnerable') {
      if (hasCompleteTerminalRoleEvidence(match)) {
        truePositives += 1;
        localizedMatches += 1;
        matchedExpectedFindingIds.push(expected.findingId);
      } else {
        mislocalizedMatches += 1;
      }
    } else if (hasCompleteTerminalRoleEvidence(match)) {
      matchedExpectedFindingIds.push(expected.findingId);
    }
  }
  const unmatchedCount = findings.length - completeMatchedFindingIds.size;
  const matchedPatchedFindings =
    staticReviewEligible && variant !== 'vulnerable' ? completeMatchedFindingIds.size : 0;
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
    localizationAccuracy: ratio(localizedMatches, localizedMatches + mislocalizedMatches),
    pairedPersistence:
      variant === 'vulnerable' ? null : ratio(matchedPatchedFindings, Math.max(1, findings.length)),
    matchedExpectedFindingIds: matchedExpectedFindingIds.sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

/**
 * The sole evaluator-owned terminal evidence projection. It binds every
 * scoreable expected finding to at most one persisted terminal finding and
 * records whether that exact finding selected every applicable expected role.
 */
export function terminalFindingEvidenceMatches(
  answerKey: CorpusAnswerKey,
  findings: readonly Finding[],
): readonly TerminalFindingEvidenceMatch[] {
  const expectedFindings = applicableExpectedFindings(answerKey);
  const findingEntries = findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => left.finding.findingId.localeCompare(right.finding.findingId));
  const expectedEntries = expectedFindings
    .map((expected) => ({ expected, expectedId: expected.findingId }))
    .sort((left, right) => left.expected.findingId.localeCompare(right.expected.findingId));
  const matchedExpectedByFinding = maximumFindingMatching(expectedEntries, findingEntries);
  const findingIndexByExpectedId = new Map(
    [...matchedExpectedByFinding].map(([findingIndex, expected]) => [
      expected.findingId,
      findingIndex,
    ]),
  );
  return expectedFindings.map((expected) => {
    const finding = findings[findingIndexByExpectedId.get(expected.findingId) ?? -1];
    return {
      expectedFindingId: expected.findingId,
      terminalFindingId: finding?.findingId ?? null,
      roleSelections: expected.evidenceRoles
        .filter((role) => !role.notApplicable)
        .map((role) => ({
          role: role.role,
          selected: finding === undefined ? false : findingHasExpectedRoleEvidence(finding, role),
        })),
    };
  });
}

export function hasCompleteTerminalRoleEvidence(match: TerminalFindingEvidenceMatch): boolean {
  return (
    match.terminalFindingId !== null &&
    match.roleSelections.length > 0 &&
    match.roleSelections.every((selection) => selection.selected)
  );
}

function applicableExpectedFindings(
  answerKey: CorpusAnswerKey,
): readonly CorpusAnswerKey['expectedFindings'][number][] {
  return answerKey.staticReviewApplicable
    ? answerKey.expectedFindings.filter(isScoreableExpectedFinding)
    : [];
}

function isScoreableExpectedFinding(finding: CorpusAnswerKey['expectedFindings'][number]): boolean {
  return (
    finding.staticReviewApplicable && finding.evidenceRoles.some((role) => !role.notApplicable)
  );
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
    expectedId: string;
  }[],
  findingEntries: readonly { finding: Finding; index: number }[],
): ReadonlyMap<number, CorpusAnswerKey['expectedFindings'][number]> {
  const expectedByFinding = new Map<number, CorpusAnswerKey['expectedFindings'][number]>();
  const findingByExpected = new Map<string, number>();
  const candidateIndexesByExpected = new Map<string, number[]>();
  for (const { expected, expectedId } of expectedEntries) {
    const candidates = findingEntries
      .filter(({ finding }) =>
        expected.evidenceRoles.some(
          (role) => !role.notApplicable && findingHasExpectedRoleEvidence(finding, role),
        ),
      )
      .sort((left, right) => {
        const leftComplete = findingHasAllApplicableRoleEvidence(left.finding, expected);
        const rightComplete = findingHasAllApplicableRoleEvidence(right.finding, expected);
        if (leftComplete !== rightComplete) return leftComplete ? -1 : 1;
        return left.finding.findingId.localeCompare(right.finding.findingId);
      })
      .map(({ index }) => index);
    candidateIndexesByExpected.set(expectedId, candidates);
  }
  const assign = (expectedId: string, visitedFindingIndexes: Set<number>): boolean => {
    const candidates = candidateIndexesByExpected.get(expectedId) ?? [];
    for (const findingIndex of candidates) {
      if (visitedFindingIndexes.has(findingIndex)) continue;
      visitedFindingIndexes.add(findingIndex);
      const previouslyMatchedExpected = expectedByFinding.get(findingIndex);
      if (
        previouslyMatchedExpected === undefined ||
        assign(previouslyMatchedExpected.findingId, visitedFindingIndexes)
      ) {
        const expected = expectedEntries.find((entry) => entry.expectedId === expectedId)?.expected;
        if (expected === undefined) return false;
        expectedByFinding.set(findingIndex, expected);
        findingByExpected.set(expectedId, findingIndex);
        return true;
      }
    }
    return false;
  };
  for (const { expectedId } of expectedEntries) assign(expectedId, new Set());
  return expectedByFinding;
}

function findingHasAllApplicableRoleEvidence(
  finding: Finding,
  expected: CorpusAnswerKey['expectedFindings'][number],
): boolean {
  const applicableRoles = expected.evidenceRoles.filter((role) => !role.notApplicable);
  return (
    applicableRoles.length > 0 &&
    applicableRoles.every((role) => findingHasExpectedRoleEvidence(finding, role))
  );
}

function findingHasExpectedRoleEvidence(
  finding: Finding,
  expectedRole: CorpusAnswerKey['expectedFindings'][number]['evidenceRoles'][number],
): boolean {
  if (expectedRole.notApplicable) return false;
  return claimEvidenceItems(finding).some(
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
    .map((vector) =>
      sha256(
        canonicalJson({
          objective: vector.title,
          riskStatement: vector.rationale,
          enabled: vector.enabled,
          scopeGlobs: [...vector.scopeGlobs].sort(),
          reviewObligations: vector.reviewObligations
            .map((obligation) => ({
              riskStatement: obligation.riskStatement,
              evidenceRequirement: obligation.evidenceRequirement,
            }))
            .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right))),
          limitations: [...vector.limitations].sort(),
        }),
      ),
    )
    .sort();
}

export function normalizedFindingKeys(findings: readonly Finding[], plan: AttackPlan): string[] {
  const knownVectorIds = new Set(plan.vectors.map((vector) => vector.vectorId));
  return findings
    .flatMap((finding) => (knownVectorIds.has(finding.vectorId) ? [createFindingId(finding)] : []))
    .sort();
}

export function summarizeReliability(
  trials: readonly EvaluationTrial[],
  modelPricing: ModelPricing = {},
  planProfile: PlanEvaluationProfile = 'end-to-end-generated',
): ReliabilitySummary {
  const completed = trials.filter((trial) => trial.status === 'completed');
  const recallValues =
    planProfile === 'planning-generated'
      ? []
      : completed.flatMap((trial) =>
          trial.findingScore?.findingRecall === null || trial.findingScore === null
            ? []
            : [trial.findingScore.findingRecall],
        );
  const allTerminalDurations = trials
    .map((trial) => trial.durationMs)
    .sort((left, right) => left - right);
  const completedDurations = completed
    .map((trial) => trial.durationMs)
    .sort((left, right) => left - right);
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
      planProfile !== 'audit-reviewed-plan'
        ? averageRepeatedAgreement(completed, (trial) => trial.planKeys)
        : null,
    findingJaccard:
      planProfile === 'planning-generated'
        ? null
        : averageRepeatedAgreement(completed, (trial) => trial.findingKeys),
    findingRecallMedian: percentile(recallValues, 0.5),
    findingRecallMinimum: recallValues.length === 0 ? null : Math.min(...recallValues),
    allTerminalDurationMsMedian: percentile(allTerminalDurations, 0.5),
    allTerminalDurationMsP95: percentile(allTerminalDurations, 0.95),
    completedDurationMsMedian: percentile(completedDurations, 0.5),
    completedDurationMsP95: percentile(completedDurations, 0.95),
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
