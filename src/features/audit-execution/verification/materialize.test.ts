import { expect, test } from 'bun:test';

import type { EvidenceMap } from '../evidence-map/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type { UnverifiedAuditVerificationResult, VerifiableHypothesis } from './contract.js';
import { materializeVerificationResult } from './materialize.js';

const obligation = { obligationId: 'verification-obligation-01' };
const obligations = [obligation];

const evidenceMap: EvidenceMap = {
  facts: [
    {
      factId: 'fact-input-01',
      role: 'input',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: obligations,
    },
    {
      factId: 'fact-operation-01',
      role: 'operation',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 2,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: obligations,
    },
    {
      factId: 'fact-control-01',
      role: 'control',
      evidence: [
        {
          path: 'src/reviewed.unknown',
          startLine: 3,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: obligations,
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
};

const hypothesis: VerifiableHypothesis = {
  vectorId: 'vector-verification-01',
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
          startLine: 2,
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
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
          role: 'unsafe-condition',
        },
      ],
    },
  ],
  planObligations: obligations,
  evidenceMapFactIds: ['fact-input-01', 'fact-operation-01'],
  claimEvidenceSelections: [
    { role: 'operation', selections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }] },
    {
      role: 'unsafe-condition',
      selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
    },
  ],
  sourcePostureAssessmentIds: ['posture-01'],
};

const sourcePosture: SourcePosture = {
  assessments: [
    {
      assessmentId: 'posture-01',
      obligationId: 'verification-obligation-01',
      conclusion: 'risk-supported',
      evidenceMapFactIds: ['fact-input-01'],
      limitations: [],
    },
  ],
  limitations: [],
};

type AcceptedOutput = Extract<UnverifiedAuditVerificationResult, { decision: 'accepted' }>;

function acceptedOutput(overrides: Partial<Omit<AcceptedOutput, 'decision'>> = {}): AcceptedOutput {
  const output: AcceptedOutput = {
    decision: 'accepted',
    reasonCode: 'claim-supported',
    reason: 'Fresh scoped inspection supports the supplied hypothesis.',
    claimEvidenceBundles: [
      {
        role: 'operation',
        explanation: 'The operation bundle identifies the reviewed operation.',
        selections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
      },
      {
        role: 'unsafe-condition',
        explanation: 'The unsafe-condition bundle identifies the reviewed input.',
        selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
      },
    ],
    controlAssessment: {
      conclusion: 'control-insufficient',
      explanation: 'The inspected control does not constrain the claimed condition.',
      evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
    },
    obligationReconciliations: [
      {
        planObligation: obligation,
        disposition: 'supports-claim',
        explanation: 'Fresh scoped inspection supports the approved obligation.',
        evidenceSelections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
      },
    ],
    postureReconciliations: [
      {
        assessmentId: 'posture-01',
        disposition: 'supports-claim',
        explanation: 'Fresh scoped inspection supports the same claimed condition.',
        evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
      },
    ],
  };
  return { ...output, ...overrides, decision: 'accepted' };
}

test('projects complete verifier claim bundles and source-backed reconciliations', () => {
  const result = materializeVerificationResult(
    acceptedOutput(),
    hypothesis,
    evidenceMap,
    sourcePosture,
  );
  expect(result).toMatchObject({
    decision: 'accepted',
    reasonCode: 'claim-supported',
    verifiedPlanObligations: obligations,
    claimEvidenceBundles: [
      { role: 'operation', evidence: [{ startLine: 2, role: 'operation' }] },
      { role: 'unsafe-condition', evidence: [{ startLine: 1, role: 'unsafe-condition' }] },
    ],
    controlAssessment: {
      evidence: [{ startLine: 3, role: 'source' }],
      consideredEvidenceMapFactIds: ['fact-control-01'],
    },
  });
  expect(JSON.stringify(result)).not.toContain('Fresh scoped inspection');
  expect(JSON.stringify(result)).not.toContain('identifies the reviewed');
  expect(JSON.stringify(result)).not.toContain('does not constrain');
});

test('rejects an accepted claim bundle outside the hypothesis-owned map basis', () => {
  expect(
    materializeVerificationResult(
      acceptedOutput({
        claimEvidenceBundles: [
          {
            role: 'operation',
            explanation: 'Wrong basis.',
            selections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
          },
          {
            role: 'unsafe-condition',
            explanation: 'The unsafe condition is selected.',
            selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
          },
        ],
      }),
      hypothesis,
      evidenceMap,
      sourcePosture,
    ),
  ).toBeUndefined();
});

test('rejects an accepted result that drops a role-owned hypothesis selection', () => {
  expect(
    materializeVerificationResult(
      acceptedOutput({
        claimEvidenceBundles: [
          {
            role: 'operation',
            explanation: 'A different hypothesis selection is used.',
            selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
          },
          {
            role: 'unsafe-condition',
            explanation: 'The unsafe condition remains selected.',
            selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
          },
        ],
      }),
      hypothesis,
      evidenceMap,
      sourcePosture,
    ),
  ).toBeUndefined();
});

test('requires source evidence for every relevant mapped control', () => {
  expect(
    materializeVerificationResult(
      acceptedOutput({
        controlAssessment: {
          conclusion: 'control-insufficient',
          explanation: 'The control is not fully inspected.',
          evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      }),
      hypothesis,
      evidenceMap,
      sourcePosture,
    ),
  ).toBeUndefined();
});

test('requires each candidate-relevant posture assessment to have map-selected evidence', () => {
  expect(
    materializeVerificationResult(
      acceptedOutput({
        postureReconciliations: [
          {
            assessmentId: 'posture-01',
            disposition: 'supports-claim',
            explanation: 'Wrong evidence basis.',
            evidenceSelections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
          },
        ],
      }),
      hypothesis,
      evidenceMap,
      sourcePosture,
    ),
  ).toBeUndefined();
});

test('requires one reconciliation for every affected obligation', () => {
  expect(
    materializeVerificationResult(
      acceptedOutput(),
      {
        ...hypothesis,
        planObligations: [obligation, { obligationId: 'missing-obligation-01' }],
      },
      evidenceMap,
      sourcePosture,
    ),
  ).toBeUndefined();
});

test('projects a source-backed rejection with exact affected obligations', () => {
  const result = materializeVerificationResult(
    {
      decision: 'rejected',
      reasonCode: 'effective-control',
      reason: 'The source-backed control contradicts the claim.',
      contradictionEvidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      affectedPlanObligations: obligations,
      obligationReconciliations: [
        {
          planObligation: obligation,
          disposition: 'contradicts-claim',
          explanation: 'The selected control contradicts the approved risk.',
          evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
        },
      ],
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'contradicts-claim',
          explanation: 'Fresh inspection contradicts the prior posture.',
          evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
    },
    hypothesis,
    evidenceMap,
    sourcePosture,
  );
  expect(result).toMatchObject({
    decision: 'rejected',
    reasonCode: 'effective-control',
    contradictionEvidence: [{ startLine: 3, role: 'counterevidence' }],
    affectedPlanObligations: obligations,
  });
});
