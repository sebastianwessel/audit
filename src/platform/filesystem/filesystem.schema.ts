import { z } from 'zod';

const isSafeRelativePath = (value: string): boolean => {
  if (value.length === 0 || value.includes('\0') || value.includes('\\')) {
    return false;
  }

  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    return false;
  }

  return value
    .split('/')
    .every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
};

const isSafeGlob = (value: string): boolean => isSafeRelativePath(value);

export const RelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(isSafeRelativePath, 'Expected a safe, slash-delimited relative path.');

export const GlobSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(isSafeGlob, 'Expected a safe, slash-delimited relative glob.');

export const FilesystemRootSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['target', 'context']));
export type FilesystemRoot = z.infer<typeof FilesystemRootSchema>;

export const JailedReadOnlyFilesystemOptionsSchema = z.strictObject({
  targetRoot: z.string().min(1).max(4_096),
  contextRoot: z.string().min(1).max(4_096).optional(),
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
  'LIMIT_EXCEEDED',
  'INVALID_ENCODING',
  'INVALID_PATTERN',
]);
export type FilesystemErrorCode = z.infer<typeof FilesystemErrorCodeSchema>;
