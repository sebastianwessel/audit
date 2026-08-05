import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../platform/filesystem/index.js';
import { sha256 } from '../../shared/contracts/core.js';

import { captureTargetInventory } from './inventory.js';
import {
  createPrivateSourceCapture,
  sourceCaptureDirectory,
  sourceObjectPath,
} from './private-source-capture.js';

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
    expect(await capture.snapshot.documents(['first.unknown', 'second.unknown'])).toEqual([
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
