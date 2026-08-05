import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../platform/filesystem/index.ts';
import { captureTargetInventory } from './inventory.ts';
import { createSourceSnapshot } from './source-snapshot.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('source snapshot', () => {
  test('serves only the captured source bytes with exact line endings', async () => {
    const snapshot = createSourceSnapshot([
      { path: 'app/service.txt', content: 'first\r\nsecond\r\n', languageHint: null },
    ]);

    await expect(
      snapshot.readFile({ root: 'target', relativePath: 'app/service.txt', startLine: 1 }),
    ).resolves.toMatchObject({ text: 'first\r\nsecond\r\n' });
    await expect(
      snapshot.grepFiles({
        root: 'target',
        pattern: 'second',
        mode: 'literal',
        caseSensitive: true,
        relativePaths: ['app/service.txt'],
        contextLines: 0,
      }),
    ).resolves.toEqual({
      matches: [{ relativePath: 'app/service.txt', line: 2, context: 'second' }],
    });
    await expect(
      snapshot.grepFiles({
        root: 'target',
        pattern: 'second',
        mode: 'literal',
        caseSensitive: true,
        relativePaths: ['app/service.txt'],
        contextLines: 1,
      }),
    ).resolves.toEqual({
      matches: [
        {
          relativePath: 'app/service.txt',
          line: 2,
          context: 'first\r\nsecond',
        },
      ],
    });
  });

  test('retains pre-mutation target bytes after inventory completes', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'audit-snapshot-'));
    roots.push(targetRoot);
    const sourcePath = join(targetRoot, 'service.txt');
    await writeFile(sourcePath, 'before\r\n', 'utf8');
    const { snapshot } = await captureTargetInventory(
      await createJailedReadOnlyFilesystem({ targetRoot }),
    );
    await writeFile(sourcePath, 'after\n', 'utf8');

    await expect(
      snapshot.readFile({ root: 'target', relativePath: 'service.txt', startLine: 1 }),
    ).resolves.toMatchObject({ text: 'before\r\n' });
  });

  test('captures both CRLF and LF source bytes without normalizing either form', async () => {
    const targetRoot = await mkdtemp(join(tmpdir(), 'audit-line-endings-'));
    roots.push(targetRoot);
    await Promise.all([
      writeFile(join(targetRoot, 'windows.unknown'), 'first\r\nsecond\r\n', 'utf8'),
      writeFile(join(targetRoot, 'unix.unknown'), 'first\nsecond\n', 'utf8'),
    ]);

    const { snapshot } = await captureTargetInventory(
      await createJailedReadOnlyFilesystem({ targetRoot }),
    );

    await expect(
      snapshot.readFile({ root: 'target', relativePath: 'windows.unknown', startLine: 1 }),
    ).resolves.toMatchObject({ text: 'first\r\nsecond\r\n' });
    await expect(
      snapshot.readFile({ root: 'target', relativePath: 'unix.unknown', startLine: 1 }),
    ).resolves.toMatchObject({ text: 'first\nsecond\n' });
  });

  test('does not enumerate or read a path outside its captured manifest', async () => {
    const snapshot = createSourceSnapshot([
      { path: 'app/service.txt', content: 'safe', languageHint: null },
    ]);

    await expect(
      snapshot.listFiles({ root: 'target', includeGlobs: ['**/*'], excludeGlobs: [] }),
    ).resolves.toEqual({ entries: [{ relativePath: 'app/service.txt', sizeBytes: 4 }] });
    await expect(
      snapshot.readFile({ root: 'target', relativePath: 'outside.txt', startLine: 1 }),
    ).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });
});
