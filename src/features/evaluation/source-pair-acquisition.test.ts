import { expect, test } from 'bun:test';
import { cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../../shared/contracts/core.js';

import { candidateRegistryDigest } from './candidate-registry.js';
import {
  acquiredSourcePairDigest,
  acquirePinnedSourcePair,
  loadAcquiredSourcePair,
  validateAcquiredSourcePairCollection,
} from './source-pair-acquisition.js';

test('acquires and rechecks a complete local Git source pair without creating labels', async () => {
  const { output, patchedRevision, snapshot } = await createSourcePairFixture();

  expect(snapshot.variants.vulnerable.files.map((file) => file.path)).toEqual([
    'README.md',
    'src/Review.java',
  ]);
  expect(snapshot.variants.patched.revision).toBe(patchedRevision);
  const loaded = await loadAcquiredSourcePair(join(output, snapshot.snapshotId));
  expect(loaded.snapshotDigest).toBe(snapshot.snapshotDigest);
  expect(await readFile(join(output, snapshot.snapshotId, 'vulnerable', 'README.md'), 'utf8')).toBe(
    'before\n',
  );
  await expect(validateAcquiredSourcePairCollection(output)).resolves.toEqual({
    snapshotCount: 1,
    snapshots: [
      {
        snapshotId: snapshot.snapshotId,
        candidateId: snapshot.candidateId,
        vulnerableFileCount: 2,
        patchedFileCount: 2,
        snapshotDigest: snapshot.snapshotDigest,
      },
    ],
  });
});

test('rejects a source pair whose local Git repository lacks the exact pinned revision', async () => {
  const root = join(tmpdir(), `security-reviewer-source-pair-mismatch-${crypto.randomUUID()}`);
  const repository = join(root, 'repository');
  const registryPath = join(root, 'registry.json');
  await mkdir(repository, { recursive: true });
  await git(repository, ['init', '-q']);
  await git(repository, ['config', 'user.email', 'tests@example.test']);
  await git(repository, ['config', 'user.name', 'Security Reviewer tests']);
  await writeFile(join(repository, 'source.txt'), 'source\n', 'utf8');
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-qm', 'source']);
  const revision = await gitText(repository, ['rev-parse', 'HEAD']);
  await writeRegistry(registryPath, revision, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

  await expect(
    acquirePinnedSourcePair({
      registryPath,
      candidateId: 'candidate-2026-3001',
      repositoryRoot: repository,
      outputRoot: join(root, 'snapshots'),
      capturedAt: '2026-07-31T12:00:00.000Z',
    }),
  ).rejects.toThrow('local Git read did not complete');
});

test('rejects a tampered acquired source pair before it can be curated', async () => {
  const { output, snapshot } = await createSourcePairFixture();
  await writeFile(join(output, snapshot.snapshotId, 'patched', 'README.md'), 'tampered\n', 'utf8');

  await expect(loadAcquiredSourcePair(join(output, snapshot.snapshotId))).rejects.toThrow(
    'file manifest does not match',
  );
});

test('rejects unexpected workspace entries, linked workspaces, and duplicate candidate workspaces', async () => {
  const { output, snapshot } = await createSourcePairFixture();
  const workspace = join(output, snapshot.snapshotId);
  await writeFile(join(workspace, 'answer-key.json'), '{}\n', 'utf8');
  await expect(loadAcquiredSourcePair(workspace)).rejects.toThrow('unexpected entry');
  await rm(join(workspace, 'answer-key.json'));

  await symlink(workspace, join(output, 'linked-workspace'));
  await expect(validateAcquiredSourcePairCollection(output)).rejects.toThrow('unexpected entry');
  await rm(join(output, 'linked-workspace'));

  const duplicateId = 'source-pair-duplicate-2026';
  const duplicateWorkspace = join(output, duplicateId);
  await cp(workspace, duplicateWorkspace, { recursive: true });
  const { snapshotDigest: _snapshotDigest, ...unsigned } = snapshot;
  const duplicate = { ...unsigned, snapshotId: duplicateId };
  await writeFile(
    join(duplicateWorkspace, 'snapshot.json'),
    `${JSON.stringify({ ...duplicate, snapshotDigest: acquiredSourcePairDigest(duplicate) })}\n`,
    'utf8',
  );
  await expect(validateAcquiredSourcePairCollection(output)).rejects.toThrow(
    'duplicate registry/candidate identity',
  );
});

async function createSourcePairFixture(): Promise<{
  output: string;
  patchedRevision: string;
  snapshot: Awaited<ReturnType<typeof acquirePinnedSourcePair>>;
}> {
  const root = join(tmpdir(), `security-reviewer-source-pair-${crypto.randomUUID()}`);
  const repository = join(root, 'repository');
  const output = join(root, 'snapshots');
  const registryPath = join(root, 'registry.json');
  await mkdir(repository, { recursive: true });
  await git(repository, ['init', '-q']);
  await git(repository, ['config', 'user.email', 'tests@example.test']);
  await git(repository, ['config', 'user.name', 'Security Reviewer tests']);
  await mkdir(join(repository, 'src'), { recursive: true });
  await writeFile(join(repository, 'README.md'), 'before\n', 'utf8');
  await writeFile(
    join(repository, 'src', 'Review.java'),
    'class Review { String path = user; }\n',
    'utf8',
  );
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-qm', 'vulnerable']);
  const vulnerableRevision = await gitText(repository, ['rev-parse', 'HEAD']);
  await writeFile(join(repository, 'README.md'), 'after\n', 'utf8');
  await writeFile(
    join(repository, 'src', 'Review.java'),
    'class Review { String path = normalize(user); }\n',
    'utf8',
  );
  await git(repository, ['add', '.']);
  await git(repository, ['commit', '-qm', 'patched']);
  const patchedRevision = await gitText(repository, ['rev-parse', 'HEAD']);
  await writeRegistry(registryPath, vulnerableRevision, patchedRevision);
  const snapshot = await acquirePinnedSourcePair({
    registryPath,
    candidateId: 'candidate-2026-3001',
    repositoryRoot: repository,
    outputRoot: output,
    capturedAt: '2026-07-31T12:00:00.000Z',
  });
  return { output, patchedRevision, snapshot };
}

async function writeRegistry(
  path: string,
  vulnerableRevision: string,
  patchedRevision: string,
): Promise<void> {
  const metadata = '{"source":"local-test"}';
  const unsigned = {
    schemaVersion: 1 as const,
    registryId: 'source-pair-test-registry',
    source: {
      datasetId: 'source-pair-test-data',
      title: 'Local source-pair test data',
      sourceUrl: 'https://example.test/source-pair-test-data',
      revision: 'local-test-revision',
      license: 'Private test material',
      retrievedAt: '2026-07-31T12:00:00.000Z',
      attribution: 'Local test registry.',
    },
    candidates: [
      {
        candidateId: 'candidate-2026-3001',
        sourceRecordId: 'source-2026-3001',
        repositoryUrl: 'https://example.test/source-pair-repository',
        vulnerableRevision,
        patchedRevision,
        metadataPath: 'metadata.json',
        metadataDigest: sha256(metadata),
        sourceLicenseStatus: 'unverified' as const,
      },
    ],
  };
  await writeFile(
    path,
    `${JSON.stringify({ ...unsigned, registryDigest: candidateRegistryDigest(unsigned) })}\n`,
    'utf8',
  );
}

async function git(repository: string, arguments_: readonly string[]): Promise<void> {
  const process = Bun.spawn(['git', '-C', repository, ...arguments_], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  if ((await process.exited) !== 0) throw new Error('Git fixture setup failed.');
}

async function gitText(repository: string, arguments_: readonly string[]): Promise<string> {
  const process = Bun.spawn(['git', '-C', repository, ...arguments_], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const output = new TextDecoder().decode(await new Response(process.stdout).arrayBuffer());
  if ((await process.exited) !== 0) throw new Error('Git fixture read failed.');
  return output.trim();
}
