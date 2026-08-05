import { expect, test } from 'bun:test';

import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import { createCandidateAwareDispatchPool } from './candidate-aware-dispatch.js';

test('rejects new candidate-aware work after a provider-neutral cancellation', async () => {
  const pool = createCandidateAwareDispatchPool(1);
  const cancellation = new AuditRuntimeError(
    'provider-cancelled',
    'The provider cancelled the current model stage.',
  );
  pool.cancel(cancellation);
  await expect(pool.run(async () => 'must-not-run')).rejects.toMatchObject({
    code: 'provider-cancelled',
  });
});
