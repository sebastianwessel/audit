import { expect, test } from 'bun:test';

import { SourcePostureModelOutputSchema } from './contract.js';

test('requires a semantic summary from every live posture assessment', () => {
  const output = {
    assessments: [
      {
        assessmentId: 'posture-obligation-01',
        obligationId: 'obligation-01',
        conclusion: 'inconclusive',
        evidenceMapFactIds: ['fact-operation-01'],
        limitations: [],
      },
    ],
    limitations: [],
  };

  expect(() => SourcePostureModelOutputSchema.parse(output)).toThrow('semantic summary');
  expect(
    SourcePostureModelOutputSchema.parse({
      ...output,
      assessments: [
        {
          ...output.assessments[0],
          summary: 'The inspected source does not resolve the approved obligation.',
        },
      ],
    }).assessments[0]?.summary,
  ).toBe('The inspected source does not resolve the approved obligation.');
});
