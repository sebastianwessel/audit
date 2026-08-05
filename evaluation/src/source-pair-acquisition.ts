import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

import {
  canonicalJson,
  createStableId,
  RelativePathSchema,
  sha256,
} from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import { loadCandidateRegistry } from './candidate-registry.js';
import {
  type AcquiredSourceFile,
  AcquiredSourceFileSchema,
  type AcquiredSourcePair,
  type AcquiredSourcePairCollectionSummary,
  AcquiredSourcePairCollectionSummarySchema,
  AcquiredSourcePairSchema,
  type AcquiredSourcePairSummary,
  AcquiredSourcePairSummarySchema,
  type AcquiredSourceVariant,
} from './source-pair-acquisition.schema.js';

const SnapshotRequestSchema = z.strictObject({
  registryPath: z.string().trim().min(1).max(1_024),
  candidateId: z.string().trim().min(1).max(64),
  repositoryRoot: z.string().trim().min(1).max(1_024),
  outputRoot: z.string().trim().min(1).max(1_024),
  capturedAt: z.iso.datetime({ offset: true }),
});

type SnapshotRequest = z.infer<typeof SnapshotRequestSchema>;

/**
 * Creates an atomic, fully local source-pair workspace from two pinned Git
 * commits. It reads Git objects only; it never invokes target code, fetches,
 * labels a vulnerability, or changes the metadata-only candidate registry.
 */
export async function acquirePinnedSourcePair(input: SnapshotRequest): Promise<AcquiredSourcePair> {
  const request = SnapshotRequestSchema.parse(input);
  const registry = await loadCandidateRegistry(request.registryPath);
  const candidate = registry.candidates.find((entry) => entry.candidateId === request.candidateId);
  if (candidate === undefined)
    throw acquisitionError('The requested candidate is absent from its registry.');

  const repositoryRoot = await existingDirectory(request.repositoryRoot, 'Repository root');
  const outputRoot = await existingOrCreateDirectory(request.outputRoot, 'Output root');
  const vulnerableRevision = await resolveCommit(repositoryRoot, candidate.vulnerableRevision);
  const patchedRevision = await resolveCommit(repositoryRoot, candidate.patchedRevision);
  if (
    vulnerableRevision !== candidate.vulnerableRevision ||
    patchedRevision !== candidate.patchedRevision
  ) {
    throw acquisitionError('A pinned candidate revision did not resolve exactly.');
  }

  const snapshotId = createStableId(
    'source-pair',
    `${registry.registryId}\0${registry.registryDigest}\0${candidate.candidateId}`,
  );
  const finalRoot = join(outputRoot, snapshotId);
  if (await pathExists(finalRoot)) throw acquisitionError('The source-pair output already exists.');
  const stagingRoot = await mkdtemp(join(outputRoot, `.staging-${snapshotId}-`));
  try {
    const vulnerable = await materializeRevision({
      repositoryRoot,
      revision: vulnerableRevision,
      directory: 'vulnerable',
      destinationRoot: stagingRoot,
    });
    const patched = await materializeRevision({
      repositoryRoot,
      revision: patchedRevision,
      directory: 'patched',
      destinationRoot: stagingRoot,
    });
    const unsigned = {
      schemaVersion: 1 as const,
      snapshotId,
      candidateRegistryId: registry.registryId,
      candidateRegistryDigest: registry.registryDigest,
      candidateId: candidate.candidateId,
      sourceRecordId: candidate.sourceRecordId,
      repositoryUrl: candidate.repositoryUrl,
      sourceLicenseStatus: candidate.sourceLicenseStatus,
      capturedAt: request.capturedAt,
      variants: { vulnerable, patched },
    };
    const snapshot = AcquiredSourcePairSchema.parse({
      ...unsigned,
      snapshotDigest: acquiredSourcePairDigest(unsigned),
    });
    await writeFile(
      join(stagingRoot, 'snapshot.json'),
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8',
    );
    await rename(stagingRoot, finalRoot);
    return snapshot;
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

/** Loads and rechecks every copied byte before a curator may use a workspace. */
export async function loadAcquiredSourcePair(root: string): Promise<AcquiredSourcePair> {
  const snapshotRoot = await existingDirectory(root, 'Source-pair root');
  await verifyWorkspaceEntries(snapshotRoot);
  const parsed = AcquiredSourcePairSchema.safeParse(
    await readJson(join(snapshotRoot, 'snapshot.json')),
  );
  if (!parsed.success) throw acquisitionError('Source-pair manifest schema is invalid.');
  const { snapshotDigest, ...unsigned } = parsed.data;
  if (acquiredSourcePairDigest(unsigned) !== snapshotDigest) {
    throw acquisitionError('Source-pair manifest digest does not match its content.');
  }
  await verifyVariant(snapshotRoot, parsed.data.variants.vulnerable);
  await verifyVariant(snapshotRoot, parsed.data.variants.patched);
  return parsed.data;
}

/**
 * Rechecks every local acquisition workspace without reading a candidate
 * registry, answer key, target jail, provider, or model output.
 */
export async function validateAcquiredSourcePairCollection(
  root: string,
): Promise<AcquiredSourcePairCollectionSummary> {
  const collectionRoot = await existingDirectory(root, 'Source-pair collection root');
  const entries = await readdir(collectionRoot, { withFileTypes: true });
  const snapshotRoots: string[] = [];
  for (const entry of entries) {
    const entryPath = join(collectionRoot, entry.name);
    const status = await lstat(entryPath);
    if (entry.name === 'README.md') {
      if (status.isSymbolicLink() || !status.isFile()) {
        throw acquisitionError('Source-pair collection README must be a regular file.');
      }
      continue;
    }
    if (status.isSymbolicLink() || !status.isDirectory()) {
      throw acquisitionError('Source-pair collection contains an unexpected entry.');
    }
    snapshotRoots.push(entryPath);
  }

  const snapshots: AcquiredSourcePairSummary[] = [];
  const snapshotIds = new Set<string>();
  const candidateIdentities = new Set<string>();
  for (const snapshotRoot of snapshotRoots.sort((left, right) => left.localeCompare(right))) {
    const snapshot = await loadAcquiredSourcePair(snapshotRoot);
    if (snapshot.snapshotId !== relative(collectionRoot, snapshotRoot)) {
      throw acquisitionError('Source-pair workspace directory does not match its snapshot id.');
    }
    if (snapshotIds.has(snapshot.snapshotId)) {
      throw acquisitionError('Source-pair collection contains a duplicate snapshot id.');
    }
    snapshotIds.add(snapshot.snapshotId);
    const candidateIdentity = `${snapshot.candidateRegistryId}\0${snapshot.candidateId}`;
    if (candidateIdentities.has(candidateIdentity)) {
      throw acquisitionError(
        'Source-pair collection contains a duplicate registry/candidate identity.',
      );
    }
    candidateIdentities.add(candidateIdentity);
    snapshots.push(acquiredSourcePairSummary(snapshot));
  }

  return AcquiredSourcePairCollectionSummarySchema.parse({
    snapshotCount: snapshots.length,
    snapshots,
  });
}

export function acquiredSourcePairDigest(
  snapshot: Omit<AcquiredSourcePair, 'snapshotDigest'>,
): string {
  return sha256(canonicalJson(snapshot));
}

export function acquiredSourcePairSummary(snapshot: AcquiredSourcePair): AcquiredSourcePairSummary {
  return AcquiredSourcePairSummarySchema.parse({
    snapshotId: snapshot.snapshotId,
    candidateId: snapshot.candidateId,
    vulnerableFileCount: snapshot.variants.vulnerable.files.length,
    patchedFileCount: snapshot.variants.patched.files.length,
    snapshotDigest: snapshot.snapshotDigest,
  });
}

async function materializeRevision(input: {
  repositoryRoot: string;
  revision: string;
  directory: 'vulnerable' | 'patched';
  destinationRoot: string;
}): Promise<AcquiredSourceVariant> {
  const files = await listTrackedRegularFiles(input.repositoryRoot, input.revision);
  const variantRoot = join(input.destinationRoot, input.directory);
  await mkdir(variantRoot, { recursive: true });
  for (const file of files) {
    const content = await gitBytes(input.repositoryRoot, ['cat-file', 'blob', file.objectId]);
    const destination = resolveInside(variantRoot, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
    await chmod(destination, Number.parseInt(file.mode, 8));
  }
  const manifestFiles = files.map(({ objectId: _objectId, ...file }) => file);
  return {
    revision: input.revision,
    directory: input.directory,
    files: manifestFiles,
    contentDigest: sourceVariantDigest(manifestFiles),
  };
}

async function verifyVariant(root: string, variant: AcquiredSourceVariant): Promise<void> {
  const variantRoot = resolveInside(root, variant.directory);
  const actual = await collectSnapshotFiles(variantRoot);
  if (canonicalJson(actual) !== canonicalJson(variant.files)) {
    throw acquisitionError(`Source-pair ${variant.directory} file manifest does not match.`);
  }
  if (sourceVariantDigest(actual) !== variant.contentDigest) {
    throw acquisitionError(`Source-pair ${variant.directory} content digest does not match.`);
  }
}

async function verifyWorkspaceEntries(root: string): Promise<void> {
  const allowed = new Map<string, 'file' | 'directory'>([
    ['snapshot.json', 'file'],
    ['vulnerable', 'directory'],
    ['patched', 'directory'],
  ]);
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length !== allowed.size) {
    throw acquisitionError('Source-pair workspace contains an unexpected entry.');
  }
  for (const entry of entries) {
    const expected = allowed.get(entry.name);
    const status = await lstat(join(root, entry.name));
    if (
      expected === undefined ||
      status.isSymbolicLink() ||
      (expected === 'file' && !status.isFile()) ||
      (expected === 'directory' && !status.isDirectory())
    ) {
      throw acquisitionError('Source-pair workspace contains an unexpected entry.');
    }
  }
}

function sourceVariantDigest(files: readonly AcquiredSourceFile[]): string {
  return sha256(files.map((file) => `${file.path}\0${file.mode}\0${file.digest}`).join('\n'));
}

async function listTrackedRegularFiles(
  repositoryRoot: string,
  revision: string,
): Promise<readonly (AcquiredSourceFile & Readonly<{ objectId: string }>)[]> {
  const output = await gitBytes(repositoryRoot, ['ls-tree', '-r', '-z', '--full-tree', revision]);
  const records = decodeUtf8(output, 'Git tree listing')
    .split('\0')
    .filter((record) => record.length > 0);
  const files = records.map((record) => {
    const separator = record.indexOf('\t');
    const header = separator === -1 ? undefined : record.slice(0, separator).split(' ');
    const path = separator === -1 ? undefined : record.slice(separator + 1);
    const [mode, kind, objectId] = header ?? [];
    const parsedMode = AcquiredSourceFileSchema.shape.mode.safeParse(mode);
    if (
      path === undefined ||
      kind !== 'blob' ||
      objectId === undefined ||
      !/^[a-f0-9]{40}$/u.test(objectId) ||
      !parsedMode.success
    ) {
      throw acquisitionError('The source repository contains a non-regular tracked entry.');
    }
    if (!RelativePathSchema.safeParse(path).success) {
      throw acquisitionError('The source repository contains an unsafe tracked path.');
    }
    return { path, mode: parsedMode.data, objectId, digest: '' };
  });
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  if (ordered.some((file, index) => index > 0 && ordered[index - 1]?.path === file.path)) {
    throw acquisitionError('The source repository contains duplicate tracked paths.');
  }
  const withDigests: (AcquiredSourceFile & Readonly<{ objectId: string }>)[] = [];
  for (const file of ordered) {
    const content = await gitBytes(repositoryRoot, ['cat-file', 'blob', file.objectId]);
    withDigests.push({ ...file, digest: sha256(content) });
  }
  return withDigests;
}

async function collectSnapshotFiles(root: string): Promise<AcquiredSourceFile[]> {
  await existingDirectory(root, 'Source variant root');
  const files: AcquiredSourceFile[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const status = await lstat(path);
      if (status.isSymbolicLink()) throw acquisitionError('Source-pair contains a symbolic link.');
      if (status.isDirectory()) {
        await visit(path, relativePath);
        continue;
      }
      if (!status.isFile()) throw acquisitionError('Source-pair contains a non-regular file.');
      files.push({
        path: RelativePathSchema.parse(relativePath),
        mode: (status.mode & 0o111) === 0 ? '100644' : '100755',
        digest: sha256(await readFile(path)),
      });
    }
  };
  await visit(root, '');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function resolveCommit(repositoryRoot: string, revision: string): Promise<string> {
  const output = await gitBytes(repositoryRoot, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${revision}^{commit}`,
  ]);
  const value = decodeUtf8(output, 'Git revision').trim();
  if (!/^[a-f0-9]{40}$/u.test(value))
    throw acquisitionError('Git did not resolve a commit identifier.');
  return value;
}

async function gitBytes(
  repositoryRoot: string,
  arguments_: readonly string[],
): Promise<Uint8Array> {
  const process = Bun.spawn(['git', '-C', repositoryRoot, ...arguments_], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const output = new Uint8Array(await new Response(process.stdout).arrayBuffer());
  if ((await process.exited) !== 0) throw acquisitionError('A local Git read did not complete.');
  return output;
}

function decodeUtf8(value: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw acquisitionError(`${label} is not valid UTF-8.`);
  }
}

async function existingDirectory(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  const status = await lstat(resolved).catch(() => undefined);
  if (status === undefined || !status.isDirectory() || status.isSymbolicLink()) {
    throw acquisitionError(`${label} must be an existing non-symbolic-link directory.`);
  }
  return resolved;
}

async function existingOrCreateDirectory(path: string, label: string): Promise<string> {
  const resolved = resolve(path);
  await mkdir(resolved, { recursive: true });
  return existingDirectory(resolved, label);
}

function resolveInside(root: string, path: string): string {
  if (isAbsolute(path)) throw acquisitionError('Source-pair paths must be relative.');
  const resolved = resolve(root, path);
  const child = relative(root, resolved);
  if (child.length === 0 || child.startsWith('..') || isAbsolute(child)) {
    throw acquisitionError('Source-pair path escapes its root.');
  }
  return resolved;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw acquisitionError('Cannot parse source-pair manifest.');
  }
}

async function pathExists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

function acquisitionError(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `Invalid source-pair acquisition: ${message}`);
}
