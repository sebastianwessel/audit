import { expect, test } from 'bun:test';

import { UnverifiedSourcePostureSchema } from './contract.js';

test('normalizes only known source-posture conclusion tokens at the model boundary', () => {
  const posture = UnverifiedSourcePostureSchema.parse({
    assessments: [
      {
        assessmentId: 'posture-question-01',
        obligationId: 'test-obligation-01',
        conclusion: ' RISK-SUPPORTED ',
        evidenceMapFactIds: ['fact-input-01'],
        limitations: [],
      },
    ],
    limitations: [],
  });
  expect(posture.assessments[0]?.conclusion).toBe('risk-supported');
});

test('rejects duplicate obligation assessments and unknown fields', () => {
  const assessment = {
    assessmentId: 'posture-question-01',
    obligationId: 'test-obligation-01',
    conclusion: 'risk-supported',
    evidenceMapFactIds: ['fact-input-01'],
    limitations: [],
  };
  expect(() =>
    UnverifiedSourcePostureSchema.parse({
      assessments: [assessment, { ...assessment, assessmentId: 'posture-question-02' }],
      limitations: [],
    }),
  ).toThrow('at most one');
  expect(() =>
    UnverifiedSourcePostureSchema.parse({ assessments: [assessment], limitations: [], raw: true }),
  ).toThrow();
});

test('requires a crisp reason only for a not-applicable assessment', () => {
  const base = {
    assessmentId: 'posture-question-01',
    obligationId: 'test-obligation-01',
    evidenceMapFactIds: ['fact-input-01'],
    limitations: [],
  };
  expect(() =>
    UnverifiedSourcePostureSchema.parse({
      assessments: [{ ...base, conclusion: 'not-applicable' }],
      limitations: [],
    }),
  ).toThrow('required reason');
  expect(
    UnverifiedSourcePostureSchema.parse({
      assessments: [
        {
          ...base,
          conclusion: 'not-applicable',
          notApplicableReason: 'The scoped code has no matching feature.',
        },
      ],
      limitations: [],
    }).assessments[0]?.notApplicableReason,
  ).toBe('The scoped code has no matching feature.');
});
