import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import {
  type EvaluationBaseline,
  EvaluationBaselineSchema,
  type RealWorldEvaluationRun,
} from './corpus.schema.js';
import { summarizeSemanticPlanMeasurements } from './plan-semantic-summary.js';

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
    throw new AuditRuntimeError(
      'invalid-input',
      'Evaluation baseline is unreadable or invalid JSON.',
    );
  }
  const json = z.json().safeParse(raw);
  if (!json.success) {
    throw new AuditRuntimeError('invalid-input', 'Evaluation baseline is invalid JSON.');
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
    return {
      passed: false,
      violations: [...violations, 'Baseline plan profile does not match this evaluation run.'],
    };
  }
  if (
    baseline.semanticPlanEvaluator?.protocolFingerprint !==
      run.semanticPlanEvaluator?.protocolFingerprint ||
    baseline.semanticPlanEvaluator?.route !== run.semanticPlanEvaluator?.route
  ) {
    violations.push('Baseline semantic evaluator identity does not match this evaluation run.');
  }
  if (baseline.verificationMode !== run.verificationMode) {
    violations.push('Baseline verification mode does not match this evaluation run.');
  }
  if (baseline.verificationRouteFingerprint !== run.verificationRouteFingerprint) {
    violations.push('Baseline verification route does not match this evaluation run.');
  }
  if (!run.diagnosticGatePassed) {
    violations.push('Evaluation diagnostic gate did not pass.');
  }
  if (run.safetyViolations > 0) {
    violations.push('Evaluation recorded one or more safety violations.');
  }
  if (run.evidenceQualification === 'diagnostic') {
    violations.push('Diagnostic evaluation evidence cannot satisfy a baseline.');
  }
  if (run.trials.some((trial) => trial.status !== 'completed')) {
    violations.push('Every baseline trial must reach a completed terminal state.');
  }
  const seenCaseIds = new Set(run.trials.map((trial) => trial.caseId));
  for (const caseId of baseline.requiredCaseIds) {
    if (!seenCaseIds.has(caseId)) violations.push(`Required case is missing: ${caseId}.`);
  }
  switch (baseline.planProfile) {
    case 'planning-generated': {
      const semantic = summarizeSemanticPlanMeasurements(run.planProfile, run.trials);
      if (
        run.reliability.completionRate === null ||
        run.reliability.completionRate < baseline.thresholds.minimumCompletionRate
      ) {
        violations.push('Completion rate is below the reviewed baseline threshold.');
      }
      if (
        semantic === null ||
        semantic.completionRate === null ||
        semantic.completionRate < baseline.thresholds.minimumSemanticEvaluatorCompletionRate
      ) {
        violations.push('Semantic evaluator completion is below the reviewed baseline threshold.');
      }
      if (
        semantic === null ||
        semantic.scenarioRecall === null ||
        semantic.scenarioRecall < baseline.thresholds.minimumSemanticScenarioRecall
      ) {
        violations.push('Semantic scenario recall is below the reviewed baseline threshold.');
      }
      if (
        semantic === null ||
        semantic.relevantVectorPrecision === null ||
        semantic.relevantVectorPrecision < baseline.thresholds.minimumRelevantVectorPrecision
      ) {
        violations.push('Relevant-vector precision is below the reviewed baseline threshold.');
      }
      break;
    }
    case 'audit-reviewed-plan':
    case 'end-to-end-generated': {
      if (run.findingCoverage !== baseline.findingCoverage) {
        violations.push('Baseline finding-label coverage does not match this evaluation run.');
      }
      if (
        run.reliability.completionRate === null ||
        run.reliability.completionRate < baseline.thresholds.minimumCompletionRate
      ) {
        violations.push('Completion rate is below the reviewed baseline threshold.');
      }
      const vulnerableRecall = run.reliability.findingRecallMinimum;
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
        violations.push(
          'Patched or benign false positives exceed the reviewed baseline threshold.',
        );
      }
      break;
    }
  }
  return { passed: violations.length === 0, violations };
}
