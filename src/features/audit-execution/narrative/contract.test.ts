import { expect, test } from 'bun:test';

import { ClaimNarrativeSchema } from './contract.js';

test('retains a complete human-readable narrative while redacting sensitive text', () => {
  const narrative = ClaimNarrativeSchema.parse({
    statement: 'The request reaches an operation with password = "fixture-secret".',
    roleExplanations: [
      { role: 'operation', explanation: 'The operation is selected from the mapped source.' },
      {
        role: 'unsafe-condition',
        explanation:
          'The request-controlled value reaches that operation without the required check.',
      },
    ],
    limitations: ['The surrounding deployment control was not represented in the approved scope.'],
  });

  expect(narrative.statement).not.toContain('fixture-secret');
  expect(narrative.statement).toContain('[REDACTED_SECRET]');
  expect(narrative.roleExplanations).toHaveLength(2);
  expect(narrative.limitations).toEqual([
    'The surrounding deployment control was not represented in the approved scope.',
  ]);
});

test('requires exactly one explanation for each evidence role and rejects unknown fields', () => {
  const valid = {
    statement: 'The reviewed operation may be reached with an unsafe condition.',
    roleExplanations: [
      { role: 'operation', explanation: 'The selected operation establishes the reviewed action.' },
      {
        role: 'unsafe-condition',
        explanation: 'The selected condition establishes the unsafe state.',
      },
    ],
    limitations: [],
  };

  expect(
    ClaimNarrativeSchema.safeParse({
      ...valid,
      roleExplanations: [valid.roleExplanations[0], valid.roleExplanations[0]],
    }).success,
  ).toBe(false);
  expect(ClaimNarrativeSchema.safeParse({ ...valid, unexpected: true }).success).toBe(false);
});
