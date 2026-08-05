import { z } from 'zod';

import {
  ArtifactStoreError,
  readPrivateUtf8Artifact,
  removeArtifactDirectory,
  writeNewJsonArtifact,
  writeNewPrivateUtf8Artifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { IdentifierSchema, sha256 } from '../../shared/contracts/core.js';
import type { SourceDocument } from '../audit-execution/audit.schema.js';

import { SourceSnapshot, type SourceSnapshotCapture } from './source-snapshot.js';

const SourceCaptureReservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  captureId: IdentifierSchema,
});

type CapturedSource = Readonly<{
  path: string;
  byteLength: number;
  contentDigest: string;
  languageHint: string | null;
}>;

/**
 * Creates one run-owned, private source sink before inventory reads target
 * bytes. Every accepted file is persisted once under its content digest;
 * source content is never retained as a repository-wide in-memory array.
 */
export async function createPrivateSourceCapture(input: {
  outputRoot: string;
  captureId: string;
}): Promise<SourceSnapshotCapture> {
  const captureId = IdentifierSchema.parse(input.captureId);
  const directory = sourceCaptureDirectory(captureId);
  await writeNewJsonArtifact(
    input.outputRoot,
    `${directory}/reservation.json`,
    SourceCaptureReservationSchema,
    { schemaVersion: 1, captureId },
  );

  const sources = new Map<string, CapturedSource>();
  const objectDigests = new Set<string>();
  let released = false;
  const assertActive = () => {
    if (released) throw new Error('The private source capture has already been released.');
  };
  const readSource = async (path: string): Promise<SourceDocument> => {
    assertActive();
    const source = sources.get(path);
    if (source === undefined)
      throw new Error('The requested source is not in the private capture.');
    const content = await readPrivateUtf8Artifact(
      input.outputRoot,
      sourceObjectPath(captureId, source.contentDigest),
    );
    if (
      sha256(content) !== source.contentDigest ||
      new TextEncoder().encode(content).byteLength !== source.byteLength
    ) {
      throw new Error('A private captured source object does not match its admission record.');
    }
    return { path: source.path, content, languageHint: source.languageHint };
  };

  return Object.freeze({
    accept: async (source) => {
      assertActive();
      if (sources.has(source.path)) {
        throw new Error(
          'The target inventory attempted to capture one source path more than once.',
        );
      }
      const contentDigest = sha256(source.content);
      const byteLength = new TextEncoder().encode(source.content).byteLength;
      if (!objectDigests.has(contentDigest)) {
        await writeNewPrivateUtf8Artifact(
          input.outputRoot,
          sourceObjectPath(captureId, contentDigest),
          source.content,
        );
        objectDigests.add(contentDigest);
      }
      sources.set(
        source.path,
        Object.freeze({
          path: source.path,
          contentDigest,
          byteLength,
          languageHint: source.languageHint,
        }),
      );
    },
    objectRef: (contentDigest) => sourceObjectPath(captureId, contentDigest),
    createSnapshot: () => {
      assertActive();
      return new SourceSnapshot({
        entries: [...sources.values()].map((source) => ({
          relativePath: source.path,
          sizeBytes: source.byteLength,
        })),
        readDocument: readSource,
      });
    },
    release: async () => {
      if (released) return;
      released = true;
      try {
        await removeArtifactDirectory(input.outputRoot, directory);
      } catch (error) {
        if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found') return;
        throw error;
      }
    },
  });
}

export function sourceCaptureDirectory(captureId: string): string {
  return `work/snapshots/${IdentifierSchema.parse(captureId)}`;
}

export function sourceCaptureManifestPath(captureId: string): string {
  return `${sourceCaptureDirectory(captureId)}/manifest.json`;
}

export function sourceCaptureContextPath(captureId: string, contextDigest: string): string {
  return `${sourceCaptureDirectory(captureId)}/contexts/${contextDigest}.json`;
}

export function sourceObjectPath(captureId: string, contentDigest: string): string {
  return `${sourceCaptureDirectory(captureId)}/objects/${contentDigest}.txt`;
}
