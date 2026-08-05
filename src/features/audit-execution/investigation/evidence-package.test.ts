import { expect, test } from 'bun:test';

import type { ProposedFinding } from '../../attack-planning/index.js';

import { buildInvestigationEvidencePackage } from './evidence-package.js';

const sourcePaths = ['src/first.txt', 'src/candidate.txt', 'src/last.txt'];

const candidate: ProposedFinding = {
  vectorId: 'vector-injection-01',
  claimEvidenceBundles: [
    {
      role: 'operation',
      evidence: [
        {
          path: 'src/candidate.txt',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
          role: 'operation',
        },
      ],
    },
    {
      role: 'unsafe-condition',
      evidence: [
        {
          path: 'src/candidate.txt',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
          role: 'unsafe-condition',
        },
      ],
    },
  ],
  planObligations: [{ obligationId: 'candidate-obligation-01' }],
};

test('prioritizes deterministic candidate files without omitting approved source', () => {
  const evidence = buildInvestigationEvidencePackage(sourcePaths, [candidate]);
  expect(evidence.sourcePaths).toEqual(['src/candidate.txt', 'src/first.txt', 'src/last.txt']);
  expect(evidence.omittedPaths).toEqual([]);
  expect(evidence.limitations).toEqual([]);
});
