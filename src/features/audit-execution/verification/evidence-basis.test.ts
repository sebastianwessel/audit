import { expect, test } from 'bun:test';

import type { EvidenceMap } from '../evidence-map/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type { VerifiableHypothesis } from './contract.js';
import {
  createVerificationEvidenceSelectionBasis,
  VerificationEvidenceSelectionBasisSchema,
} from './evidence-basis.js';

const firstObligation = { obligationId: 'first-obligation-01' };
const secondObligation = { obligationId: 'second-obligation-01' };

const evidenceMap: EvidenceMap = {
  facts: [
    {
      factId: 'candidate-fact-01',
      role: 'operation',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 10,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: [firstObligation],
    },
    {
      factId: 'control-fact-01',
      role: 'control',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 20,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: [firstObligation],
    },
    {
      factId: 'other-fact-01',
      role: 'input',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 30,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: [secondObligation],
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
};

const hypothesis: VerifiableHypothesis = {
  vectorId: 'verification-vector-01',
  narrative: {
    statement: 'The reviewed operation may be reached with an unsafe condition.',
    roleExplanations: [
      { role: 'operation', explanation: 'The operation evidence identifies the reviewed action.' },
      {
        role: 'unsafe-condition',
        explanation: 'The condition evidence identifies the unsafe state.',
      },
    ],
    limitations: [],
  },
  claimEvidenceBundles: [
    {
      role: 'operation',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 10,
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
          path: 'src/reviewed.unknown',
          startLine: 10,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
          role: 'unsafe-condition',
        },
      ],
    },
  ],
  planObligations: [firstObligation],
  evidenceMapFactIds: ['candidate-fact-01'],
  claimEvidenceSelections: [
    { role: 'operation', selections: [{ factId: 'candidate-fact-01', evidenceIndex: 0 }] },
    {
      role: 'unsafe-condition',
      selections: [{ factId: 'candidate-fact-01', evidenceIndex: 0 }],
    },
  ],
  sourcePostureAssessmentIds: ['posture-first-01'],
};

const sourcePosture: SourcePosture = {
  assessments: [
    {
      assessmentId: 'posture-first-01',
      obligationId: 'first-obligation-01',
      conclusion: 'risk-supported',
      evidenceMapFactIds: ['candidate-fact-01'],
      limitations: [],
    },
    {
      assessmentId: 'posture-second-01',
      obligationId: 'second-obligation-01',
      conclusion: 'risk-supported',
      evidenceMapFactIds: ['other-fact-01'],
      limitations: [],
    },
  ],
  limitations: [],
};

test('creates one source-free, exact selection inventory for the verifier and materializer', () => {
  const basis = createVerificationEvidenceSelectionBasis({
    hypothesis,
    evidenceMap,
    sourcePosture,
  });

  expect(basis).toEqual({
    hypothesisSelections: [{ factId: 'candidate-fact-01', evidenceIndex: 0 }],
    requiredControlFactIds: ['control-fact-01'],
    controlSelections: [{ factId: 'control-fact-01', evidenceIndex: 0 }],
    obligationSelections: [
      {
        planObligation: firstObligation,
        selections: [
          { factId: 'candidate-fact-01', evidenceIndex: 0 },
          { factId: 'control-fact-01', evidenceIndex: 0 },
        ],
      },
    ],
    postureSelections: [
      {
        assessmentId: 'posture-first-01',
        selections: [{ factId: 'candidate-fact-01', evidenceIndex: 0 }],
      },
    ],
  });
  expect(JSON.stringify(basis)).not.toContain('src/reviewed.unknown');
  expect(JSON.stringify(basis)).not.toContain('operation');
});

test('keeps the evidence-selection input closed and uses canonical identifiers', () => {
  const result = VerificationEvidenceSelectionBasisSchema.safeParse({
    hypothesisSelections: [],
    requiredControlFactIds: ['not canonical'],
    controlSelections: [],
    obligationSelections: [],
    postureSelections: [],
    extra: 'not permitted',
  });

  expect(result.success).toBeFalse();
});
