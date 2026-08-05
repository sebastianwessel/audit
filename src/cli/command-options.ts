import { z } from 'zod';

import { AuditRuntimeError } from '../shared/errors/audit-runtime-error.js';

const OptionValueSchema = z.string();
const ResultFormatOptionSchema = z.literal('json').optional();

const SharedResultFormatOptionsSchema = z.strictObject({
  'result-format': ResultFormatOptionSchema,
});

const PlanCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  target: OptionValueSchema,
  context: OptionValueSchema.optional(),
  work: OptionValueSchema.optional(),
  'target-name': OptionValueSchema.optional(),
});

const AuditCommandOptionsSchema = PlanCommandOptionsSchema.extend({
  plan: OptionValueSchema,
  'public-output': OptionValueSchema.optional(),
  'run-id': OptionValueSchema.optional(),
  resume: OptionValueSchema.optional(),
  'retry-unfinished': OptionValueSchema.optional(),
}).strict();

const GuidanceCommandOptionsSchema = PlanCommandOptionsSchema.extend({
  plan: OptionValueSchema,
  report: OptionValueSchema,
  'public-output': OptionValueSchema.optional(),
  'run-id': OptionValueSchema.optional(),
  resume: OptionValueSchema.optional(),
  'retry-unfinished': OptionValueSchema.optional(),
}).strict();

const ReportCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  'public-output': OptionValueSchema,
  report: OptionValueSchema,
});

const LineageCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  'public-output': OptionValueSchema,
  previous: OptionValueSchema,
  current: OptionValueSchema,
});

const PlanAuthoringCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  work: OptionValueSchema,
  plan: OptionValueSchema,
  draft: OptionValueSchema,
});

/** Discard owns only one validated private-work run; it cannot address other roots. */
const DiscardCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  work: OptionValueSchema,
  plan: OptionValueSchema,
  'run-id': OptionValueSchema,
});

const CommandOptionsSchemas = {
  plan: PlanCommandOptionsSchema,
  audit: AuditCommandOptionsSchema,
  guidance: GuidanceCommandOptionsSchema,
  report: ReportCommandOptionsSchema,
  lineage: LineageCommandOptionsSchema,
  'plan-draft': PlanAuthoringCommandOptionsSchema,
  'plan-reseal': PlanAuthoringCommandOptionsSchema,
  discard: DiscardCommandOptionsSchema,
} as const;

export type ProductCliCommand = keyof typeof CommandOptionsSchemas;
export const productCliCommands = Object.keys(CommandOptionsSchemas) as ProductCliCommand[];

export function commandOptionNames(command: ProductCliCommand): readonly string[] {
  return Object.keys(CommandOptionsSchemas[command].shape).sort((left, right) =>
    left.localeCompare(right),
  );
}

export function requiredCommandOptionNames(command: ProductCliCommand): readonly string[] {
  return Object.entries(CommandOptionsSchemas[command].shape)
    .filter(([, schema]) => !schema.isOptional())
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}

/** Rejects unknown or command-incompatible options before configuration or I/O. */
export function assertValidCommandOptions(
  command: ProductCliCommand,
  options: Readonly<Record<string, string>>,
): void {
  const parsed = CommandOptionsSchemas[command].safeParse(options);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  const path = issue?.path[0];
  const option = typeof path === 'string' ? `--${path}` : 'an option';
  const detail =
    issue?.code === 'unrecognized_keys'
      ? `Unknown option ${issue.keys.map((key) => `--${key}`).join(', ')}.`
      : issue?.code === 'invalid_type' && issue.input === undefined
        ? `Missing required option ${option}.`
        : `Invalid value for ${option}.`;
  throw new AuditRuntimeError(
    'invalid-input',
    `${detail} Run \`audit help ${command}\` for the accepted options.`,
  );
}
