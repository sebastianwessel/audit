import { expect, test } from 'bun:test';

import { SourcePostureSchema, UnverifiedSourcePostureSchema } from './contract.js';

test('normalizes only known source-posture conclusion tokens at the model boundary', () => {
  const posture = UnverifiedSourcePostureSchema.parse({
    assessments: [
      {
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
    obligationId: 'test-obligation-01',
    conclusion: 'risk-supported',
    evidenceMapFactIds: ['fact-input-01'],
    limitations: [],
  };
  expect(() =>
    UnverifiedSourcePostureSchema.parse({
      assessments: [assessment, { ...assessment }],
      limitations: [],
    }),
  ).toThrow('at most one');
  expect(() =>
    UnverifiedSourcePostureSchema.parse({ assessments: [assessment], limitations: [], raw: true }),
  ).toThrow('Unrecognized key');
});

test('requires a closed reason only for a not-applicable assessment', () => {
  const base = {
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
          notApplicableReason: ' NO-RELEVANT-OPERATION-IN-SCOPE ',
        },
      ],
      limitations: [],
    }).assessments[0]?.notApplicableReason,
  ).toBe('no-relevant-operation-in-scope');
  expect(
    SourcePostureSchema.parse({
      assessments: [
        {
          ...base,
          assessmentId: 'posture-question-01',
          conclusion: 'not-applicable',
          notApplicableReason: 'no-relevant-operation-in-scope',
        },
      ],
      limitations: [],
    }).assessments[0]?.notApplicableReason,
  ).toBe('no-relevant-operation-in-scope');
  expect(() =>
    UnverifiedSourcePostureSchema.parse({
      assessments: [
        {
          ...base,
          conclusion: 'not-applicable',
          notApplicableReason: 'the scoped code has no matching feature',
        },
      ],
      limitations: [],
    }),
  ).toThrow();
});
