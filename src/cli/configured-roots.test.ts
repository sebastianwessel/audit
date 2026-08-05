import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadRuntimeConfiguration } from '../platform/configuration/environment.js';
import {
  prepareConfiguredPrivateWorkRoot,
  prepareConfiguredProductRoots,
  prepareConfiguredPublicArtifactRoot,
} from './configured-roots.js';

test('prepares all product roots from the resolved runtime configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-configured-roots-'));
  const targetRoot = join(root, 'target');
  const contextRoot = join(root, 'context');
  const privateWorkDirectory = join(root, 'private-work');
  const publicArtifactDirectory = join(root, 'public-artifacts');
  await Promise.all([mkdir(targetRoot), mkdir(contextRoot)]);
  try {
    const runtime = await loadRuntimeConfiguration({
      environment: {
        AUDIT_PRIVATE_WORK_DIR: privateWorkDirectory,
        AUDIT_PUBLIC_ARTIFACT_DIR: publicArtifactDirectory,
      },
      loadDotEnv: false,
    });
    await expect(
      prepareConfiguredProductRoots({
        configuration: runtime.configuration,
        targetRoot,
        contextRoot,
      }),
    ).resolves.toMatchObject({
      targetRoot: await realpath(targetRoot),
      contextRoot: await realpath(contextRoot),
    });
    await expect(access(privateWorkDirectory)).resolves.toBeNull();
    await expect(access(publicArtifactDirectory)).resolves.toBeNull();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('prepares provider-free roots without credentials or provider construction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-provider-free-roots-'));
  const privateWorkDirectory = join(root, 'private-work');
  const publicArtifactDirectory = join(root, 'public-artifacts');
  try {
    const runtime = await loadRuntimeConfiguration({
      environment: {
        AUDIT_PRIVATE_WORK_DIR: privateWorkDirectory,
        AUDIT_PUBLIC_ARTIFACT_DIR: publicArtifactDirectory,
      },
      loadDotEnv: false,
    });
    const privateWorkRoot = await prepareConfiguredPrivateWorkRoot(runtime.configuration);
    const publicArtifactRoot = await prepareConfiguredPublicArtifactRoot(runtime.configuration);
    expect(privateWorkRoot).toBe(await realpath(privateWorkDirectory));
    expect(publicArtifactRoot).toBe(await realpath(publicArtifactDirectory));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
