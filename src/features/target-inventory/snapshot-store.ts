import { z } from 'zod';

import {
  ArtifactStoreError,
  acquireArtifactLease,
  readJsonArtifact,
  readOptionalJsonArtifact,
  readPrivateUtf8Artifact,
  removeArtifactDirectory,
  writeJsonArtifact,
  writeNewPrivateUtf8Artifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { sha256 } from '../../shared/contracts/core.js';

import type { TargetInventoryCapture } from './inventory.js';
import {
  ContextDocumentSchema,
  type SourceSnapshotManifest,
  SourceSnapshotManifestSchema,
  type TargetInventory,
  TargetInventorySchema,
} from './inventory.schema.js';
import {
  sourceCaptureContextPath,
  sourceCaptureDirectory,
  sourceCaptureManifestPath,
  sourceObjectPath,
} from './private-source-capture.js';
import { SourceSnapshot } from './source-snapshot.js';

const ContextSnapshotSchema = z.array(ContextDocumentSchema);

/**
 * Seals one run-owned private source capture before audit model work begins.
 * The capture already wrote each admitted object, so sealing persists only the
 * manifest/context and never builds a second repository-wide source array.
 */
export async function retainTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  capture: TargetInventoryCapture;
}): Promise<TargetInventoryCapture> {
  const lease = await acquireArtifactLease(
    input.outputRoot,
    snapshotRetentionLeasePath(input.runId),
  );
  try {
    const sourceSnapshot = retainedSourceSnapshotManifest(
      input.runId,
      input.capture.inventory.sourceSnapshot,
    );
    const directCapture = sourceSnapshot.rows.every(
      (row) =>
        row.disposition !== 'admitted' ||
        input.capture.inventory.sourceSnapshot.rows.some(
          (candidate) =>
            candidate.disposition === 'admitted' &&
            candidate.path === row.path &&
            candidate.objectRef === row.objectRef,
        ),
    );
    const persistedDigests = new Set<string>();
    for (const row of sourceSnapshot.rows) {
      if (row.disposition !== 'admitted') continue;
      const source = await input.capture.snapshot.document(row.path);
      if (
        sha256(source.content) !== row.contentDigest ||
        new TextEncoder().encode(source.content).byteLength !== row.byteLength
      ) {
        throw new Error('The captured source does not match its admission manifest.');
      }
      if (!directCapture && !persistedDigests.has(row.contentDigest)) {
        await writeNewPrivateUtf8Artifact(input.outputRoot, row.objectRef, source.content);
        persistedDigests.add(row.contentDigest);
      }
    }
    await writeJsonArtifact(
      input.outputRoot,
      sourceCaptureManifestPath(input.runId),
      SourceSnapshotManifestSchema,
      sourceSnapshot,
    );
    await writeJsonArtifact(
      input.outputRoot,
      sourceCaptureContextPath(input.runId, input.capture.inventory.contextDigest),
      ContextSnapshotSchema,
      input.capture.inventory.context,
    );
    return loadRetainedTargetSnapshot({
      outputRoot: input.outputRoot,
      runId: input.runId,
      targetFingerprint: input.capture.inventory.targetFingerprint,
      contextDigest: input.capture.inventory.contextDigest,
    });
  } finally {
    await lease.release();
  }
}

/** Reconstructs one exact run-owned source/context view without opening the mutable target. */
export async function loadRetainedTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  targetFingerprint: string;
  contextDigest: string;
}): Promise<TargetInventoryCapture> {
  const sourceSnapshot = await readRetainedSourceSnapshot(input.outputRoot, input.runId);
  if (sourceSnapshot.targetFingerprint !== input.targetFingerprint) {
    throw new Error('The retained source snapshot does not match the executable plan.');
  }
  const expectedDirectory = `${sourceCaptureDirectory(input.runId)}/objects/`;
  if (
    sourceSnapshot.rows.some(
      (row) => row.disposition === 'admitted' && !row.objectRef.startsWith(expectedDirectory),
    )
  ) {
    throw new Error('The retained source snapshot contains an invalid run-owned object reference.');
  }
  const context = await readJsonArtifact(
    input.outputRoot,
    sourceCaptureContextPath(input.runId, input.contextDigest),
    ContextSnapshotSchema,
  );
  const actualContextDigest = sha256(context.map((document) => document.digest).join('\n'));
  if (actualContextDigest !== input.contextDigest) {
    throw new Error('The retained context snapshot does not match the executable plan.');
  }
  const admittedRows = sourceSnapshot.rows.filter(
    (row): row is Extract<typeof row, { disposition: 'admitted' }> =>
      row.disposition === 'admitted',
  );
  const readAdmittedSource = createRetainedSourceReader(input.outputRoot, admittedRows);
  // Validate every retained object before audit dispatch without caching any
  // repository-wide content. Later scoped reads validate their own object again.
  for (const row of admittedRows) await readAdmittedSource(row.path);
  const inventory: TargetInventory = TargetInventorySchema.parse({
    targetFingerprint: input.targetFingerprint,
    contextDigest: input.contextDigest,
    summary: {
      fileCount: admittedRows.length,
      totalBytes: admittedRows.reduce((total, row) => total + row.byteLength, 0),
      languageHints: [...new Set(admittedRows.flatMap((row) => row.languageHint ?? []))].sort(),
    },
    sourceSnapshot,
    context,
  });
  return {
    inventory,
    snapshot: new SourceSnapshot({
      entries: admittedRows.map((row) => ({ relativePath: row.path, sizeBytes: row.byteLength })),
      readDocument: readAdmittedSource,
    }),
  };
}

/** Releases one run-owned snapshot after its terminal audit no longer needs resume state. */
export async function releaseTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  targetFingerprint: string;
}): Promise<void> {
  const lease = await acquireArtifactLease(
    input.outputRoot,
    snapshotRetentionLeasePath(input.runId),
  );
  try {
    const sourceSnapshot = await readJsonArtifact(
      input.outputRoot,
      sourceCaptureManifestPath(input.runId),
      SourceSnapshotManifestSchema,
    );
    if (sourceSnapshot.targetFingerprint !== input.targetFingerprint) {
      throw new Error('The retained source snapshot does not match the audit run to release.');
    }
    await removeArtifactDirectory(input.outputRoot, sourceCaptureDirectory(input.runId));
  } finally {
    await lease.release();
  }
}

/** Removes an exact discarded run's source capture, including a capture that never sealed. */
export async function discardRetainedTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  targetFingerprint: string;
}): Promise<void> {
  const lease = await acquireArtifactLease(
    input.outputRoot,
    snapshotRetentionLeasePath(input.runId),
  );
  try {
    const sourceSnapshot = await readOptionalJsonArtifact(
      input.outputRoot,
      sourceCaptureManifestPath(input.runId),
      SourceSnapshotManifestSchema,
    );
    if (
      sourceSnapshot !== undefined &&
      sourceSnapshot.targetFingerprint !== input.targetFingerprint
    ) {
      throw new Error('The retained source snapshot does not match the audit run to discard.');
    }
    await removeArtifactDirectory(input.outputRoot, sourceCaptureDirectory(input.runId));
  } finally {
    await lease.release();
  }
}

/** Public only for exact-path assertions; run identity, not target identity, owns private bytes. */
export function snapshotManifestPath(runId: string): string {
  return sourceCaptureManifestPath(runId);
}

function retainedSourceSnapshotManifest(
  runId: string,
  sourceSnapshot: SourceSnapshotManifest,
): SourceSnapshotManifest {
  return SourceSnapshotManifestSchema.parse({
    ...sourceSnapshot,
    rows: sourceSnapshot.rows.map((row) =>
      row.disposition === 'admitted'
        ? { ...row, objectRef: sourceObjectPath(runId, row.contentDigest) }
        : row,
    ),
  });
}

function createRetainedSourceReader(
  outputRoot: string,
  admittedRows: readonly Extract<
    SourceSnapshotManifest['rows'][number],
    { disposition: 'admitted' }
  >[],
) {
  const rowsByPath = new Map(admittedRows.map((row) => [row.path, row]));
  return async (path: string) => {
    const row = rowsByPath.get(path);
    if (row === undefined) throw new Error('The requested source is not in the retained snapshot.');
    const content = await readPrivateUtf8Artifact(outputRoot, row.objectRef);
    if (
      sha256(content) !== row.contentDigest ||
      new TextEncoder().encode(content).byteLength !== row.byteLength
    ) {
      throw new Error('A retained source object does not match its admission manifest.');
    }
    return { path: row.path, content, languageHint: row.languageHint };
  };
}

function snapshotRetentionLeasePath(runId: string): string {
  return `work/snapshot-retention/${runId}.lock`;
}

async function readRetainedSourceSnapshot(
  outputRoot: string,
  runId: string,
): Promise<SourceSnapshotManifest> {
  try {
    return await readJsonArtifact(
      outputRoot,
      sourceCaptureManifestPath(runId),
      SourceSnapshotManifestSchema,
    );
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found') {
      throw new Error('The audit run does not retain the requested source snapshot.');
    }
    throw error;
  }
}
