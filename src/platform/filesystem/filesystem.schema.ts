import { z } from 'zod';

import { RelativePathSchema } from '../../shared/contracts/core.js';

const isSafeGlob = (value: string): boolean => RelativePathSchema.safeParse(value).success;

export { RelativePathSchema } from '../../shared/contracts/core.js';

export const GlobSchema = z
  .string()
  .min(1)
  .refine(isSafeGlob, 'Expected a safe, slash-delimited relative glob.');

export const FilesystemRootSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['target', 'context']));
export type FilesystemRoot = z.infer<typeof FilesystemRootSchema>;

export const JailedReadOnlyFilesystemOptionsSchema = z.strictObject({
  targetRoot: z.string().min(1),
  contextRoot: z.string().min(1).optional(),
});
export type JailedReadOnlyFilesystemOptions = z.input<typeof JailedReadOnlyFilesystemOptionsSchema>;

export const ListFilesInputSchema = z.strictObject({
  root: FilesystemRootSchema.default('target'),
  includeGlobs: z.array(GlobSchema).min(1).default(['**/*']),
  excludeGlobs: z.array(GlobSchema).default([]),
});
export type ListFilesInput = z.input<typeof ListFilesInputSchema>;

export const FileEntrySchema = z.strictObject({
  relativePath: RelativePathSchema,
  sizeBytes: z.int().min(0),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

export const ListFilesResultSchema = z.strictObject({
  entries: z.array(FileEntrySchema),
});
export type ListFilesResult = z.infer<typeof ListFilesResultSchema>;

export const ReadFileInputSchema = z.strictObject({
  root: FilesystemRootSchema.default('target'),
  relativePath: RelativePathSchema,
  startLine: z.int().min(1).default(1),
  endLine: z.int().min(1).optional(),
});
export type ReadFileInput = z.input<typeof ReadFileInputSchema>;

export const ReadFileResultSchema = z.strictObject({
  relativePath: RelativePathSchema,
  startLine: z.int().min(1),
  endLine: z.int().min(1),
  text: z.string(),
});
export type ReadFileResult = z.infer<typeof ReadFileResultSchema>;

export const GrepModeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['literal', 'identifier', 'regex']));
export type GrepMode = z.infer<typeof GrepModeSchema>;

export const GrepFilesInputSchema = z.strictObject({
  root: FilesystemRootSchema.default('target'),
  pattern: z.string().min(1),
  mode: GrepModeSchema,
  caseSensitive: z.boolean().default(false),
  relativePaths: z.array(RelativePathSchema).min(1).optional(),
  contextLines: z.int().min(0).default(0),
});
export type GrepFilesInput = z.input<typeof GrepFilesInputSchema>;

export const GrepMatchSchema = z.strictObject({
  relativePath: RelativePathSchema,
  line: z.int().min(1),
  context: z.string(),
});
export type GrepMatch = z.infer<typeof GrepMatchSchema>;

export const GrepFilesResultSchema = z.strictObject({
  matches: z.array(GrepMatchSchema),
});
export type GrepFilesResult = z.infer<typeof GrepFilesResultSchema>;

export const FilesystemErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'INVALID_ROOT',
  'CONTEXT_ROOT_UNAVAILABLE',
  'FILE_NOT_FOUND',
  'NOT_A_FILE',
  'SYMLINK_ESCAPE',
  'UNSAFE_SYMLINK',
  'UNSAFE_TRANSACTION',
  'LIMIT_EXCEEDED',
  'INVALID_ENCODING',
  'INVALID_PATTERN',
]);
export type FilesystemErrorCode = z.infer<typeof FilesystemErrorCodeSchema>;
