import type { Finding } from '../audit-execution/audit.schema.js';
import type { EvaluationFixture, ExpectedFinding, Metrics } from './evaluation.schema.js';

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null || precision + recall === 0) return null;
  return (2 * precision * recall) / (precision + recall);
}

function matches(expected: ExpectedFinding, finding: Finding): boolean {
  return finding.evidence.some(
    (evidence) =>
      evidence.path === expected.path &&
      evidence.startLine <= expected.endLine + expected.locationTolerance &&
      (evidence.endLine ?? evidence.startLine) >= expected.startLine - expected.locationTolerance,
  );
}

export function scoreFixture(fixture: EvaluationFixture, findings: readonly Finding[]): Metrics {
  const unmatched = new Set(findings.map((_, index) => index));
  let truePositives = 0;
  let locationMatches = 0;
  for (const expected of fixture.expectedFindings) {
    const index = [...unmatched].find((candidate) => {
      const finding = findings[candidate];
      return finding !== undefined && matches(expected, finding);
    });
    if (index === undefined) continue;
    unmatched.delete(index);
    truePositives += 1;
    locationMatches += 1;
  }
  const falsePositives = unmatched.size;
  const falseNegatives = fixture.expectedFindings.length - truePositives;
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1: f1(precision, recall),
    locationAccuracy: ratio(locationMatches, fixture.expectedFindings.length),
    duplicateRate: ratio(
      Math.max(0, findings.length - unmatched.size - truePositives),
      findings.length,
    ),
    falsePositiveRate: ratio(falsePositives, findings.length),
  };
}

export function aggregateMetrics(metrics: readonly Metrics[]): Metrics {
  const truePositives = metrics.reduce((sum, item) => sum + item.truePositives, 0);
  const falsePositives = metrics.reduce((sum, item) => sum + item.falsePositives, 0);
  const falseNegatives = metrics.reduce((sum, item) => sum + item.falseNegatives, 0);
  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);
  const average = (
    field: keyof Pick<Metrics, 'locationAccuracy' | 'duplicateRate' | 'falsePositiveRate'>,
  ): number | null => {
    const values = metrics
      .map((item) => item[field])
      .filter((value): value is number => value !== null);
    return values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1: f1(precision, recall),
    locationAccuracy: average('locationAccuracy'),
    duplicateRate: average('duplicateRate'),
    falsePositiveRate: average('falsePositiveRate'),
  };
}

export function macroMetrics(metrics: readonly Metrics[]): Metrics {
  const aggregate = aggregateMetrics(metrics);
  const values = (field: keyof Metrics): number | null => {
    const selected = metrics
      .map((item) => item[field])
      .filter((value): value is number => typeof value === 'number');
    return selected.length === 0
      ? null
      : selected.reduce((sum, value) => sum + value, 0) / selected.length;
  };
  return {
    ...aggregate,
    precision: values('precision'),
    recall: values('recall'),
    f1: values('f1'),
    locationAccuracy: values('locationAccuracy'),
    duplicateRate: values('duplicateRate'),
    falsePositiveRate: values('falsePositiveRate'),
  };
}
