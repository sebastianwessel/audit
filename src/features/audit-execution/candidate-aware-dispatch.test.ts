import { expect, test } from 'bun:test';

import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { createCandidateAwareDispatchPool } from './candidate-aware-dispatch.js';

test('rejects new candidate-aware work after a provider-neutral cancellation', async () => {
  const pool = createCandidateAwareDispatchPool(1);
  const cancellation = new SecurityReviewerError(
    'provider-cancelled',
    'The provider cancelled the current model stage.',
  );
  pool.cancel(cancellation);
  await expect(pool.run(async () => 'must-not-run')).rejects.toMatchObject({
    code: 'provider-cancelled',
  });
});
