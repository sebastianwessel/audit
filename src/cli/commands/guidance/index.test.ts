import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireArtifactLease } from '../../../platform/artifact-store/json-artifact-store.js';
import { loadRuntimeConfiguration } from '../../../platform/configuration/environment.js';
import { runCli } from '../../main.js';

function runtimeForRoots(privateWorkDirectory: string, publicArtifactDirectory: string) {
  return () =>
    loadRuntimeConfiguration({
      environment: {
        AUDIT_PRIVATE_WORK_DIR: privateWorkDirectory,
        AUDIT_PUBLIC_ARTIFACT_DIR: publicArtifactDirectory,
      },
      loadDotEnv: false,
    });
}
test('guidance refuses concurrent same-run ownership before opening a source capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-guidance-lease-'));
  try {
    const privateWork = join(root, 'private-work');
    const publicArtifacts = join(root, 'public-artifacts');
    const targetRoot = join(root, 'target');
    await Promise.all([mkdir(privateWork), mkdir(publicArtifacts), mkdir(targetRoot)]);
    const runId = 'guidance-lease-01';
    const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`);
    try {
      await expect(
        runCli(
          [
            'guidance',
            '--target',
            targetRoot,
            '--plan',
            'plans/missing.json',
            '--report',
            'reports/missing.json',
            '--run-id',
            runId,
          ],
          {
            loadRuntimeConfiguration: runtimeForRoots(privateWork, publicArtifacts),
          },
        ),
      ).rejects.toMatchObject({ code: 'artifact-lease-unavailable' });
      expect(await Bun.file(join(privateWork, 'work', 'snapshots', runId)).exists()).toBe(false);
    } finally {
      await lease.release();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
