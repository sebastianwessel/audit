import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireArtifactLease } from '../../../platform/artifact-store/json-artifact-store.js';
import { inspectProductLease } from '../../product-lease.js';
import { runLock } from './index.js';

test('lock inspects recognized source-free lease metadata without releasing it', async () => {
  const privateWork = await mkdtemp(join(tmpdir(), 'audit-lock-command-'));
  const runId = 'audit-lock-inspect-01';
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: { schemaVersion: 1, operation: 'audit', runId },
  });
  try {
    await expect(runLock({ 'run-id': runId }, privateWork)).resolves.toBe(0);
    await expect(inspectProductLease({ privateWork, runId })).resolves.toEqual({
      lease: { schemaVersion: 1, operation: 'audit', runId },
    });
  } finally {
    await lease.release();
    await rm(privateWork, { force: true, recursive: true });
  }
});

test('lock releases only a lease with the exactly confirmed operation and run id', async () => {
  const privateWork = await mkdtemp(join(tmpdir(), 'audit-lock-command-'));
  const runId = 'audit-lock-release-01';
  await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: { schemaVersion: 1, operation: 'audit', runId },
  });
  try {
    await expect(
      runLock({ 'run-id': runId, operation: 'plan', release: 'true' }, privateWork),
    ).rejects.toThrow('does not match');
    await expect(inspectProductLease({ privateWork, runId })).resolves.toEqual({
      lease: { schemaVersion: 1, operation: 'audit', runId },
    });
    await expect(
      runLock({ 'run-id': runId, operation: 'audit', release: 'true' }, privateWork),
    ).resolves.toBe(0);
    await expect(inspectProductLease({ privateWork, runId })).resolves.toEqual({ lease: null });
  } finally {
    await rm(privateWork, { force: true, recursive: true });
  }
});

test('lock fails closed for malformed or unrecognized retained metadata', async () => {
  const privateWork = await mkdtemp(join(tmpdir(), 'audit-lock-command-'));
  try {
    for (const [runId, metadata] of [
      ['audit-lock-malformed-01', '{not-json'],
      [
        'audit-lock-unrecognized-01',
        JSON.stringify({ schemaVersion: 1, operation: 'unrecognized-operation', runId: 'x' }),
      ],
    ] as const) {
      const lockDirectory = join(privateWork, `work/leases/${runId}.lock`);
      await mkdir(lockDirectory, { recursive: true });
      await writeFile(join(lockDirectory, '.lease.json'), metadata, 'utf8');
      await expect(runLock({ 'run-id': runId }, privateWork)).rejects.toThrow();
    }
  } finally {
    await rm(privateWork, { force: true, recursive: true });
  }
});
