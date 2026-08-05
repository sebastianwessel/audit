import { expect, test } from 'bun:test';

import { EvidenceMapModelOutputSchema } from './contract.js';

test('requires a semantic statement from every live mapper fact', () => {
  const output = {
    facts: [
      {
        factId: 'fact-operation-01',
        role: 'operation',
        evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
        planObligations: [{ obligationId: 'obligation-01' }],
      },
    ],
    controlCoverage: [{ obligationId: 'obligation-01', controlFactIds: [] }],
    unansweredPlanObligations: [],
    limitations: [],
  };

  expect(() => EvidenceMapModelOutputSchema.parse(output)).toThrow('semantic statement');
  expect(
    EvidenceMapModelOutputSchema.parse({
      ...output,
      facts: [
        {
          ...output.facts[0],
          statement: 'The scoped source performs the reviewed operation.',
        },
      ],
    }).facts[0]?.statement,
  ).toBe('The scoped source performs the reviewed operation.');
});
