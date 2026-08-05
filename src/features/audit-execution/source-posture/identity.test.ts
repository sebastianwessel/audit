import { expect, test } from 'bun:test';

import { SourcePostureSchema } from './contract.js';
import { sourcePostureFingerprint } from './identity.js';

test('binds a posture summary into the exact downstream dependency fingerprint', () => {
  const posture = SourcePostureSchema.parse({
    assessments: [
      {
        assessmentId: 'posture-obligation-01',
        obligationId: 'obligation-01',
        conclusion: 'inconclusive',
        summary: 'The source does not resolve the approved obligation.',
        evidenceMapFactIds: ['fact-operation-01'],
        limitations: [],
      },
    ],
    limitations: [],
  });
  const [assessment] = posture.assessments;
  if (assessment === undefined) throw new Error('Expected a fixture assessment.');

  expect(sourcePostureFingerprint(posture)).not.toBe(
    sourcePostureFingerprint({
      ...posture,
      assessments: [{ ...assessment, summary: 'A different posture summary.' }],
    }),
  );
});
