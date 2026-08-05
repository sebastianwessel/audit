import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ArtifactStoreError } from './json-artifact-store.ts';
import { ensureSafeOutputRoot, validateRootTopology } from './root-topology.ts';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('root topology', () => {
  test('canonicalizes separate roots without creating either artifact root', async () => {
    const root = await createRoot();
    const target = join(root, 'target');
    const context = join(root, 'context');
    const publicArtifacts = join(root, 'public-artifacts');
    const privateWork = join(root, 'private-work');
    await Promise.all([mkdir(target), mkdir(context)]);

    await expect(
      validateRootTopology({
        targetRoot: target,
        contextRoot: context,
        publicArtifactRoot: publicArtifacts,
        privateWorkRoot: privateWork,
      }),
    ).resolves.toEqual({
      targetRoot: await realpath(target),
      contextRoot: await realpath(context),
      publicArtifactRoot: join(await realpath(root), 'public-artifacts'),
      privateWorkRoot: join(await realpath(root), 'private-work'),
    });
    await expect(access(publicArtifacts)).rejects.toThrow();
    await expect(access(privateWork)).rejects.toThrow();
  });

  test('rejects equal and ancestor/descendant root pairs', async () => {
    const root = await createRoot();
    const target = join(root, 'target');
    const context = join(root, 'context');
    const publicArtifacts = join(root, 'public-artifacts');
    const privateWork = join(root, 'private-work');
    await Promise.all([mkdir(target), mkdir(context), mkdir(publicArtifacts), mkdir(privateWork)]);

    const invalidPairs = [
      {
        targetRoot: target,
        contextRoot: target,
        publicArtifactRoot: publicArtifacts,
        privateWorkRoot: privateWork,
      },
      {
        targetRoot: target,
        contextRoot: context,
        publicArtifactRoot: target,
        privateWorkRoot: privateWork,
      },
      {
        targetRoot: target,
        contextRoot: context,
        publicArtifactRoot: join(target, 'artifacts'),
        privateWorkRoot: privateWork,
      },
      {
        targetRoot: join(publicArtifacts, 'repo'),
        contextRoot: context,
        publicArtifactRoot: publicArtifacts,
        privateWorkRoot: privateWork,
      },
      {
        targetRoot: target,
        contextRoot: join(publicArtifacts, 'context'),
        publicArtifactRoot: publicArtifacts,
        privateWorkRoot: privateWork,
      },
      {
        targetRoot: target,
        contextRoot: context,
        publicArtifactRoot: publicArtifacts,
        privateWorkRoot: publicArtifacts,
      },
    ] as const;

    for (const input of invalidPairs) {
      await expect(validateRootTopology(input)).rejects.toMatchObject({
        code: 'artifact-root-topology-invalid',
      } satisfies Pick<ArtifactStoreError, 'code'>);
    }
  });

  test('creates only safe output segments and rejects a symbolic-link segment', async () => {
    const root = await createRoot();
    const output = join(root, 'work', 'artifacts');
    const createdOutput = await ensureSafeOutputRoot(output);
    expect(createdOutput).toBe(await realpath(output));
    await expect(access(output)).resolves.toBeNull();

    const target = join(root, 'target');
    const linked = join(root, 'linked');
    await mkdir(target);
    await symlink(target, linked);
    await expect(ensureSafeOutputRoot(join(linked, 'artifacts'))).rejects.toMatchObject({
      code: 'artifact-root-topology-invalid',
    } satisfies Pick<ArtifactStoreError, 'code'>);
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'audit-root-topology-'));
  roots.push(root);
  return root;
}
