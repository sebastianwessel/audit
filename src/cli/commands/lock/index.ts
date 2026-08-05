import { IdentifierSchema } from '../../../shared/contracts/core.js';
import { writeCliCommandResult } from '../../command-result.js';
import { requiredOption } from '../../input.js';
import {
  inspectProductLease,
  ProductLeaseOperationSchema,
  releaseProductLease,
} from '../../product-lease.js';

/** Inspects or explicitly releases one known-abandoned product private-work lease. */
export async function runLock(
  options: Readonly<Record<string, string>>,
  privateWork: string,
): Promise<number> {
  const runId = IdentifierSchema.parse(requiredOption(options, 'run-id'));
  const release = options.release === 'true';
  const operation =
    options.operation === undefined
      ? undefined
      : ProductLeaseOperationSchema.parse(options.operation);

  if (release) {
    if (operation === undefined)
      throw new Error('Lock release requires an operation confirmation.');
    await releaseProductLease({ privateWork, runId, operation });
    return writeLockResult(options, runId, await inspectProductLease({ privateWork, runId }), true);
  }
  const inspection = await inspectProductLease({ privateWork, runId });
  return writeLockResult(options, runId, inspection, false);
}

function writeLockResult(
  options: Readonly<Record<string, string>>,
  runId: string,
  inspection: Awaited<ReturnType<typeof inspectProductLease>>,
  release: boolean,
): number {
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'lock',
      status: 'completed',
      exitCode: 0,
      exitMeaning: release ? 'lease-released' : 'lease-inspected',
      identifiers: { runId },
      artifacts: [],
      lease: inspection,
    },
    release ? `Released matching product lease for ${runId}.\n` : `${JSON.stringify(inspection)}\n`,
  );
  return 0;
}
