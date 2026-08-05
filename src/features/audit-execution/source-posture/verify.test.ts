import { expect, test } from 'bun:test';

import { AttackVectorSchema } from '../../attack-planning/index.js';
import { EvidenceMapSchema } from '../evidence-map/contract.js';

import {
  downgradeUninspectedSourcePosture,
  verifySourcePosture,
  verifySourcePostureFragment,
} from './verify.js';

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
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: [{ obligationId: 'test-obligation-01' }],
    },
    {
      factId: 'fact-second-01',
      role: 'operation',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 2,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
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
          obligationId: 'test-obligation-01',
          conclusion: 'risk-contradicted',
          evidenceMapFactIds: ['fact-first-01'],
          limitations: [],
        },
        {
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
  expect(result.sourcePosture.limitations).toContain('obligation-assessment-missing');
});

test('rejects a directional posture that omits an obligation-relevant mapped control', () => {
  const mapWithControl = EvidenceMapSchema.parse({
    facts: [
      ...evidenceMap.facts,
      {
        factId: 'fact-control-01',
        role: 'control',
        evidence: [
          {
            path: 'src/reviewed.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
          },
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
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-first-01'],
          limitations: [],
        },
        {
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

test('accepts a child posture with its local control and defers global control closure', () => {
  const firstEvidenceFact = evidenceMap.facts[0];
  if (firstEvidenceFact === undefined) throw new Error('Missing first evidence-map fixture fact.');
  const mapWithTwoControls = EvidenceMapSchema.parse({
    facts: [
      firstEvidenceFact,
      {
        factId: 'fact-control-first-01',
        role: 'control',
        evidence: [
          {
            path: 'src/first.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
          },
        ],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
      {
        factId: 'fact-control-second-01',
        role: 'control',
        evidence: [
          {
            path: 'src/second.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
          },
        ],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  const firstChildMap = EvidenceMapSchema.parse({
    facts: mapWithTwoControls.facts.filter((fact) => fact.factId !== 'fact-control-second-01'),
    unansweredPlanObligations: [],
    limitations: [],
  });
  const childPosture = {
    assessments: [
      {
        obligationId: 'test-obligation-01',
        conclusion: 'inconclusive' as const,
        evidenceMapFactIds: ['fact-first-01', 'fact-control-first-01'],
        limitations: [],
      },
    ],
    limitations: [],
  };
  expect(
    verifySourcePostureFragment(vector, childPosture, firstChildMap).sourcePosture.assessments,
  ).toHaveLength(1);
  expect(
    verifySourcePosture(vector, childPosture, mapWithTwoControls).rejectedAssessmentCount,
  ).toBe(1);
});

test('downgrades an uninspected directional posture without changing its phase bindings', () => {
  const verified = verifySourcePosture(
    vector,
    {
      assessments: [
        {
          obligationId: 'test-obligation-01',
          conclusion: 'risk-supported',
          evidenceMapFactIds: ['fact-first-01'],
          limitations: [],
        },
        {
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
      obligationId: 'test-obligation-01',
      conclusion: 'inconclusive',
      evidenceMapFactIds: ['fact-first-01'],
    },
    {
      obligationId: 'test-obligation-02',
      conclusion: 'inconclusive',
      evidenceMapFactIds: ['fact-second-01'],
    },
  ]);
  expect(downgraded.limitations).toContain('source-inspection-missing');
});

test('retains only closed not-applicable reason tokens', () => {
  const firstObligation = vector.reviewObligations.at(0);
  const firstFact = evidenceMap.facts.at(0);
  if (firstObligation === undefined || firstFact === undefined) {
    throw new Error('The shared posture fixture must include its first obligation and fact.');
  }
  const result = verifySourcePosture(
    {
      ...vector,
      reviewObligations: [firstObligation],
    },
    {
      assessments: [
        {
          obligationId: 'test-obligation-01',
          conclusion: 'not-applicable',
          evidenceMapFactIds: ['fact-first-01'],
          notApplicableReason: 'no-relevant-operation-in-scope',
          limitations: ['ASSESSMENT_PROSE_SENTINEL'],
        },
      ],
      limitations: ['POSTURE_PROSE_SENTINEL'],
    },
    EvidenceMapSchema.parse({
      facts: [firstFact],
      unansweredPlanObligations: [],
      limitations: [],
    }),
  );
  expect(result.sourcePosture).toMatchObject({
    assessments: [
      {
        notApplicableReason: 'no-relevant-operation-in-scope',
        limitations: ['model-declared-limitation'],
      },
    ],
    limitations: ['model-declared-limitation'],
  });
  expect(JSON.stringify(result.sourcePosture)).not.toContain('PROSE_SENTINEL');
});
