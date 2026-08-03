import { expect, test } from 'bun:test';

import { SecurityReviewerError } from './security-reviewer-error.js';

test('security reviewer errors expose only a stable code and message', () => {
  const error = new SecurityReviewerError('unsafe-path', 'The path is outside the target root.');
  expect(error.name).toBe('SecurityReviewerError');
  expect(error.code).toBe('unsafe-path');
  expect(error.message).toBe('The path is outside the target root.');
});
