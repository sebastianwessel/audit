import { expect, test } from 'bun:test';

import { AttackPlanSchema, hasExactPlanObligations, SourceEvidenceSchema } from './plan.schema.js';

const plan = {
  schemaVersion: 2,
  planId: 'plan-demo-01',
  planDigest: 'c'.repeat(64),
  targetFingerprint: 'a'.repeat(64),
  contextDigest: 'b'.repeat(64),
  targetDisplayName: 'demo',
  createdAt: '2026-07-27T12:00:00.000Z',
  inventorySummary: { fileCount: 1, totalBytes: 4, languageHints: ['typescript'] },
  vectors: [
    {
      vectorId: 'vector-injection-01',
      vectorDigest: 'd'.repeat(64),
      title: 'Review injection boundaries',
      rationale: 'User data enters query construction.',
      enabled: true,
      scopeGlobs: ['src/**'],
      reviewObligations: [
        {
          obligationId: 'test-obligation-01',
          riskStatement: 'Untrusted input may reach query construction without parameterization.',
          evidenceRequirement: 'The review identifies a source-backed unsafe query boundary.',
        },
      ],
      limitations: [],
    },
  ],
};

test('attack plan contract accepts an executable plan', () => {
  expect(AttackPlanSchema.parse(plan).planId).toBe('plan-demo-01');
});

test('does not impose fixed product ceilings on vectors, obligations, or source evidence', () => {
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Fixture requires one vector.');
  const obligations = Array.from({ length: 65 }, (_, index) => ({
    obligationId: `test-obligation-${index + 1}`,
    riskStatement: `Risk statement ${index + 1}.`,
    evidenceRequirement: `Evidence requirement ${index + 1}.`,
  }));
  const vectors = Array.from({ length: 65 }, (_, index) => ({
    ...vector,
    vectorId: `vector-${index + 1}`,
    vectorDigest: `${index.toString(16).padStart(2, '0')}${'d'.repeat(62)}`,
    reviewObligations: obligations,
  }));
  expect(AttackPlanSchema.parse({ ...plan, vectors }).vectors).toHaveLength(65);
  expect(
    SourceEvidenceSchema.parse({
      path: 'source.unknown',
      startLine: 1,
      snippet: 'source',
      kind: 'source',
      role: 'operation',
    }),
  ).toBeDefined();
});

test('attack plan contract rejects unknown fields and retired approval metadata', () => {
  expect(() => AttackPlanSchema.parse({ ...plan, unexpected: true })).toThrow();
  expect(() => AttackPlanSchema.parse({ ...plan, reviewStatus: 'approved' })).toThrow();
});

test('rejects retired indexed obligations instead of translating them', () => {
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Fixture requires one vector.');
  expect(() =>
    AttackPlanSchema.parse({
      ...plan,
      vectors: [
        {
          ...vector,
          reviewObligations: [
            {
              obligationId: 'test-obligation-01',
              evidenceQuestionIndex: 0,
              successCriterionIndex: 0,
            },
          ],
        },
      ],
    }),
  ).toThrow();
});

test('canonicalizes source-evidence tokens supplied by an agent boundary', () => {
  expect(
    SourceEvidenceSchema.parse({
      path: 'src/review.ts',
      startLine: 1,
      endLine: null,
      snippet: 'operation(value)',
      kind: ' SOURCE ',
      role: null,
    }),
  ).toMatchObject({ kind: 'source' });
});

test('owns the extended source-role vocabulary in one reusable schema', () => {
  expect(
    SourceEvidenceSchema.parse({
      path: 'source.unknown',
      startLine: 1,
      snippet: 'source',
      kind: 'source',
      role: ' CounterEvidence ',
    }).role,
  ).toBe('counterevidence');
  expect(() =>
    SourceEvidenceSchema.parse({
      path: 'source.unknown',
      startLine: 1,
      snippet: 'source',
      kind: 'source',
      role: 'language-specific-shortcut',
    }),
  ).toThrow();
});

test('requires verifier obligations to exactly match the hypothesis obligations', () => {
  const first = { obligationId: 'test-obligation-01' };
  const second = { obligationId: 'test-obligation-02' };
  expect(hasExactPlanObligations([first, second], [second, first])).toBe(true);
  expect(hasExactPlanObligations([first], [first, second])).toBe(false);
  expect(hasExactPlanObligations([first, first], [first, second])).toBe(false);
});
