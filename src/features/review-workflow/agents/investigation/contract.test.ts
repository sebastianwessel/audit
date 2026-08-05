import { expect, test } from 'bun:test';

import { AuditModelOutputSchema } from './contract.js';

test('accepts a bounded map/posture-bound discovery seed and closure', () => {
  const output = AuditModelOutputSchema.parse({
    seeds: [
      {
        seedId: 'seed-review-01',
        vectorId: 'vector-review-01',
        hypothesis: 'The reviewed source may require security follow-up.',
        planObligations: [{ obligationId: 'agent-obligation-01' }],
        evidenceMapFactIds: ['fact-source-01'],
        limitations: [],
      },
    ],
    closures: [
      {
        planObligation: { obligationId: 'agent-obligation-01' },
        disposition: 'candidate-raised',
        evidenceMapFactIds: ['fact-source-01'],
        limitations: [],
      },
    ],
  });
  expect(output.seeds[0]).toMatchObject({ seedId: 'seed-review-01' });
});

test('keeps the discovery boundary closed and non-reportable', () => {
  const seed = {
    seedId: 'seed-review-01',
    vectorId: 'vector-review-01',
    hypothesis: 'The reviewed source may require security follow-up.',
    planObligations: [{ obligationId: 'agent-obligation-01' }],
    evidenceMapFactIds: ['fact-source-01'],
    limitations: [],
  };
  expect(() =>
    AuditModelOutputSchema.parse({ seeds: [{ ...seed, priority: 'high' }], closures: [] }),
  ).toThrow();
  expect(() =>
    AuditModelOutputSchema.parse({
      seeds: [{ ...seed, sourcePostureAssessmentIds: ['posture-question-01'] }],
      closures: [],
    }),
  ).toThrow();
  expect(() =>
    AuditModelOutputSchema.parse({
      seeds: [
        {
          ...seed,
          claimEvidenceSelections: {
            operation: { factId: 'fact-source-01', evidenceIndex: 0 },
            unsafeCondition: { factId: 'fact-source-01', evidenceIndex: 0 },
          },
        },
      ],
      closures: [],
    }),
  ).toThrow();
  expect(() => AuditModelOutputSchema.parse({ findings: [], closures: [] })).toThrow();
});
