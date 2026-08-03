import { expect, test } from 'bun:test';

import { AttackVectorSchema } from '../../attack-planning/plan.schema.js';
import { EvidenceMapSchema } from '../evidence-map/contract.js';

import { downgradeUninspectedSourcePosture, verifySourcePosture } from './verify.js';

const vector = AttackVectorSchema.parse({
  vectorId: 'vector-source-posture-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Review bounded source',
  rationale: 'The file needs source-backed review.',
  enabled: true,
  scopeGlobs: ['src/**'],
  reviewObligations: [
    {
      obligationId: 'test-obligation-01',
      riskStatement: 'The first risk may be present.',
      evidenceRequirement: 'First source proof.',
    },
    {
      obligationId: 'test-obligation-02',
      riskStatement: 'The second risk may be present.',
      evidenceRequirement: 'Second source proof.',
    },
  ],
  limitations: [],
});

const evidenceMap = EvidenceMapSchema.parse({
  facts: [
    {
      factId: 'fact-first-01',
      role: 'input',
      statement: 'The first reviewed input is in scope.',
      evidence: [{ path: 'src/reviewed.unknown', startLine: 1, snippet: 'source', kind: 'source' }],
      planObligations: [{ obligationId: 'test-obligation-01' }],
    },
    {
      factId: 'fact-second-01',
      role: 'operation',
      statement: 'The second reviewed operation is in scope.',
      evidence: [{ path: 'src/reviewed.unknown', startLine: 2, snippet: 'source', kind: 'source' }],
      planObligations: [{ obligationId: 'test-obligation-02' }],
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
});

test('retains model conclusions without deterministic source semantics and completes exact obligation coverage', () => {
  const result = verifySourcePosture(
    vector,
    {
      assessments: [
        {
          assessmentId: 'posture-first-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-contradicted',
          evidenceMapFactIds: ['fact-first-01'],
          limitations: [],
        },
        {
          assessmentId: 'posture-second-01',
          obligationId: 'test-obligation-02',
          conclusion: 'inconclusive',
          evidenceMapFactIds: ['fact-second-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    evidenceMap,
  );
  expect(result.complete).toBe(true);
  expect(result.sourcePosture.assessments.map((assessment) => assessment.conclusion)).toEqual([
    'risk-contradicted',
    'inconclusive',
  ]);
});

test('rejects an assessment whose map facts do not bind its approved obligation', () => {
  const result = verifySourcePosture(
    vector,
    {
      assessments: [
        {
          assessmentId: 'posture-first-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-second-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    evidenceMap,
  );
  expect(result.rejectedAssessmentCount).toBe(1);
  expect(result.complete).toBe(false);
  expect(result.sourcePosture.limitations).toContain(
    'The candidate-blind source posture did not establish every approved review obligation.',
  );
});

test('rejects a directional posture that omits an obligation-relevant mapped control', () => {
  const mapWithControl = EvidenceMapSchema.parse({
    facts: [
      ...evidenceMap.facts,
      {
        factId: 'fact-control-01',
        role: 'control',
        statement: 'A source-visible control is mapped before posture assessment.',
        evidence: [
          { path: 'src/reviewed.unknown', startLine: 1, snippet: 'source', kind: 'source' },
        ],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  const result = verifySourcePosture(
    vector,
    {
      assessments: [
        {
          assessmentId: 'posture-first-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-first-01'],
          limitations: [],
        },
        {
          assessmentId: 'posture-second-01',
          obligationId: 'test-obligation-02',
          conclusion: 'inconclusive',
          evidenceMapFactIds: ['fact-second-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    mapWithControl,
  );

  expect(result.rejectedAssessmentCount).toBe(1);
  expect(result.complete).toBe(false);
});

test('downgrades an uninspected directional posture without changing its phase bindings', () => {
  const verified = verifySourcePosture(
    vector,
    {
      assessments: [
        {
          assessmentId: 'posture-first-01',
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-first-01'],
          limitations: [],
        },
        {
          assessmentId: 'posture-second-01',
          obligationId: 'test-obligation-02',
          conclusion: 'risk-contradicted',
          evidenceMapFactIds: ['fact-second-01'],
          limitations: [],
        },
      ],
      limitations: [],
    },
    evidenceMap,
  );
  const downgraded = downgradeUninspectedSourcePosture(verified.sourcePosture);
  expect(downgraded.assessments).toMatchObject([
    {
      assessmentId: 'posture-first-01',
      obligationId: 'test-obligation-01',
      conclusion: 'inconclusive',
      evidenceMapFactIds: ['fact-first-01'],
    },
    {
      assessmentId: 'posture-second-01',
      obligationId: 'test-obligation-02',
      conclusion: 'inconclusive',
      evidenceMapFactIds: ['fact-second-01'],
    },
  ]);
  expect(downgraded.limitations).toContain(
    'The posture stage made no scoped read-only tool call; directional posture conclusions were downgraded to inconclusive before discovery.',
  );
});
