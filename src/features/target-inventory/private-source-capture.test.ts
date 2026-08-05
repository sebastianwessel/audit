import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../platform/filesystem/index.js';
import { sha256 } from '../../shared/contracts/core.js';

import { captureTargetInventory } from './inventory.js';
import {
  createPrivateSourceCapture,
  discardUnsealedPrivateSourceCapture,
  privateSourceCaptureState,
  sourceCaptureDirectory,
  sourceCaptureManifestPath,
  sourceObjectPath,
} from './private-source-capture.js';
import { loadRetainedTargetSnapshot, retainTargetSnapshot } from './snapshot-store.js';

test('streams accepted source into a run-owned private capture without reopening the target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-private-source-capture-'));
  try {
    const targetRoot = join(root, 'target');
    const outputRoot = join(root, 'output');
    await Promise.all([mkdir(targetRoot), mkdir(outputRoot)]);
    await Promise.all([
      writeFile(join(targetRoot, 'first.unknown'), 'same source\r\n', 'utf8'),
      writeFile(join(targetRoot, 'second.unknown'), 'same source\r\n', 'utf8'),
    ]);
    const captureId = 'audit-capture-01';
    const sourceCapture = await createPrivateSourceCapture({ outputRoot, captureId });
    const capture = await captureTargetInventory(
      await createJailedReadOnlyFilesystem({ targetRoot }),
      { sourceCapture },
    );
    const contentDigest = sha256('same source\r\n');

    expect(capture.inventory.sourceSnapshot.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'first.unknown',
          objectRef: sourceObjectPath(captureId, contentDigest),
        }),
        expect.objectContaining({ path: 'second.unknown' }),
      ]),
    );
    await writeFile(join(targetRoot, 'first.unknown'), 'changed\n', 'utf8');
    expect(
      await Promise.all([
        capture.snapshot.document('first.unknown'),
        capture.snapshot.document('second.unknown'),
      ]),
    ).toEqual([
      { path: 'first.unknown', content: 'same source\r\n', languageHint: null },
      { path: 'second.unknown', content: 'same source\r\n', languageHint: null },
    ]);
    expect(
      await Bun.file(join(outputRoot, sourceObjectPath(captureId, contentDigest))).exists(),
    ).toBe(true);

    await capture.release?.();
    expect(await Bun.file(join(outputRoot, sourceCaptureDirectory(captureId))).exists()).toBe(
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('clears only an unsealed crash-left capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-private-source-recovery-'));
  try {
    const outputRoot = join(root, 'output');
    await mkdir(outputRoot);
    const captureId = 'guidance-recovery-01';
    const capture = await createPrivateSourceCapture({ outputRoot, captureId });
    await capture.accept({
      path: 'source.unknown',
      content: 'private bytes\n',
      languageHint: null,
    });

    expect(await privateSourceCaptureState({ outputRoot, captureId })).toBe('unsealed');
    expect(await discardUnsealedPrivateSourceCapture({ outputRoot, captureId })).toBe(true);
    expect(await privateSourceCaptureState({ outputRoot, captureId })).toBe('absent');
    expect(await Bun.file(join(outputRoot, sourceCaptureDirectory(captureId))).exists()).toBe(
      false,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('preserves a retained source snapshot when stale-capture recovery runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-private-source-retained-'));
  try {
    const targetRoot = join(root, 'target');
    const outputRoot = join(root, 'output');
    await Promise.all([mkdir(targetRoot), mkdir(outputRoot)]);
    await writeFile(join(targetRoot, 'source.unknown'), 'sealed bytes\n', 'utf8');
    const captureId = 'audit-retained-01';
    const sourceCapture = await createPrivateSourceCapture({ outputRoot, captureId });
    const captured = await captureTargetInventory(
      await createJailedReadOnlyFilesystem({ targetRoot }),
      { sourceCapture },
    );
    const retained = await retainTargetSnapshot({
      outputRoot,
      runId: captureId,
      capture: captured,
    });

    expect(await privateSourceCaptureState({ outputRoot, captureId })).toBe('retained');
    expect(await discardUnsealedPrivateSourceCapture({ outputRoot, captureId })).toBe(false);
    expect(await Bun.file(join(outputRoot, sourceCaptureManifestPath(captureId))).exists()).toBe(
      true,
    );
    await expect(
      loadRetainedTargetSnapshot({
        outputRoot,
        runId: captureId,
        targetFingerprint: retained.inventory.targetFingerprint,
        contextDigest: retained.inventory.contextDigest,
      }),
    ).resolves.toBeDefined();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
