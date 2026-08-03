import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../platform/filesystem/index.js';

import { captureTargetInventory } from './inventory.js';
import {
  loadRetainedTargetSnapshot,
  releaseTargetSnapshot,
  retainTargetSnapshot,
  snapshotManifestPath,
} from './snapshot-store.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('reloads the exact admitted source and advisory context without reopening a changed target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-retained-snapshot-'));
  roots.push(root);
  const targetRoot = join(root, 'target');
  const contextRoot = join(root, 'context');
  const outputRoot = join(root, 'output');
  await Promise.all([mkdir(targetRoot), mkdir(contextRoot), mkdir(outputRoot)]);
  const sourcePath = join(targetRoot, 'service.custom');
  await writeFile(sourcePath, 'before\r\n', 'utf8');
  await writeFile(
    join(contextRoot, 'system.md'),
    '---\ntitle: System\nkind: architecture\nsensitivity: internal\nappliesTo:\n  - "**/*"\n---\nOriginal context.\r\n',
    'utf8',
  );
  const capture = await captureTargetInventory(
    await createJailedReadOnlyFilesystem({ targetRoot, contextRoot }),
  );
  await retainTargetSnapshot({ outputRoot, runId: 'audit-run-01', capture });
  await writeFile(sourcePath, 'after\n', 'utf8');
  await writeFile(
    join(contextRoot, 'system.md'),
    '---\ntitle: System\nkind: architecture\nsensitivity: internal\nappliesTo:\n  - "**/*"\n---\nChanged context.\n',
    'utf8',
  );

  const retained = await loadRetainedTargetSnapshot({
    outputRoot,
    runId: 'audit-run-01',
    targetFingerprint: capture.inventory.targetFingerprint,
    contextDigest: capture.inventory.contextDigest,
  });
  expect(retained.snapshot.documents()).toEqual([
    { path: 'service.custom', content: 'before\r\n', languageHint: null },
  ]);
  expect(retained.inventory.context[0]?.body).toBe('Original context.\r\n');
});

test('releases snapshot bytes only after the final resumable run owner finishes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-snapshot-retention-'));
  roots.push(root);
  const targetRoot = join(root, 'target');
  const outputRoot = join(root, 'output');
  await Promise.all([mkdir(targetRoot), mkdir(outputRoot)]);
  await writeFile(join(targetRoot, 'service.custom'), 'source\n', 'utf8');
  const capture = await captureTargetInventory(
    await createJailedReadOnlyFilesystem({ targetRoot }),
  );
  const targetFingerprint = capture.inventory.targetFingerprint;
  await retainTargetSnapshot({ outputRoot, runId: 'audit-run-01', capture });
  await retainTargetSnapshot({ outputRoot, runId: 'audit-run-02', capture });

  await releaseTargetSnapshot({ outputRoot, runId: 'audit-run-01', targetFingerprint });
  await expect(
    loadRetainedTargetSnapshot({
      outputRoot,
      runId: 'audit-run-02',
      targetFingerprint,
      contextDigest: capture.inventory.contextDigest,
    }),
  ).resolves.toBeDefined();

  await releaseTargetSnapshot({ outputRoot, runId: 'audit-run-02', targetFingerprint });
  expect(await Bun.file(join(outputRoot, snapshotManifestPath(targetFingerprint))).exists()).toBe(
    false,
  );
  await expect(
    loadRetainedTargetSnapshot({
      outputRoot,
      runId: 'audit-run-02',
      targetFingerprint,
      contextDigest: capture.inventory.contextDigest,
    }),
  ).rejects.toThrow('does not retain');
});

test('keeps independently retained advisory context versions for the same source snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-context-retention-'));
  roots.push(root);
  const targetRoot = join(root, 'target');
  const contextRoot = join(root, 'context');
  const outputRoot = join(root, 'output');
  await Promise.all([mkdir(targetRoot), mkdir(contextRoot), mkdir(outputRoot)]);
  await writeFile(join(targetRoot, 'service.custom'), 'source\n', 'utf8');
  const contextPath = join(contextRoot, 'system.md');
  await writeFile(
    contextPath,
    '---\ntitle: System\nkind: architecture\nsensitivity: internal\nappliesTo:\n  - "**/*"\n---\nFirst context.\n',
    'utf8',
  );
  const first = await captureTargetInventory(
    await createJailedReadOnlyFilesystem({ targetRoot, contextRoot }),
  );
  await writeFile(
    contextPath,
    '---\ntitle: System\nkind: architecture\nsensitivity: internal\nappliesTo:\n  - "**/*"\n---\nSecond context.\n',
    'utf8',
  );
  const second = await captureTargetInventory(
    await createJailedReadOnlyFilesystem({ targetRoot, contextRoot }),
  );
  expect(second.inventory.targetFingerprint).toBe(first.inventory.targetFingerprint);
  expect(second.inventory.contextDigest).not.toBe(first.inventory.contextDigest);
  await retainTargetSnapshot({ outputRoot, runId: 'audit-run-01', capture: first });
  await retainTargetSnapshot({ outputRoot, runId: 'audit-run-02', capture: second });

  const [firstRetained, secondRetained] = await Promise.all([
    loadRetainedTargetSnapshot({
      outputRoot,
      runId: 'audit-run-01',
      targetFingerprint: first.inventory.targetFingerprint,
      contextDigest: first.inventory.contextDigest,
    }),
    loadRetainedTargetSnapshot({
      outputRoot,
      runId: 'audit-run-02',
      targetFingerprint: second.inventory.targetFingerprint,
      contextDigest: second.inventory.contextDigest,
    }),
  ]);
  expect(firstRetained.inventory.context[0]?.body).toBe('First context.\n');
  expect(secondRetained.inventory.context[0]?.body).toBe('Second context.\n');

  await releaseTargetSnapshot({
    outputRoot,
    runId: 'audit-run-01',
    targetFingerprint: first.inventory.targetFingerprint,
  });
  await expect(
    loadRetainedTargetSnapshot({
      outputRoot,
      runId: 'audit-run-02',
      targetFingerprint: second.inventory.targetFingerprint,
      contextDigest: second.inventory.contextDigest,
    }),
  ).resolves.toBeDefined();
  await releaseTargetSnapshot({
    outputRoot,
    runId: 'audit-run-02',
    targetFingerprint: second.inventory.targetFingerprint,
  });
  expect(
    await Bun.file(
      join(outputRoot, snapshotManifestPath(second.inventory.targetFingerprint)),
    ).exists(),
  ).toBe(false);
});
