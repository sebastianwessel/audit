import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';

import {
  type EvaluationBaseline,
  EvaluationBaselineSchema,
  type RealWorldEvaluationRun,
} from './corpus.schema.js';

export type BaselineComparison = Readonly<{
  passed: boolean;
  violations: readonly string[];
}>;

/** Loads a reviewed threshold baseline; invalid files fail closed. */
export async function loadEvaluationBaseline(path: string): Promise<EvaluationBaseline> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new SecurityReviewerError(
      'invalid-input',
      'Evaluation baseline is unreadable or invalid JSON.',
    );
  }
  const json = z.json().safeParse(raw);
  if (!json.success) {
    throw new SecurityReviewerError('invalid-input', 'Evaluation baseline is invalid JSON.');
  }
  return EvaluationBaselineSchema.parse(json.data);
}

/** Compares aggregate evidence with an approved baseline without concealing per-trial failures. */
export function compareEvaluationBaseline(
  baseline: EvaluationBaseline,
  run: RealWorldEvaluationRun,
): BaselineComparison {
  const violations: string[] = [];
  if (
    baseline.packId !== run.packId ||
    baseline.packVersion !== run.packVersion ||
    baseline.corpusManifestDigest !== run.corpusManifestDigest ||
    baseline.populationDigest !== run.populationDigest
  ) {
    violations.push('Baseline pack identity does not match this evaluation run.');
  }
  if (baseline.benchmarkProtocolFingerprint !== run.benchmarkProtocolFingerprint) {
    violations.push('Baseline benchmark protocol does not match this evaluation run.');
  }
  if (baseline.planProfile !== run.planProfile) {
    violations.push('Baseline plan profile does not match this evaluation run.');
  }
  if (run.findingCoverage !== baseline.findingCoverage) {
    violations.push('Baseline finding-label coverage does not match this evaluation run.');
  }
  if (baseline.verificationMode !== run.verificationMode) {
    violations.push('Baseline verification mode does not match this evaluation run.');
  }
  if (baseline.verificationRouteFingerprint !== run.verificationRouteFingerprint) {
    violations.push('Baseline verification route does not match this evaluation run.');
  }
  const seenCaseIds = new Set(run.trials.map((trial) => trial.caseId));
  for (const caseId of baseline.requiredCaseIds) {
    if (!seenCaseIds.has(caseId)) violations.push(`Required case is missing: ${caseId}.`);
  }
  const completionRate = run.reliability.completionRate;
  if (completionRate === null || completionRate < baseline.thresholds.minimumCompletionRate) {
    violations.push('Completion rate is below the reviewed baseline threshold.');
  }
  const vulnerableRecalls = run.trials.flatMap((trial) =>
    trial.variant === 'vulnerable' && trial.status === 'completed'
      ? trial.findingScore?.findingRecall === null || trial.findingScore === null
        ? []
        : [trial.findingScore.findingRecall]
      : [],
  );
  const vulnerableRecall =
    vulnerableRecalls.length === 0
      ? null
      : vulnerableRecalls.reduce((total, value) => total + value, 0) / vulnerableRecalls.length;
  if (
    vulnerableRecall === null ||
    vulnerableRecall < baseline.thresholds.minimumVulnerableFindingRecall
  ) {
    violations.push('Vulnerable finding recall is below the reviewed baseline threshold.');
  }
  const nonVulnerableFalsePositives = run.trials.reduce(
    (total, trial) =>
      total + (trial.variant === 'vulnerable' ? 0 : (trial.findingScore?.falsePositives ?? 0)),
    0,
  );
  if (nonVulnerableFalsePositives > baseline.thresholds.maximumNonVulnerableFalsePositives) {
    violations.push('Patched or benign false positives exceed the reviewed baseline threshold.');
  }
  return { passed: violations.length === 0, violations };
}
