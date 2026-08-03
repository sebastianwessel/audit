import { z } from 'zod';

import { SecurityReviewerError } from '../shared/errors/security-reviewer-error.js';

const OptionValueSchema = z.string();

const PlanCommandOptionsSchema = z.strictObject({
  target: OptionValueSchema,
  context: OptionValueSchema.optional(),
  output: OptionValueSchema.optional(),
  'target-name': OptionValueSchema.optional(),
  provider: OptionValueSchema.optional(),
  model: OptionValueSchema.optional(),
  'api-key-env': OptionValueSchema.optional(),
  'max-parallel-vectors': OptionValueSchema.optional(),
  'max-estimated-cost-usd': OptionValueSchema.optional(),
});

const AuditCommandOptionsSchema = PlanCommandOptionsSchema.extend({
  plan: OptionValueSchema,
  'run-id': OptionValueSchema.optional(),
  resume: OptionValueSchema.optional(),
  'retry-unfinished': OptionValueSchema.optional(),
}).strict();

const ReportCommandOptionsSchema = z.strictObject({
  output: OptionValueSchema.optional(),
  report: OptionValueSchema,
});

const LineageCommandOptionsSchema = z.strictObject({
  output: OptionValueSchema.optional(),
  previous: OptionValueSchema,
  current: OptionValueSchema,
});

const CommandOptionsSchemas = {
  plan: PlanCommandOptionsSchema,
  audit: AuditCommandOptionsSchema,
  report: ReportCommandOptionsSchema,
  lineage: LineageCommandOptionsSchema,
} as const;

export type ProductCliCommand = keyof typeof CommandOptionsSchemas;

/** Rejects unknown or command-incompatible options before configuration or I/O. */
export function assertValidCommandOptions(
  command: ProductCliCommand,
  options: Readonly<Record<string, string>>,
): void {
  const parsed = CommandOptionsSchemas[command].safeParse(options);
  if (parsed.success) return;
  throw new SecurityReviewerError('invalid-input', `Invalid options for the ${command} command.`);
}
