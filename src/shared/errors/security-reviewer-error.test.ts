import { expect, test } from 'bun:test';

import {
  isRetryableSecurityReviewerErrorCode,
  SecurityReviewerError,
  SecurityReviewerErrorCodeSchema,
} from './security-reviewer-error.js';

test('security reviewer errors expose only a stable code and message', () => {
  const error = new SecurityReviewerError('unsafe-path', 'The path is outside the target root.');
  expect(error.name).toBe('SecurityReviewerError');
  expect(error.code).toBe('unsafe-path');
  expect(error.message).toBe('The path is outside the target root.');
});

test('keeps provider operational codes closed and marks only recoverable ones retryable', () => {
  expect(SecurityReviewerErrorCodeSchema.parse('provider-rate-limited')).toBe(
    'provider-rate-limited',
  );
  expect(isRetryableSecurityReviewerErrorCode('provider-rate-limited')).toBe(true);
  expect(isRetryableSecurityReviewerErrorCode('provider-http-error')).toBe(false);
  expect(isRetryableSecurityReviewerErrorCode('unexpected-provider-text')).toBe(false);
});
