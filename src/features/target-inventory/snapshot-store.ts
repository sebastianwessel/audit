import { z } from 'zod';

import {
  ArtifactStoreError,
  acquireArtifactLease,
  readJsonArtifact,
  readPrivateUtf8Artifact,
  removeArtifactDirectory,
  removeJsonArtifact,
  writeJsonArtifact,
  writePrivateUtf8Artifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { sha256 } from '../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';

import type { TargetInventoryCapture } from './inventory.js';
import {
  ContextDocumentSchema,
  SourceSnapshotManifestSchema,
  type SourceSnapshotRetentionIndex,
  SourceSnapshotRetentionIndexSchema,
  type TargetInventory,
  TargetInventorySchema,
} from './inventory.schema.js';
import { SourceSnapshot } from './source-snapshot.js';

const ContextSnapshotSchema = z.array(ContextDocumentSchema);

/** Persists and retains a private snapshot before audit model work begins. */
export async function retainTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  capture: TargetInventoryCapture;
}): Promise<void> {
  const lease = await acquireArtifactLease(
    input.outputRoot,
    snapshotRetentionLeasePath(input.capture.inventory.targetFingerprint),
  );
  try {
    const { capture } = input;
    for (const row of capture.inventory.sourceSnapshot.rows) {
      if (row.disposition !== 'admitted') continue;
      const [source] = await capture.snapshot.documents([row.path]);
      if (
        source === undefined ||
        sha256(source.content) !== row.contentDigest ||
        new TextEncoder().encode(source.content).byteLength !== row.byteLength
      ) {
        throw new Error('The captured source does not match its admission manifest.');
      }
      await writePrivateUtf8Artifact(input.outputRoot, row.objectRef, source.content);
    }
    await writeJsonArtifact(
      input.outputRoot,
      snapshotManifestPath(capture.inventory.targetFingerprint),
      SourceSnapshotManifestSchema,
      capture.inventory.sourceSnapshot,
    );
    await writeJsonArtifact(
      input.outputRoot,
      contextSnapshotPath(capture.inventory.targetFingerprint, capture.inventory.contextDigest),
      ContextSnapshotSchema,
      capture.inventory.context,
    );
    const current = await readOptionalSnapshotRetentionIndex(
      input.outputRoot,
      capture.inventory.targetFingerprint,
    );
    const retainedRuns = [
      ...(current?.retainedRuns.filter((record) => record.runId !== input.runId) ?? []),
      { runId: input.runId, contextDigest: capture.inventory.contextDigest },
    ].sort((left, right) => left.runId.localeCompare(right.runId));
    await writeJsonArtifact(
      input.outputRoot,
      snapshotRetentionIndexPath(capture.inventory.targetFingerprint),
      SourceSnapshotRetentionIndexSchema,
      {
        schemaVersion: 2,
        targetFingerprint: capture.inventory.targetFingerprint,
        retainedRuns,
      },
    );
  } finally {
    await lease.release();
  }
}

/** Reconstructs a run-owned source/context view without opening the mutable target. */
export async function loadRetainedTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  targetFingerprint: string;
  contextDigest: string;
}): Promise<TargetInventoryCapture> {
  const retention = await readOptionalSnapshotRetentionIndex(
    input.outputRoot,
    input.targetFingerprint,
  );
  if (
    retention === undefined ||
    !retention.retainedRuns.some(
      (record) => record.runId === input.runId && record.contextDigest === input.contextDigest,
    )
  ) {
    throw new Error('The audit run does not retain the requested source snapshot.');
  }
  const sourceSnapshot = await readJsonArtifact(
    input.outputRoot,
    snapshotManifestPath(input.targetFingerprint),
    SourceSnapshotManifestSchema,
  );
  if (sourceSnapshot.targetFingerprint !== input.targetFingerprint) {
    throw new Error('The retained source snapshot does not match the executable plan.');
  }
  const context = await readJsonArtifact(
    input.outputRoot,
    contextSnapshotPath(input.targetFingerprint, input.contextDigest),
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
  const readAdmittedSource = async (row: (typeof admittedRows)[number]) => {
    const content = await readPrivateUtf8Artifact(input.outputRoot, row.objectRef);
    if (
      sha256(content) !== row.contentDigest ||
      new TextEncoder().encode(content).byteLength !== row.byteLength
    ) {
      throw new Error('A retained source object does not match its admission manifest.');
    }
    return { path: row.path, content, languageHint: row.languageHint };
  };
  // A resumed run validates every private object before any provider dispatch,
  // but keeps no repository-wide source-content cache afterwards.
  for (const row of admittedRows) await readAdmittedSource(row);
  const summary = {
    fileCount: admittedRows.length,
    totalBytes: admittedRows.reduce((total, row) => total + row.byteLength, 0),
    languageHints: [...new Set(admittedRows.flatMap((row) => row.languageHint ?? []))].sort(),
  };
  const inventory: TargetInventory = TargetInventorySchema.parse({
    targetFingerprint: input.targetFingerprint,
    contextDigest: input.contextDigest,
    summary,
    sourceSnapshot,
    context,
  });
  return {
    inventory,
    snapshot: new SourceSnapshot({
      entries: admittedRows.map((row) => ({ relativePath: row.path, sizeBytes: row.byteLength })),
      readDocument: async (path) => {
        const row = admittedRows.find((candidate) => candidate.path === path);
        if (row === undefined)
          throw new Error('The requested source is not in the retained snapshot.');
        return readAdmittedSource(row);
      },
    }),
  };
}

/** Releases one run's reference and removes bytes only after the final owner finishes. */
export async function releaseTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  targetFingerprint: string;
}): Promise<void> {
  const lease = await acquireArtifactLease(
    input.outputRoot,
    snapshotRetentionLeasePath(input.targetFingerprint),
  );
  try {
    const current = await readOptionalSnapshotRetentionIndex(
      input.outputRoot,
      input.targetFingerprint,
    );
    if (
      current === undefined ||
      !current.retainedRuns.some((record) => record.runId === input.runId)
    )
      return;
    const retainedRuns = current.retainedRuns.filter((record) => record.runId !== input.runId);
    if (retainedRuns.length === 0) {
      await removeArtifactDirectory(
        input.outputRoot,
        snapshotDirectoryPath(input.targetFingerprint),
      );
      await removeJsonArtifact(
        input.outputRoot,
        snapshotRetentionIndexPath(input.targetFingerprint),
      );
    } else {
      await writeJsonArtifact(
        input.outputRoot,
        snapshotRetentionIndexPath(input.targetFingerprint),
        SourceSnapshotRetentionIndexSchema,
        {
          schemaVersion: 2,
          targetFingerprint: input.targetFingerprint,
          retainedRuns,
        },
      );
    }
  } finally {
    await lease.release();
  }
}

/**
 * Removes the source/context snapshot retained by one exact discarded run.
 * A shared snapshot is deliberately not mutated: its remaining owners must
 * close first, keeping discard from changing another run's resumable state.
 */
export async function discardRetainedTargetSnapshot(input: {
  outputRoot: string;
  runId: string;
  targetFingerprint: string;
}): Promise<void> {
  const lease = await acquireArtifactLease(
    input.outputRoot,
    snapshotRetentionLeasePath(input.targetFingerprint),
  );
  try {
    const current = await readOptionalSnapshotRetentionIndex(
      input.outputRoot,
      input.targetFingerprint,
    );
    if (current === undefined) return;
    const owner = current.retainedRuns.find((record) => record.runId === input.runId);
    if (owner === undefined) return;
    if (current.retainedRuns.length !== 1) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'The audit run retains a shared source snapshot and cannot be discarded independently.',
      );
    }
    await removeArtifactDirectory(input.outputRoot, snapshotDirectoryPath(input.targetFingerprint));
    await removeJsonArtifact(input.outputRoot, snapshotRetentionIndexPath(input.targetFingerprint));
  } finally {
    await lease.release();
  }
}

export function snapshotManifestPath(targetFingerprint: string): string {
  return `${snapshotDirectoryPath(targetFingerprint)}/manifest.json`;
}

function contextSnapshotPath(targetFingerprint: string, contextDigest: string): string {
  return `${snapshotDirectoryPath(targetFingerprint)}/contexts/${contextDigest}.json`;
}

function snapshotDirectoryPath(targetFingerprint: string): string {
  return `work/snapshots/${targetFingerprint}`;
}

function snapshotRetentionIndexPath(targetFingerprint: string): string {
  return `work/snapshot-retention/${targetFingerprint}.json`;
}

function snapshotRetentionLeasePath(targetFingerprint: string): string {
  return `work/snapshot-retention/${targetFingerprint}.lock`;
}

async function readOptionalSnapshotRetentionIndex(
  outputRoot: string,
  targetFingerprint: string,
): Promise<SourceSnapshotRetentionIndex | undefined> {
  try {
    return await readJsonArtifact(
      outputRoot,
      snapshotRetentionIndexPath(targetFingerprint),
      SourceSnapshotRetentionIndexSchema,
    );
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}
