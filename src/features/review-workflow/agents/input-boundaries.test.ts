import { expect, test } from 'bun:test';
import { PlanModelInputSchema } from '../../attack-planning/index.js';
import { CandidateGroundingModelInputSchema } from '../../audit-execution/candidate-grounding/index.js';
import { EvidenceMapModelInputSchema } from '../../audit-execution/evidence-map/index.js';
import { VectorAuditModelInputSchema } from '../../audit-execution/investigation/index.js';
import { SourcePostureModelInputSchema } from '../../audit-execution/source-posture/index.js';
import { VerificationModelInputSchema } from '../../audit-execution/verification/index.js';

test('keeps source-planning and candidate-blind inputs free of later-stage claim data', () => {
  for (const schema of [
    PlanModelInputSchema,
    EvidenceMapModelInputSchema,
    SourcePostureModelInputSchema,
  ]) {
    expect(Object.hasOwn(schema.shape, 'findings')).toBeFalse();
    expect(Object.hasOwn(schema.shape, 'hypothesis')).toBeFalse();
    expect(Object.hasOwn(schema.shape, 'priority')).toBeFalse();
    expect(Object.hasOwn(schema.shape, 'fix')).toBeFalse();
    expect(Object.hasOwn(schema.shape, 'answerKey')).toBeFalse();
  }
  expect(Object.hasOwn(PlanModelInputSchema.shape, 'inspectionRequirement')).toBeTrue();
});

test('allows candidate data only at the declared downstream handoff boundaries', () => {
  expect(Object.hasOwn(VectorAuditModelInputSchema.shape, 'evidenceMap')).toBeTrue();
  expect(Object.hasOwn(VectorAuditModelInputSchema.shape, 'sourcePosture')).toBeTrue();
  expect(Object.hasOwn(VectorAuditModelInputSchema.shape, 'hypothesis')).toBeFalse();

  expect(Object.hasOwn(CandidateGroundingModelInputSchema.shape, 'seeds')).toBeTrue();
  expect(Object.hasOwn(CandidateGroundingModelInputSchema.shape, 'hypothesis')).toBeFalse();

  expect(Object.hasOwn(VerificationModelInputSchema.shape, 'hypothesis')).toBeTrue();
  expect(Object.hasOwn(VerificationModelInputSchema.shape, 'answerKey')).toBeFalse();
});
