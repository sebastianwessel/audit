import { expect, test } from 'bun:test';

import type { ProposedFinding } from '../../attack-planning/plan.schema.js';
import type { SourceDocument } from '../audit.schema.js';

import { buildInvestigationEvidencePackage } from './evidence-package.js';

const sources: SourceDocument[] = [
  { path: 'src/first.txt', content: 'a'.repeat(12), languageHint: null },
  { path: 'src/candidate.txt', content: 'b'.repeat(12), languageHint: null },
  { path: 'src/last.txt', content: 'c'.repeat(12), languageHint: null },
];

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
  const evidence = buildInvestigationEvidencePackage(sources, [candidate]);
  expect(evidence.sources.map((source) => source.path)).toEqual([
    'src/candidate.txt',
    'src/first.txt',
    'src/last.txt',
  ]);
  expect(evidence.omittedPaths).toEqual([]);
  expect(evidence.limitations).toEqual([]);
});
