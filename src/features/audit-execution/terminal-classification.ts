import { z } from 'zod';

/**
 * The dependency-free subset used for terminal state only. It intentionally
 * avoids importing the full audit schema, which itself calls this predicate
 * while constructing vector coverage.
 */
type TerminalClosure = Readonly<{
  terminalDisposition:
    | 'finding-admitted'
    | 'candidate-rejected'
    | 'review-required'
    | 'no-source-backed-candidate'
    | 'not-applicable'
    | 'incomplete'
    | 'not-reached';
}>;

type TerminalCoverage = Readonly<{
  completed: boolean;
  outcome: 'completed' | 'not-applicable' | 'incomplete' | 'skipped' | 'failed' | 'cancelled';
  obligationClosure: readonly TerminalClosure[];
  planned: boolean;
}>;

type TerminalReport = Readonly<{
  coverage: readonly TerminalCoverage[];
  findings: readonly object[];
  reviewRequired: readonly object[];
  errors: readonly object[];
}>;

export const AuditTerminalClassificationSchema = z.strictObject({
  outcome: z.enum(['completed', 'partial', 'failed', 'cancelled']),
  exitCode: z.union([z.literal(0), z.literal(1), z.literal(3)]),
  counters: z.strictObject({
    plannedVectors: z.number().int().nonnegative(),
    completedVectors: z.number().int().nonnegative(),
    failedVectors: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
  }),
});

export type AuditTerminalClassification = z.infer<typeof AuditTerminalClassificationSchema>;

/**
 * The only terminal-completion predicate shared by report classification and
 * persisted vector-coverage validation. A completed label cannot override an
 * unresolved plan obligation.
 */
export function isTerminallyCompleteVector(
  coverage: Pick<TerminalCoverage, 'completed' | 'outcome' | 'obligationClosure'>,
): boolean {
  if (!coverage.completed) return false;
  if (coverage.outcome === 'skipped') return true;
  if (
    coverage.obligationClosure.some(
      (closure) =>
        closure.terminalDisposition === 'incomplete' ||
        closure.terminalDisposition === 'not-reached',
    )
  )
    return false;
  const entirelyNotApplicable = coverage.obligationClosure.every(
    (closure) => closure.terminalDisposition === 'not-applicable',
  );
  if (coverage.outcome === 'not-applicable') return entirelyNotApplicable;
  return coverage.outcome === 'completed' && !entirelyNotApplicable;
}

/** The sole projection from vector closure state to run outcome, counters, and exit code. */
export function classifyAuditTerminal(report: TerminalReport): AuditTerminalClassification {
  const counters = {
    plannedVectors: report.coverage.filter((coverage) => coverage.planned).length,
    completedVectors: report.coverage.filter((coverage) => coverage.completed).length,
    failedVectors: report.coverage.filter((coverage) => coverage.outcome === 'failed').length,
    findingCount: report.findings.length,
  };
  const outcomes = report.coverage.map((coverage) => coverage.outcome);
  const allComplete = report.coverage.every(isTerminallyCompleteVector);
  if (allComplete && report.errors.length === 0) {
    return AuditTerminalClassificationSchema.parse({
      outcome: 'completed',
      exitCode: report.findings.length > 0 ? 1 : 0,
      counters,
    });
  }
  if (outcomes.every((outcome) => outcome === 'cancelled')) {
    return AuditTerminalClassificationSchema.parse({ outcome: 'cancelled', exitCode: 3, counters });
  }
  if (outcomes.every((outcome) => outcome === 'failed')) {
    return AuditTerminalClassificationSchema.parse({ outcome: 'failed', exitCode: 3, counters });
  }
  return AuditTerminalClassificationSchema.parse({ outcome: 'partial', exitCode: 3, counters });
}
