import { expect, test } from 'bun:test';

import {
  AuditRuntimeError,
  AuditRuntimeErrorCodeSchema,
  isRetryableAuditRuntimeErrorCode,
} from './audit-runtime-error.js';

test('audit runtime errors expose only a stable code and message', () => {
  const error = new AuditRuntimeError('unsafe-path', 'The path is outside the target root.');
  expect(error.name).toBe('AuditRuntimeError');
  expect(error.code).toBe('unsafe-path');
  expect(error.message).toBe('The path is outside the target root.');
});

test('keeps provider operational codes closed and marks only recoverable ones retryable', () => {
  expect(AuditRuntimeErrorCodeSchema.parse('provider-rate-limited')).toBe('provider-rate-limited');
  expect(isRetryableAuditRuntimeErrorCode('provider-rate-limited')).toBe(true);
  expect(isRetryableAuditRuntimeErrorCode('provider-http-error')).toBe(false);
  expect(isRetryableAuditRuntimeErrorCode('unexpected-provider-text')).toBe(false);
});
