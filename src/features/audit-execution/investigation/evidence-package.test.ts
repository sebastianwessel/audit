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
  statement: 'Candidate',
  evidence: [{ path: 'src/candidate.txt', startLine: 1, snippet: 'b', kind: 'source' }],
  planObligations: [{ obligationId: 'candidate-obligation-01' }],
  limitations: [],
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
