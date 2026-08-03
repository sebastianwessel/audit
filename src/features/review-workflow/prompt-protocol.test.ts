import { expect, test } from 'bun:test';

import { reviewWorkflowPromptProtocolFingerprint } from './prompt-protocol.js';

test('publishes a stable content-free prompt protocol fingerprint', () => {
  expect(reviewWorkflowPromptProtocolFingerprint).toMatch(/^[a-f0-9]{64}$/u);
});
