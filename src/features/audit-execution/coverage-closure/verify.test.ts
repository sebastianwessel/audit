import { expect, test } from 'bun:test';

import { AttackVectorSchema } from '../../attack-planning/plan.schema.js';
import { EvidenceMapSchema } from '../evidence-map/contract.js';
import { SourcePostureSchema } from '../source-posture/contract.js';

import { verifyInvestigationClosures } from './verify.js';

const vector = AttackVectorSchema.parse({
  vectorId: 'vector-closure-verify-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Verify review closure provenance',
  rationale: 'Every planned obligation needs evidence-phase provenance.',
  enabled: true,
  scopeGlobs: ['source.unknown'],
  reviewObligations: [
    {
      obligationId: 'closure-verify-obligation-01',
      riskStatement: 'The bounded source risk may be present.',
      evidenceRequirement: 'Every declaration is traceable to predecessor phases.',
    },
  ],
  limitations: [],
});

const evidenceMap = EvidenceMapSchema.parse({
  facts: [
    {
      factId: 'closure-verify-fact-01',
      role: 'operation',
      statement: 'The bounded source contains the reviewed operation.',
      evidence: [{ path: 'source.unknown', startLine: 1, snippet: 'operation', kind: 'source' }],
      planObligations: [{ obligationId: 'closure-verify-obligation-01' }],
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
});

const sourcePosture = SourcePostureSchema.parse({
  assessments: [
    {
      assessmentId: 'closure-verify-posture-01',
      obligationId: 'closure-verify-obligation-01',
      conclusion: 'risk-supported',
      evidenceMapFactIds: ['closure-verify-fact-01'],
      limitations: [],
    },
  ],
  limitations: [],
});

const validClosure = {
  planObligation: { obligationId: 'closure-verify-obligation-01' },
  disposition: 'no-source-backed-candidate' as const,
  evidenceMapFactIds: ['closure-verify-fact-01'],
  limitations: [],
};

test('accepts one valid closure for each planned obligation', () => {
  const result = verifyInvestigationClosures(vector, [validClosure], evidenceMap, sourcePosture);
  expect(result.complete).toBe(true);
  expect(result.closures).toEqual([
    { ...validClosure, sourcePostureAssessmentIds: ['closure-verify-posture-01'] },
  ]);
});

test('rejects an incomplete or duplicate closure set before it is checkpointed', () => {
  expect(verifyInvestigationClosures(vector, [], evidenceMap, sourcePosture)).toMatchObject({
    complete: false,
    closures: [],
  });
  expect(
    verifyInvestigationClosures(vector, [validClosure, validClosure], evidenceMap, sourcePosture),
  ).toMatchObject({ complete: false, closures: [] });
});
