import { expect, test } from 'bun:test';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEvaluatorFailureDiagnosticsStore } from './evaluator-failure-diagnostics.js';

test('writes a schema-validated diagnostic only below its feature-owned private work root', async () => {
  const root = join(tmpdir(), `audit-evaluator-diagnostic-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const store = createEvaluatorFailureDiagnosticsStore({
    outputRoot: root,
    evaluationRunId: 'evaluator-diagnostic-01',
    privateWorkPath: '.provider-evaluations/evaluator-diagnostic-01/work',
  });
  await store.save({
    schemaVersion: 2,
    diagnosticId: 'evaluator-failure-01',
    evaluationRunId: 'evaluator-diagnostic-01',
    occurredAt: '2026-08-04T12:00:00.000Z',
    stage: 'verification',
    route: 'primary',
    stageId: 'vector-01',
    attemptOrdinal: 1,
    durationMs: 1,
    scopeFingerprint: 'a'.repeat(64),
    protocolFingerprint: 'b'.repeat(64),
    errorCode: 'provider-http-error',
    validationRetryGuidance: null,
    errorClass: 'model-error',
    modelFailure: {
      provider: 'openai',
      model: 'gpt-5.6-terra',
      method: 'object',
      reason: 'http_error',
      status: 400,
      providerCode: 'invalid_json_schema',
    },
  });

  const path = join(
    root,
    '.provider-evaluations',
    'evaluator-diagnostic-01',
    'work',
    'diagnostics',
    'evaluator-failure-01.json',
  );
  await expect(readFile(path, 'utf8')).resolves.toContain('provider-http-error');
});

test('rejects a diagnostic that belongs to a different evaluator run', async () => {
  const root = join(tmpdir(), `audit-evaluator-diagnostic-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  const store = createEvaluatorFailureDiagnosticsStore({
    outputRoot: root,
    evaluationRunId: 'evaluator-diagnostic-01',
    privateWorkPath: '.provider-evaluations/evaluator-diagnostic-01/work',
  });
  await expect(
    store.save({
      schemaVersion: 2,
      diagnosticId: 'evaluator-failure-02',
      evaluationRunId: 'different-evaluator-run',
      occurredAt: '2026-08-04T12:00:00.000Z',
      stage: 'verification',
      route: 'primary',
      stageId: 'vector-01',
      attemptOrdinal: 1,
      durationMs: 1,
      scopeFingerprint: 'a'.repeat(64),
      protocolFingerprint: 'b'.repeat(64),
      errorCode: 'provider-http-error',
      validationRetryGuidance: null,
      errorClass: 'model-error',
      modelFailure: null,
    }),
  ).rejects.toMatchObject({ code: 'artifact-write-failed' });
});
