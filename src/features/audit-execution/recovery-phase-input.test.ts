import { expect, test } from 'bun:test';

import { RecoveryPhaseInputSchema, recoveryPhaseInputFingerprint } from './recovery-phase-input.js';

const evidenceMapFingerprint = 'a'.repeat(64);
const sourcePostureFingerprint = 'b'.repeat(64);

test('binds each recovery phase to its complete semantic predecessor state', () => {
  const beforeRepair = recoveryPhaseInputFingerprint({
    phase: 'source-posture',
    evidenceMapFingerprint,
  });
  const afterRepair = recoveryPhaseInputFingerprint({
    phase: 'source-posture',
    evidenceMapFingerprint: 'c'.repeat(64),
  });
  const beforePostureRecomputation = recoveryPhaseInputFingerprint({
    phase: 'candidate-grounding',
    evidenceMapFingerprint,
    sourcePostureFingerprint,
  });
  const afterPostureRecomputation = recoveryPhaseInputFingerprint({
    phase: 'candidate-grounding',
    evidenceMapFingerprint,
    sourcePostureFingerprint: 'd'.repeat(64),
  });

  expect(afterRepair).not.toBe(beforeRepair);
  expect(afterPostureRecomputation).not.toBe(beforePostureRecomputation);
  expect(
    recoveryPhaseInputFingerprint({
      phase: 'verification',
      candidateFingerprint: 'e'.repeat(64),
      evidenceMapFingerprint,
      sourcePostureFingerprint,
    }),
  ).not.toBe(
    recoveryPhaseInputFingerprint({
      phase: 'countercheck',
      candidateFingerprint: 'e'.repeat(64),
      evidenceMapFingerprint,
      sourcePostureFingerprint,
    }),
  );
});

test('rejects a recovery phase input with missing or irrelevant predecessor identities', () => {
  expect(() =>
    RecoveryPhaseInputSchema.parse({
      phase: 'source-posture',
    }),
  ).toThrow();
  expect(() =>
    RecoveryPhaseInputSchema.parse({
      phase: 'evidence-mapping',
      evidenceMapFingerprint,
    }),
  ).toThrow();
});
