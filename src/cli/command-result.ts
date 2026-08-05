import { z } from 'zod';

import { IdentifierSchema, RelativePathSchema } from '../shared/contracts/core.js';
import type { ProductCliCommand } from './command-options.js';

export const CliResultFormatSchema = z.literal('json');

const CommandArtifactKindSchema = z.enum([
  'plan-json',
  'plan-markdown',
  'plan-draft',
  'report-json',
  'report-markdown',
  'guidance-json',
  'guidance-markdown',
  'lineage-json',
  'run-manifest',
]);

const CommandArtifactReferenceSchema = z.strictObject({
  kind: CommandArtifactKindSchema,
  path: RelativePathSchema,
});

const CommandResultStatusSchema = z.enum(['completed', 'partial', 'discarded']);
const CommandExitMeaningSchema = z.enum([
  'completed-no-accepted-findings',
  'completed-with-accepted-findings',
  'incomplete-coverage',
  'discarded-private-work',
]);

/** The sole machine-readable stdout contract for product CLI commands. */
export const CliCommandResultSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    command: z.enum([
      'plan',
      'plan-draft',
      'plan-reseal',
      'audit',
      'guidance',
      'discard',
      'report',
      'lineage',
    ]),
    status: CommandResultStatusSchema,
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(3)]),
    exitMeaning: CommandExitMeaningSchema,
    identifiers: z.strictObject({
      runId: IdentifierSchema.optional(),
      planId: IdentifierSchema.optional(),
      reportId: IdentifierSchema.optional(),
      guidanceId: IdentifierSchema.optional(),
      lineageId: IdentifierSchema.optional(),
    }),
    artifacts: z.array(CommandArtifactReferenceSchema),
  })
  .superRefine((value, context) => {
    const paths = value.artifacts.map((artifact) => artifact.path);
    if (new Set(paths).size === paths.length) return;
    context.addIssue({
      code: 'custom',
      path: ['artifacts'],
      message: 'CLI result artifact paths must be unique.',
    });
  });

export type CliCommandResult = z.infer<typeof CliCommandResultSchema>;

export function usesJsonResult(options: Readonly<Record<string, string>>): boolean {
  return options['result-format'] === 'json';
}

export function writeCliCommandResult(
  options: Readonly<Record<string, string>>,
  result: CliCommandResult,
  humanOutput: string,
): void {
  const validated = CliCommandResultSchema.parse(result);
  process.stdout.write(usesJsonResult(options) ? `${JSON.stringify(validated)}\n` : humanOutput);
}

export function commandExitMeaning(
  command: ProductCliCommand,
  exitCode: 0 | 1 | 3,
): z.infer<typeof CommandExitMeaningSchema> {
  if (command === 'discard') return 'discarded-private-work';
  if (exitCode === 1) return 'completed-with-accepted-findings';
  return exitCode === 3 ? 'incomplete-coverage' : 'completed-no-accepted-findings';
}
