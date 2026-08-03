import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

type JsonArtifactValue = z.output<ReturnType<typeof z.json>>;
type JsonArtifactObject = { [key: string]: JsonArtifactValue };

export type ArtifactStoreErrorCode =
  | 'artifact-invalid-output-root'
  | 'artifact-root-topology-invalid'
  | 'artifact-invalid-output-path'
  | 'artifact-schema-invalid'
  | 'artifact-json-invalid'
  | 'artifact-read-failed'
  | 'artifact-write-failed'
  | 'artifact-lease-unavailable';

export class ArtifactStoreError extends Error {
  public constructor(
    public readonly code: ArtifactStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactStoreError';
  }
}

export type ArtifactLease = Readonly<{ release: () => Promise<void> }>;

/**
 * Acquires one output-jail lock.
 *
 * A pre-existing lock always fails closed. A PID-file lease has no portable,
 * race-free compare-and-delete operation, so application code must never
 * infer that a lease is stale and unlink it. Operators may resolve an
 * abandoned lease outside a running reviewer process, then resume from the
 * retained immutable snapshot and checkpoints.
 */
export async function acquireArtifactLease(
  outputRoot: string,
  artifactPath: string,
): Promise<ArtifactLease> {
  const lockPath = await resolveArtifactWritePath(outputRoot, artifactPath, '.lock');
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    try {
      await handle.writeFile('security-reviewer-artifact-lease\n', 'utf8');
    } finally {
      await handle.close();
    }
    return Object.freeze({
      release: async () => {
        await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
        });
      },
    });
  } catch (error) {
    if (isExistingFileError(error)) {
      throw new ArtifactStoreError(
        'artifact-lease-unavailable',
        'An active or unresolved artifact lease already exists.',
      );
    }
    throw error;
  }
}

/**
 * Writes a validated JSON artifact inside an existing, non-symlink output root.
 * The caller owns the artifact schema; this adapter never defines product shapes.
 */
export async function writeJsonArtifact<TSchema extends z.ZodType<JsonArtifactValue>>(
  outputRoot: string,
  artifactPath: string,
  schema: TSchema,
  data: z.input<TSchema>,
): Promise<void> {
  const parsedData = schema.safeParse(data);

  if (!parsedData.success) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'The JSON artifact does not match its schema.',
    );
  }

  const destinationPath = await resolveArtifactWritePath(outputRoot, artifactPath, '.json');
  await writeAtomically(outputRoot, destinationPath, stableJsonStringify(parsedData.data));
}

/** Writes a UTF-8 Markdown projection inside the same jailed artifact root. */
export async function writeMarkdownArtifact(
  outputRoot: string,
  artifactPath: string,
  content: string,
): Promise<void> {
  const destinationPath = await resolveArtifactWritePath(outputRoot, artifactPath, '.md');
  await writeAtomically(outputRoot, destinationPath, content);
}

/** Writes private UTF-8 data that belongs to a feature-owned, validated manifest. */
export async function writePrivateUtf8Artifact(
  outputRoot: string,
  artifactPath: string,
  content: string,
): Promise<void> {
  const destinationPath = await resolveArtifactWritePath(outputRoot, artifactPath, '.txt');
  await writeAtomically(outputRoot, destinationPath, content);
}

/** Writes independently schema-validated JSON records for streaming diagnostics. */
export async function writeJsonLinesArtifact<TSchema extends z.ZodType<JsonArtifactValue>>(
  outputRoot: string,
  artifactPath: string,
  schema: TSchema,
  records: readonly z.input<TSchema>[],
): Promise<void> {
  const parsedRecords: z.output<TSchema>[] = [];
  for (const record of records) {
    const parsedRecord = schema.safeParse(record);
    if (!parsedRecord.success) {
      throw new ArtifactStoreError(
        'artifact-schema-invalid',
        'A JSON-lines artifact record does not match its schema.',
      );
    }
    parsedRecords.push(parsedRecord.data);
  }
  const destinationPath = await resolveArtifactWritePath(outputRoot, artifactPath, '.jsonl');
  const content = `${parsedRecords.map((record) => stableJsonLine(record)).join('\n')}\n`;
  await writeAtomically(outputRoot, destinationPath, content);
}

async function writeAtomically(
  outputRoot: string,
  destinationPath: string,
  content: string,
): Promise<void> {
  const canonicalOutputRoot = await resolveOutputRoot(outputRoot);
  const temporaryPath = resolve(
    dirname(destinationPath),
    `.${basename(destinationPath)}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await assertExistingArtifactPathIsSafe(canonicalOutputRoot, destinationPath);
    await rename(temporaryPath, destinationPath);
  } catch (error) {
    await removeTemporaryArtifact(temporaryPath);

    if (error instanceof ArtifactStoreError) {
      throw error;
    }

    throw new ArtifactStoreError('artifact-write-failed', 'The artifact could not be written.');
  }
}

/**
 * Reads a JSON artifact from the output jail and validates it with the caller's
 * schema before returning its inferred output type.
 */
export async function readJsonArtifact<TSchema extends z.ZodType<JsonArtifactValue>>(
  outputRoot: string,
  artifactPath: string,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  const artifactAbsolutePath = await resolveArtifactReadPath(outputRoot, artifactPath, '.json');
  let fileContent: string;

  try {
    fileContent = await readFile(artifactAbsolutePath, 'utf8');
  } catch {
    throw new ArtifactStoreError('artifact-read-failed', 'The JSON artifact could not be read.');
  }

  const parsedJson = parseJsonArtifact(fileContent);
  const parsedData = schema.safeParse(parsedJson);

  if (!parsedData.success) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'The JSON artifact does not match its schema.',
    );
  }

  return parsedData.data;
}

/** Reads private UTF-8 data only from the same jailed output root. */
export async function readPrivateUtf8Artifact(
  outputRoot: string,
  artifactPath: string,
): Promise<string> {
  const artifactAbsolutePath = await resolveArtifactReadPath(outputRoot, artifactPath, '.txt');
  try {
    return await readFile(artifactAbsolutePath, 'utf8');
  } catch {
    throw new ArtifactStoreError('artifact-read-failed', 'The private artifact could not be read.');
  }
}

/** Removes only a validated, non-symlink directory beneath the artifact jail. */
export async function removeArtifactDirectory(
  outputRoot: string,
  artifactPath: string,
): Promise<void> {
  const canonicalOutputRoot = await resolveOutputRoot(outputRoot);
  validateArtifactDirectoryPath(artifactPath);
  const destinationPath = join(canonicalOutputRoot, ...artifactPath.split('/'));
  await assertExistingArtifactPathIsSafe(canonicalOutputRoot, destinationPath);
  const status = await lstat(destinationPath).catch(() => undefined);
  if (status === undefined) return;
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new ArtifactStoreError(
      'artifact-invalid-output-path',
      'The artifact directory must be a non-symbolic-link directory.',
    );
  }
  await rm(destinationPath, { recursive: true, force: false }).catch(() => {
    throw new ArtifactStoreError(
      'artifact-write-failed',
      'The artifact directory could not be removed.',
    );
  });
}

function parseJsonArtifact(fileContent: string): JsonArtifactValue {
  try {
    const parsedJson = z.json().safeParse(JSON.parse(fileContent));

    if (!parsedJson.success) {
      throw new ArtifactStoreError('artifact-json-invalid', 'The artifact is not valid JSON.');
    }

    return parsedJson.data;
  } catch {
    throw new ArtifactStoreError('artifact-json-invalid', 'The artifact is not valid JSON.');
  }
}

function stableJsonStringify(value: JsonArtifactValue): string {
  return `${JSON.stringify(value, stableJsonReplacer, 2)}\n`;
}

function stableJsonLine(value: JsonArtifactValue): string {
  return JSON.stringify(value, stableJsonReplacer);
}

function stableJsonReplacer(_key: string, value: JsonArtifactValue): JsonArtifactValue {
  if (!isJsonArtifactObject(value)) {
    return value;
  }

  const sortedObject: JsonArtifactObject = {};

  for (const key of Object.keys(value).sort()) {
    const propertyValue = value[key];

    if (propertyValue !== undefined) {
      sortedObject[key] = propertyValue;
    }
  }

  return sortedObject;
}

function isJsonArtifactObject(value: JsonArtifactValue): value is JsonArtifactObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function resolveArtifactWritePath(
  outputRoot: string,
  artifactPath: string,
  extension: '.json' | '.md' | '.jsonl' | '.txt' | '.lock',
): Promise<string> {
  const canonicalOutputRoot = await resolveOutputRoot(outputRoot);
  validateArtifactPath(artifactPath, extension);
  const segments = artifactPath.split('/');
  const fileName = segments.pop();
  if (fileName === undefined) {
    throw new ArtifactStoreError('artifact-invalid-output-path', 'The artifact path is invalid.');
  }
  const destinationParent = await ensureArtifactWriteParent(canonicalOutputRoot, segments);
  const destinationPath = join(destinationParent, fileName);
  await assertExistingArtifactPathIsSafe(canonicalOutputRoot, destinationPath);
  return destinationPath;
}

async function resolveArtifactReadPath(
  outputRoot: string,
  artifactPath: string,
  extension: '.json' | '.txt',
): Promise<string> {
  const canonicalOutputRoot = await resolveOutputRoot(outputRoot);
  validateArtifactPath(artifactPath, extension);
  const destinationPath = join(canonicalOutputRoot, ...artifactPath.split('/'));
  await assertExistingArtifactPathIsSafe(canonicalOutputRoot, destinationPath);
  return destinationPath;
}

async function resolveOutputRoot(outputRoot: string): Promise<string> {
  const resolvedOutputRoot = resolve(outputRoot);

  try {
    const outputRootStatus = await lstat(resolvedOutputRoot);

    if (!outputRootStatus.isDirectory() || outputRootStatus.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'artifact-invalid-output-root',
        'The output root must be an existing non-symbolic-link directory.',
      );
    }

    return await realpath(resolvedOutputRoot);
  } catch (error) {
    if (error instanceof ArtifactStoreError) {
      throw error;
    }

    throw new ArtifactStoreError(
      'artifact-invalid-output-root',
      'The output root must be an existing non-symbolic-link directory.',
    );
  }
}

function validateArtifactPath(
  artifactPath: string,
  extension: '.json' | '.md' | '.jsonl' | '.txt' | '.lock',
): void {
  if (
    artifactPath.length === 0 ||
    artifactPath.includes('\u0000') ||
    isAbsolute(artifactPath) ||
    artifactPath
      .split('/')
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    !artifactPath.endsWith(extension)
  ) {
    throw new ArtifactStoreError(
      'artifact-invalid-output-path',
      `Artifact paths must be non-empty relative ${extension} paths.`,
    );
  }
}

function validateArtifactDirectoryPath(artifactPath: string): void {
  if (
    artifactPath.length === 0 ||
    artifactPath.includes('\u0000') ||
    isAbsolute(artifactPath) ||
    artifactPath
      .split('/')
      .some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new ArtifactStoreError(
      'artifact-invalid-output-path',
      'Artifact directories must be non-empty relative paths.',
    );
  }
}

async function ensureArtifactWriteParent(
  outputRoot: string,
  directorySegments: readonly string[],
): Promise<string> {
  let currentPath = outputRoot;
  for (const segment of directorySegments) {
    const nextPath = join(currentPath, segment);
    const status = await lstat(nextPath).catch(() => undefined);
    if (status === undefined) {
      try {
        await mkdir(nextPath, { mode: 0o700 });
      } catch {
        // A concurrent owner may have created the component; validate it below.
      }
    }
    const validated = await lstat(nextPath).catch(() => undefined);
    if (validated === undefined || !validated.isDirectory() || validated.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'artifact-invalid-output-path',
        'The artifact parent cannot be used inside the output root.',
      );
    }
    const canonicalPath = await realpath(nextPath).catch(() => undefined);
    if (canonicalPath === undefined || !isInsideOrEqualToOutputRoot(outputRoot, canonicalPath)) {
      throw new ArtifactStoreError(
        'artifact-invalid-output-path',
        'The artifact parent resolves outside the output root.',
      );
    }
    currentPath = canonicalPath;
  }
  return currentPath;
}

async function assertExistingArtifactPathIsSafe(
  outputRoot: string,
  destinationPath: string,
): Promise<void> {
  if (!isInsideOutputRoot(outputRoot, destinationPath)) {
    throw new ArtifactStoreError(
      'artifact-invalid-output-path',
      'The artifact path must stay inside the output root.',
    );
  }
  const relativePath = relative(outputRoot, destinationPath);
  const segments = relativePath.split('/');
  let currentPath = outputRoot;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    currentPath = join(currentPath, segment);
    const status = await lstat(currentPath).catch(() => undefined);
    if (status === undefined) return;
    if (status.isSymbolicLink() || (index < segments.length - 1 && !status.isDirectory())) {
      throw new ArtifactStoreError(
        'artifact-invalid-output-path',
        'The artifact path contains an unsafe component.',
      );
    }
  }
}

function isInsideOutputRoot(outputRoot: string, candidatePath: string): boolean {
  const rootRelativePath = relative(outputRoot, candidatePath);

  return rootRelativePath.length > 0 && isInsideOrEqualToOutputRoot(outputRoot, candidatePath);
}

function isInsideOrEqualToOutputRoot(outputRoot: string, candidatePath: string): boolean {
  const rootRelativePath = relative(outputRoot, candidatePath);

  return !rootRelativePath.startsWith('..') && !isAbsolute(rootRelativePath);
}

async function removeTemporaryArtifact(temporaryPath: string): Promise<void> {
  try {
    await rm(temporaryPath, { force: true });
  } catch {
    // Preserve the original write error; cleanup is best effort.
  }
}

function isExistingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}
