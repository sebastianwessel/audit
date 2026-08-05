import { expect, test } from 'bun:test';

import { AttackVectorSchema } from '../../attack-planning/index.js';
import { EvidenceMapSchema } from '../evidence-map/contract.js';
import { SourcePostureSchema } from '../source-posture/contract.js';
import { verifyHypothesisSeeds } from './seed.js';

const vector = AttackVectorSchema.parse({
  vectorId: 'vector-seed-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Review bounded source evidence',
  rationale: 'The approved review needs bounded source evidence.',
  enabled: true,
  scopeGlobs: ['src/**'],
  reviewObligations: [
    {
      obligationId: 'seed-obligation-01',
      riskStatement: 'Reviewed input could reach the reviewed operation.',
      evidenceRequirement: 'Map source evidence for both the input and operation.',
    },
  ],
  limitations: [],
});

const evidenceMap = EvidenceMapSchema.parse({
  facts: [
    {
      factId: 'fact-origin-01',
      role: 'input',
      evidence: [
        { path: 'src/source.unknown', startLine: 1, contentDigest: 'a'.repeat(64), kind: 'source' },
      ],
      planObligations: [{ obligationId: 'seed-obligation-01' }],
    },
    {
      factId: 'fact-operation-01',
      role: 'operation',
      evidence: [
        { path: 'src/source.unknown', startLine: 2, contentDigest: 'a'.repeat(64), kind: 'source' },
      ],
      planObligations: [{ obligationId: 'seed-obligation-01' }],
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
});

const sourcePosture = SourcePostureSchema.parse({
  assessments: [
    {
      assessmentId: 'posture-question-01',
      obligationId: 'seed-obligation-01',
      conclusion: 'inconclusive',
      evidenceMapFactIds: ['fact-origin-01', 'fact-operation-01'],
      limitations: [],
    },
  ],
  limitations: [],
});

const seed = {
  seedId: 'seed-01',
  vectorId: vector.vectorId,
  hypothesis: 'The reviewed input may reach the reviewed operation.',
  planObligations: [{ obligationId: 'seed-obligation-01' }],
  evidenceMapFactIds: ['fact-origin-01'],
  limitations: [],
};

test('admits only a seed whose map and posture references are complete and valid', () => {
  expect(verifyHypothesisSeeds(vector, [seed], evidenceMap, sourcePosture)).toMatchObject({
    verified: [
      {
        ...seed,
        evidenceMapFactIds: ['fact-operation-01', 'fact-origin-01'],
        sourcePostureAssessmentIds: ['posture-question-01'],
      },
    ],
    rejectedCount: 0,
  });
  expect(
    verifyHypothesisSeeds(
      vector,
      [
        {
          ...seed,
          evidenceMapFactIds: ['missing-fact'],
        },
      ],
      evidenceMap,
      sourcePosture,
    ),
  ).toMatchObject({
    verified: [],
    rejectedCount: 1,
    rejected: [{ reason: 'model-evidence-map-reference-invalid' }],
  });
});
