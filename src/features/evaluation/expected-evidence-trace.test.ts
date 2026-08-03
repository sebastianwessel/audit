import { expect, test } from 'bun:test';
import {
  type ExpectedEvidenceRoleTrace,
  ExpectedEvidenceRoleTraceSchema,
} from './corpus.schema.js';
import { firstIncompleteExpectedEvidenceStage } from './expected-evidence-trace.js';

const base = {
  findingId: 'expected-finding-01',
  role: 'operation' as const,
  planScoped: true,
  mapperSelected: true,
  postureReconciled: true,
  discoverySeeded: true,
  groundingSelected: true,
  verifierSelected: true,
  terminalCompleted: true,
};

test('identifies the first missing evaluator-only role stage in fixed workflow order', () => {
  const cases: readonly [keyof typeof base, ExpectedEvidenceRoleTrace['firstIncompleteStage']][] = [
    ['planScoped', 'planning-scope'],
    ['mapperSelected', 'evidence-mapping'],
    ['postureReconciled', 'source-posture'],
    ['discoverySeeded', 'investigation'],
    ['groundingSelected', 'candidate-grounding'],
    ['verifierSelected', 'verification'],
    ['terminalCompleted', 'terminal'],
  ];
  for (const [field, expected] of cases) {
    expect(firstIncompleteExpectedEvidenceStage({ ...base, [field]: false })).toBe(expected);
  }
  expect(firstIncompleteExpectedEvidenceStage(base)).toBe('complete');
});

test('accepts only source-free trace fields', () => {
  expect(
    ExpectedEvidenceRoleTraceSchema.parse({ ...base, firstIncompleteStage: 'complete' }),
  ).toMatchObject({ findingId: 'expected-finding-01', role: 'operation' });
  expect(() =>
    ExpectedEvidenceRoleTraceSchema.parse({
      ...base,
      firstIncompleteStage: 'complete',
      path: 'sensitive-source.ts',
    }),
  ).toThrow();
});
