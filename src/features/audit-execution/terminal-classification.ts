import { z } from 'zod';

import type { AuditReport } from './audit.schema.js';

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

/** The sole projection from vector closure state to run outcome, counters, and exit code. */
export function classifyAuditTerminal(report: AuditReport): AuditTerminalClassification {
  const counters = {
    plannedVectors: report.coverage.length,
    completedVectors: report.coverage.filter((coverage) => coverage.completed).length,
    failedVectors: report.coverage.filter((coverage) => coverage.outcome === 'failed').length,
    findingCount: report.findings.length,
  };
  const outcomes = report.coverage.map((coverage) => coverage.outcome);
  const allComplete = outcomes.every(
    (outcome) => outcome === 'completed' || outcome === 'not-applicable' || outcome === 'skipped',
  );
  if (allComplete) {
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
