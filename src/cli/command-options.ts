import { z } from 'zod';

import { AuditRuntimeError } from '../shared/errors/audit-runtime-error.js';
import { ProductLeaseOperationSchema } from './product-lease.js';

const OptionValueSchema = z.string();
const ResultFormatOptionSchema = z.literal('json').optional();

const SharedResultFormatOptionsSchema = z.strictObject({
  'result-format': ResultFormatOptionSchema,
});

const TargetCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  target: OptionValueSchema,
  context: OptionValueSchema.optional(),
  'target-name': OptionValueSchema.optional(),
});

const PlanCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  target: OptionValueSchema.optional(),
  context: OptionValueSchema.optional(),
  'target-name': OptionValueSchema.optional(),
  'run-id': OptionValueSchema.optional(),
  resume: OptionValueSchema.optional(),
}).superRefine((options, context) => {
  if (options.resume === 'true') {
    if (options['run-id'] === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['run-id'],
        message: 'Plan resume requires --run-id.',
      });
    }
    for (const option of ['target', 'context', 'target-name'] as const) {
      if (options[option] !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [option],
          message: `Plan resume does not accept --${option}.`,
        });
      }
    }
    return;
  }
  if (options.target === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Plan creation requires --target.',
    });
  }
});

const AuditCommandOptionsSchema = TargetCommandOptionsSchema.extend({
  plan: OptionValueSchema,
  'run-id': OptionValueSchema.optional(),
  resume: OptionValueSchema.optional(),
  'retry-unfinished': OptionValueSchema.optional(),
}).strict();

const GuidanceCommandOptionsSchema = TargetCommandOptionsSchema.extend({
  plan: OptionValueSchema,
  report: OptionValueSchema,
  'run-id': OptionValueSchema.optional(),
  resume: OptionValueSchema.optional(),
  'retry-unfinished': OptionValueSchema.optional(),
}).strict();

const ReportCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  report: OptionValueSchema,
});

const LineageCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  previous: OptionValueSchema,
  current: OptionValueSchema,
});

const PlanDraftCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  plan: OptionValueSchema,
  draft: OptionValueSchema,
});

const PlanResealCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  plan: OptionValueSchema.optional(),
  draft: OptionValueSchema.optional(),
  'run-id': OptionValueSchema.optional(),
  resume: OptionValueSchema.optional(),
}).superRefine((options, context) => {
  if (options.resume === 'true') {
    if (options['run-id'] === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['run-id'],
        message: 'Plan reseal resume requires --run-id.',
      });
    }
    for (const option of ['plan', 'draft'] as const) {
      if (options[option] !== undefined) {
        context.addIssue({
          code: 'custom',
          path: [option],
          message: `Plan reseal resume does not accept --${option}.`,
        });
      }
    }
    return;
  }
  for (const option of ['plan', 'draft'] as const) {
    if (options[option] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [option],
        message: `Plan reseal requires --${option}.`,
      });
    }
  }
});

/** Discard owns only one validated private-work run; it cannot address other roots. */
const DiscardCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  plan: OptionValueSchema,
  'run-id': OptionValueSchema,
});

const LockCommandOptionsSchema = SharedResultFormatOptionsSchema.extend({
  'run-id': OptionValueSchema,
  operation: ProductLeaseOperationSchema.optional(),
  release: z.literal('true').optional(),
}).superRefine((options, context) => {
  if (options.release === 'true' && options.operation === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['operation'],
      message: 'Lock release requires --operation.',
    });
  }
  if (options.release === undefined && options.operation !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['release'],
      message: 'Lock operation confirmation requires --release true.',
    });
  }
});

const CommandOptionsSchemas = {
  plan: PlanCommandOptionsSchema,
  audit: AuditCommandOptionsSchema,
  guidance: GuidanceCommandOptionsSchema,
  report: ReportCommandOptionsSchema,
  lineage: LineageCommandOptionsSchema,
  'plan-draft': PlanDraftCommandOptionsSchema,
  'plan-reseal': PlanResealCommandOptionsSchema,
  discard: DiscardCommandOptionsSchema,
  lock: LockCommandOptionsSchema,
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
