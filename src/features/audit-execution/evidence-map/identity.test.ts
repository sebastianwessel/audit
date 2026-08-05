import { expect, test } from 'bun:test';

import { EvidenceMapSchema } from './contract.js';
import { evidenceMapFingerprint } from './repair.js';

test('binds a semantic map summary into the exact downstream dependency fingerprint', () => {
  const map = EvidenceMapSchema.parse({
    facts: [
      {
        factId: 'fact-operation-01',
        role: 'operation',
        summary: 'The scoped source performs the reviewed operation.',
        evidence: [
          {
            path: 'reviewed.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
          },
        ],
        planObligations: [{ obligationId: 'obligation-01' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  const [fact] = map.facts;
  if (fact === undefined) throw new Error('Expected a fixture fact.');

  expect(evidenceMapFingerprint(map)).not.toBe(
    evidenceMapFingerprint({
      ...map,
      facts: [{ ...fact, summary: 'A materially different semantic summary.' }],
    }),
  );
});
