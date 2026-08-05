import { expect, test } from 'bun:test';

import { DeveloperGuidanceCheckpointBindingSchema } from './guidance.schema.js';
import {
  createDeveloperGuidanceId,
  hasExactDeveloperGuidanceCheckpointBinding,
  hasExactDeveloperGuidanceReportBinding,
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

test('matches a completed guidance artifact only to its exact checkpoint binding', () => {
  const binding = DeveloperGuidanceCheckpointBindingSchema.parse({
    runId: 'guidance-run-002',
    reportId: 'report-002',
    reportDigest: 'a'.repeat(64),
    planId: 'plan-002',
    planDigest: 'b'.repeat(64),
    targetFingerprint: 'c'.repeat(64),
    contextDigest: 'd'.repeat(64),
    provider: 'openai',
    model: 'gpt-5.6-terra',
    protocolFingerprint: 'e'.repeat(64),
  });
  const report = {
    runId: binding.runId,
    reportId: binding.reportId,
    reportDigest: binding.reportDigest,
    planId: binding.planId,
    planDigest: binding.planDigest,
    targetFingerprint: binding.targetFingerprint,
    contextDigest: binding.contextDigest,
  };

  expect(hasExactDeveloperGuidanceReportBinding(report, binding)).toBe(true);
  expect(
    hasExactDeveloperGuidanceReportBinding({ ...report, contextDigest: 'f'.repeat(64) }, binding),
  ).toBe(false);
});
