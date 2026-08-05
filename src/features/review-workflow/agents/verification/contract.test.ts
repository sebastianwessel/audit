import { expect, test } from 'bun:test';

import { VerificationModelOutputSchema } from './contract.js';

test('requires the provider transport envelope and preserves decision-specific result fields', () => {
  expect(
    VerificationModelOutputSchema.parse({
      result: {
        decision: 'incomplete',
        reasonCode: 'context-required',
        reason: 'The scoped source cannot establish the required consequence.',
      },
    }),
  ).toMatchObject({ result: { decision: 'incomplete', reasonCode: 'context-required' } });
  expect(() =>
    VerificationModelOutputSchema.parse({
      decision: 'incomplete',
      reasonCode: 'context-required',
      reason: 'The response omitted its required transport envelope.',
    }),
  ).toThrow();
  expect(() =>
    VerificationModelOutputSchema.parse({
      result: {
        decision: 'incomplete',
        reasonCode: 'context-required',
        reason: 'The response includes a field from a different decision branch.',
        affectedPlanObligations: [{ obligationId: 'verification-obligation-01' }],
      },
    }),
  ).toThrow();
});
