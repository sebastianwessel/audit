import { expect, test } from 'bun:test';

import { DeveloperGuidanceCheckpointBindingSchema } from './guidance.schema.js';
import {
  createDeveloperGuidanceId,
  hasExactDeveloperGuidanceCheckpointBinding,
} from './identity.js';

test('binds one guidance run to its exact report identity without a random identifier', () => {
  expect(createDeveloperGuidanceId('report-001', 'guidance-run-001')).toBe(
    createDeveloperGuidanceId('report-001', 'guidance-run-001'),
  );
  expect(createDeveloperGuidanceId('report-001', 'guidance-run-001')).not.toBe(
    createDeveloperGuidanceId('report-002', 'guidance-run-001'),
  );
});

test('rejects checkpoint reuse when any identity binding changes', () => {
  const binding = DeveloperGuidanceCheckpointBindingSchema.parse({
    runId: 'guidance-run-001',
    reportId: 'report-001',
    reportDigest: 'a'.repeat(64),
    planId: 'plan-001',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'c'.repeat(64),
    contextDigest: 'd'.repeat(64),
    provider: 'openai',
    model: 'gpt-5.6-terra',
    protocolFingerprint: 'e'.repeat(64),
  });
  expect(hasExactDeveloperGuidanceCheckpointBinding(binding, binding)).toBe(true);
  expect(
    hasExactDeveloperGuidanceCheckpointBinding(binding, { ...binding, model: 'other-model' }),
  ).toBe(false);
});
