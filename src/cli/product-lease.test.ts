import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireArtifactLease } from '../platform/artifact-store/json-artifact-store.js';
import {
  createSimpleProductLeaseMetadata,
  inspectProductLease,
  releaseProductLease,
} from './product-lease.js';

async function createPrivateWorkRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'audit-product-lease-'));
}

test('inspects only recognized source-free product lease metadata', async () => {
  const privateWork = await createPrivateWorkRoot();
  const runId = 'product-lease-inspect-01';
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: createSimpleProductLeaseMetadata({ operation: 'audit', runId }),
  });
  try {
    await expect(inspectProductLease({ privateWork, runId })).resolves.toEqual({
      lease: { schemaVersion: 1, operation: 'audit', runId },
    });
  } finally {
    await lease.release();
    await rm(privateWork, { force: true, recursive: true });
  }
});

test('fails closed for an unrecognized or mismatched lease before release', async () => {
  const privateWork = await createPrivateWorkRoot();
  const runId = 'product-lease-mismatch-01';
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: createSimpleProductLeaseMetadata({ operation: 'audit', runId }),
  });
  try {
    await expect(
      releaseProductLease({ privateWork, runId, operation: 'plan' }),
    ).rejects.toMatchObject({ code: 'artifact-lease-mismatch' });
    await expect(inspectProductLease({ privateWork, runId })).resolves.toEqual({
      lease: { schemaVersion: 1, operation: 'audit', runId },
    });
  } finally {
    await lease.release();
    await rm(privateWork, { force: true, recursive: true });
  }
});

test('releases only the exact inspected operation and run identity', async () => {
  const privateWork = await createPrivateWorkRoot();
  const runId = 'product-lease-release-01';
  await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: createSimpleProductLeaseMetadata({ operation: 'audit', runId }),
  });
  try {
    await releaseProductLease({ privateWork, runId, operation: 'audit' });
    await expect(inspectProductLease({ privateWork, runId })).resolves.toEqual({ lease: null });
  } finally {
    await rm(privateWork, { force: true, recursive: true });
  }
});

test('rejects an unrecognized persisted metadata shape', async () => {
  const privateWork = await createPrivateWorkRoot();
  const runId = 'product-lease-unknown-01';
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: { schemaVersion: 1, operation: 'unknown', runId },
  });
  try {
    await expect(inspectProductLease({ privateWork, runId })).rejects.toMatchObject({
      code: 'artifact-lease-mismatch',
    });
  } finally {
    await lease.release();
    await rm(privateWork, { force: true, recursive: true });
  }
});
