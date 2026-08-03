import { expect, test } from 'bun:test';

import { ScopedInspectionRequirementSchema, scopedInspectionRequirement } from './contract.js';

test('requires a source inspection exactly when the scoped manifest is non-empty', () => {
  expect(scopedInspectionRequirement([])).toEqual({
    required: false,
    allowedToolIds: ['repo_read', 'repo_grep'],
  });
  expect(scopedInspectionRequirement(['src/example.unknown'])).toEqual({
    required: true,
    allowedToolIds: ['repo_read', 'repo_grep'],
  });
});

test('keeps the source-inspection protocol closed to the allowed read tools', () => {
  expect(() =>
    ScopedInspectionRequirementSchema.parse({
      required: true,
      allowedToolIds: ['repo_grep', 'repo_read'],
    }),
  ).toThrow();
  expect(() =>
    ScopedInspectionRequirementSchema.parse({
      required: true,
      allowedToolIds: ['repo_read', 'repo_grep'],
      bypass: true,
    }),
  ).toThrow();
});
