import { z } from 'zod';

import { RelativePathSchema } from '../../../shared/contracts/core.js';

export const RepoListToolInputSchema = z.strictObject({
  includeGlobs: z.array(z.string().trim().min(1)).min(1).default(['**/*']),
  excludeGlobs: z.array(z.string().trim().min(1)).default([]),
});

export const RepoListToolOutputSchema = z.strictObject({
  entries: z.array(
    z.strictObject({
      path: RelativePathSchema,
      sizeBytes: z.number().int().nonnegative(),
      languageHint: z.string().trim().min(1).nullable(),
    }),
  ),
});

export const RepoReadToolInputSchema = z.strictObject({
  path: RelativePathSchema,
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

/** One exact source line returned by the read-only repository tool. */
export const RepoSourceLineSchema = z.strictObject({
  line: z.number().int().positive(),
  text: z.string(),
});

export const RepoReadToolOutputSchema = z.strictObject({
  path: RelativePathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  /**
   * Line-addressable source preserves exact physical coordinates for model
   * evidence selection. It deliberately has no response-size cap; normal
   * provider context recovery owns lossless partitioning when necessary.
   */
  lines: z.array(RepoSourceLineSchema),
});

export const RepoGrepToolInputSchema = z.strictObject({
  pattern: z.string().trim().min(1),
  mode: z.enum(['literal', 'identifier', 'regex']),
  caseSensitive: z.boolean(),
  paths: z.array(RelativePathSchema).optional(),
  contextLines: z.number().int().nonnegative().optional(),
});

export const RepoGrepToolOutputSchema = z.strictObject({
  matches: z.array(
    z.strictObject({
      path: RelativePathSchema,
      line: z.number().int().positive(),
      context: z.string(),
    }),
  ),
});

export const ReviewRepositoryToolIds = ['repo_list', 'repo_read', 'repo_grep'] as const;

/** Source-free protocol state projected into every source-deciding model input. */
export const ScopedInspectionRequirementSchema = z.strictObject({
  required: z.boolean(),
  allowedToolIds: z.tuple([z.literal('repo_read'), z.literal('repo_grep')]),
});

export type ScopedInspectionRequirement = z.infer<typeof ScopedInspectionRequirementSchema>;

export function scopedInspectionRequirement(
  sourcePaths: readonly string[],
): ScopedInspectionRequirement {
  return ScopedInspectionRequirementSchema.parse({
    required: sourcePaths.length > 0,
    allowedToolIds: ['repo_read', 'repo_grep'],
  });
}

export const ReviewRepositoryToolDescriptions = Object.freeze({
  repo_list:
    'List allowlisted repository files. Omitted filters list every file in the approved scope; never returns absolute paths.',
  repo_read:
    'Read an allowlisted source range as exact physical line records. Cite the returned line number; never estimate a line number by counting text.',
  repo_grep:
    'Search allowlisted source text with explicit literal, identifier, or safe-regex and casing behavior. Optional contextLines adds surrounding lines.',
});

export type ReviewRepositoryToolset = Readonly<{
  listFiles: (
    input: z.infer<typeof RepoListToolInputSchema>,
  ) => Promise<z.infer<typeof RepoListToolOutputSchema>>;
  readFile: (
    input: z.infer<typeof RepoReadToolInputSchema>,
  ) => Promise<z.infer<typeof RepoReadToolOutputSchema>>;
  grepFiles: (
    input: z.infer<typeof RepoGrepToolInputSchema>,
  ) => Promise<z.infer<typeof RepoGrepToolOutputSchema>>;
}>;
