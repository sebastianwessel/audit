import { expect, test } from 'bun:test';

import {
  AgentLoopBudgetError,
  ModelError,
  OperationCancelledError,
  OperationTimeoutError,
  ValidationError,
} from '@purista/harness';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';

import { invokeWithStageRetry, stageErrorCode } from './invocation.js';

test('retries one failed stage invocation and preserves the successful result', async () => {
  let attempts = 0;
  const recovered: string[] = [];
  const result = await invokeWithStageRetry(
    {
      runTimeoutMs: 30_000,
      modelTimeoutMs: 20_000,
      modelRetry: 'default',
    },
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary provider failure');
      return 'completed';
    },
    { onRecoverableFailure: () => recovered.push('failed-attempt') },
  );
  expect(result).toBe('completed');
  expect(attempts).toBe(2);
  expect(recovered).toEqual(['failed-attempt']);
});

test('normalizes only stable security-reviewer errors', () => {
  expect(stageErrorCode(new SecurityReviewerError('provider-context-overflow', 'overflow'))).toBe(
    'provider-context-overflow',
  );
  expect(stageErrorCode(new Error('provider content'))).toBe('provider-failure');
  expect(
    stageErrorCode(
      new ModelError('provider message that must not enter telemetry', {
        provider: 'test-provider',
        model: 'test-model',
        method: 'object',
        reason: 'rate_limited',
        providerMessage: 'untrusted provider content',
      }),
    ),
  ).toBe('provider-rate-limited');
  expect(
    stageErrorCode(
      new ModelError('provider message that must not enter telemetry', {
        provider: 'test-provider',
        model: 'test-model',
        method: 'object',
        reason: 'http_error',
      }),
    ),
  ).toBe('provider-http-error');
  expect(
    stageErrorCode(
      new AgentLoopBudgetError('Agent loop budget exceeded.', {
        agent_id: 'test-agent',
        reason: 'iterations_exceeded',
        limit: 64,
      }),
    ),
  ).toBe('agent-loop-budget-exceeded');
  expect(stageErrorCode(new OperationCancelledError('cancelled', { scope: 'model' }))).toBe(
    'provider-cancelled',
  );
  expect(
    stageErrorCode(new OperationTimeoutError('timed out', { scope: 'model', timeout_ms: 1_000 })),
  ).toBe('provider-cancelled');
});

test('does not blind-retry a harness-declared non-retryable model failure', async () => {
  let attempts = 0;
  await expect(
    invokeWithStageRetry(
      { runTimeoutMs: 30_000, modelTimeoutMs: 20_000, modelRetry: 'default' },
      async () => {
        attempts += 1;
        throw new ModelError('provider response was malformed', {
          provider: 'test-provider',
          model: 'test-model',
          method: 'object',
          reason: 'malformed_response',
        });
      },
    ),
  ).rejects.toBeInstanceOf(ModelError);
  expect(attempts).toBe(1);
});

test('does not retry a provider-neutral cancellation or timeout', async () => {
  let cancellationAttempts = 0;
  await expect(
    invokeWithStageRetry(
      { runTimeoutMs: 30_000, modelTimeoutMs: 20_000, modelRetry: 'default' },
      async () => {
        cancellationAttempts += 1;
        throw new OperationCancelledError('cancelled', { scope: 'model' });
      },
    ),
  ).rejects.toBeInstanceOf(OperationCancelledError);
  expect(cancellationAttempts).toBe(1);
});

test('keeps complete model-output validation diagnostics content-free and stable', () => {
  const error = new ValidationError('Agent output validation failed.', {
    where: 'agent_output',
    issues: [
      { path: ['facts', 0, 'evidence', 0, 'endLine'], message: 'contains source text' },
      { path: ['facts', 1, 'evidence', 0, 'endLine'], message: 'contains source text' },
      { path: ['facts', 0, 'planObligations'], message: 'contains source text' },
    ],
  });
  const code = stageErrorCode(error);
  expect(code).toMatch(/^validation-output-2-[a-f0-9]{16}$/u);
  expect(code).not.toContain('facts');
  expect(code).not.toContain('source text');
  expect(
    stageErrorCode(
      new ValidationError('Agent output validation failed.', {
        where: 'agent_output',
        issues: [
          { path: ['facts', 0, 'planObligations'], message: 'other message' },
          { path: ['facts', 1, 'evidence', 0, 'endLine'], message: 'other message' },
        ],
      }),
    ),
  ).toBe(code);
  expect(
    stageErrorCode(
      new ValidationError('Agent output validation failed.', {
        where: 'agent_output',
        issues: [
          { path: ['facts', 0, 'evidence', 0, 'endLine'], message: 'other message' },
          { path: ['facts', 0, 'planObligations'], message: 'other message' },
          { path: ['facts', 0, 'limitations'], message: 'other message' },
        ],
      }),
    ),
  ).not.toBe(code);
});
