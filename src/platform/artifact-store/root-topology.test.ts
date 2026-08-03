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
  test('canonicalizes separate existing roots without creating the output root', async () => {
    const root = await createRoot();
    const target = join(root, 'target');
    const context = join(root, 'context');
    const output = join(root, 'output');
    await Promise.all([mkdir(target), mkdir(context)]);

    await expect(
      validateRootTopology({ targetRoot: target, contextRoot: context, outputRoot: output }),
    ).resolves.toEqual({
      targetRoot: await realpath(target),
      contextRoot: await realpath(context),
      outputRoot: join(await realpath(root), 'output'),
    });
    await expect(access(output)).rejects.toThrow();
  });

  test('rejects equal and ancestor/descendant root pairs', async () => {
    const root = await createRoot();
    const target = join(root, 'target');
    const context = join(root, 'context');
    const output = join(root, 'output');
    await Promise.all([mkdir(target), mkdir(context), mkdir(output)]);

    const invalidPairs = [
      { targetRoot: target, contextRoot: target, outputRoot: output },
      { targetRoot: target, contextRoot: context, outputRoot: target },
      { targetRoot: target, contextRoot: context, outputRoot: join(target, 'artifacts') },
      { targetRoot: join(output, 'repo'), contextRoot: context, outputRoot: output },
      { targetRoot: target, contextRoot: join(output, 'context'), outputRoot: output },
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
  const root = await mkdtemp(join(tmpdir(), 'security-reviewer-root-topology-'));
  roots.push(root);
  return root;
}
