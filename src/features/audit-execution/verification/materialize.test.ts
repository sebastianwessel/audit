import { expect, test } from 'bun:test';

import type { EvidenceMap } from '../evidence-map/contract.js';
import type { SourcePosture } from '../source-posture/contract.js';
import type { VerifiableHypothesis } from './contract.js';
import { materializeVerificationResult } from './materialize.js';

const obligations = [{ obligationId: 'verification-obligation-01' }];

const evidenceMap: EvidenceMap = {
  facts: [
    {
      factId: 'fact-input-01',
      role: 'input',
      statement: 'The reviewed value enters the bounded source.',
      evidence: [{ path: 'src/reviewed.unknown', startLine: 1, snippet: 'input', kind: 'source' }],
      planObligations: obligations,
    },
    {
      factId: 'fact-operation-01',
      role: 'operation',
      statement: 'The reviewed operation occurs in bounded source.',
      evidence: [
        { path: 'src/reviewed.unknown', startLine: 2, snippet: 'operation', kind: 'source' },
      ],
      planObligations: obligations,
    },
    {
      factId: 'fact-control-01',
      role: 'control',
      statement: 'The bounded source contains a potentially relevant control.',
      evidence: [
        { path: 'src/reviewed.unknown', startLine: 3, snippet: 'control', kind: 'source' },
      ],
      planObligations: obligations,
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
};

const hypothesis: VerifiableHypothesis = {
  vectorId: 'vector-verification-01',
  statement: 'Reviewed operation may process untrusted input',
  evidence: [
    {
      path: 'src/reviewed.unknown',
      startLine: 2,
      snippet: 'operation',
      kind: 'source',
      role: 'operation',
    },
    {
      path: 'src/reviewed.unknown',
      startLine: 1,
      snippet: 'input',
      kind: 'source',
      role: 'unsafe-condition',
    },
  ],
  planObligations: obligations,
  evidenceMapFactIds: ['fact-input-01', 'fact-operation-01'],
  sourcePostureAssessmentIds: ['posture-01'],
  limitations: [],
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

const postureReconciliations = [
  {
    assessmentId: 'posture-01',
    disposition: 'supports-claim' as const,
    explanation: 'Fresh scoped inspection supports the same claimed condition.',
    evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
  },
];

const obligationReconciliations = [
  {
    planObligation: { obligationId: 'verification-obligation-01' },
    disposition: 'supports-claim' as const,
    explanation: 'Fresh scoped inspection supports the approved obligation.',
    evidenceSelections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
  },
];

test('projects verifier source and control evidence from selected neutral-map facts', () => {
  const result = materializeVerificationResult(
    {
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the supplied hypothesis.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'control-insufficient',
        explanation: 'The inspected control does not constrain the claimed condition.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations,
      postureReconciliations,
    },
    hypothesis,
    evidenceMap,
    sourcePosture,
  );
  expect(result).toMatchObject({
    decision: 'accepted',
    verifiedPlanObligations: obligations,
    verifiedEvidence: [
      { path: 'src/reviewed.unknown', startLine: 2, role: 'operation' },
      { path: 'src/reviewed.unknown', startLine: 1, role: 'unsafe-condition' },
    ],
    controlAssessment: {
      evidence: [{ path: 'src/reviewed.unknown', startLine: 3, role: 'source' }],
      consideredEvidenceMapFactIds: ['fact-control-01'],
    },
    obligationReconciliations: [
      {
        planObligation: obligations[0],
        disposition: 'supports-claim',
        evidence: [{ path: 'src/reviewed.unknown', startLine: 2, role: 'source' }],
      },
    ],
    postureReconciliations: [
      {
        assessmentId: 'posture-01',
        disposition: 'supports-claim',
        evidence: [{ path: 'src/reviewed.unknown', startLine: 1, role: 'source' }],
      },
    ],
  });
});

test('rejects an operation selection outside the candidate map basis', () => {
  const result = materializeVerificationResult(
    {
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the supplied hypothesis.',
      operationEvidence: { factId: 'fact-control-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'control-insufficient',
        explanation: 'The inspected control does not constrain the claimed condition.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations,
      postureReconciliations,
    },
    hypothesis,
    evidenceMap,
    sourcePosture,
  );
  expect(result).toBeUndefined();
});

test('requires source evidence for every relevant mapped control', () => {
  const result = materializeVerificationResult(
    {
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the supplied hypothesis.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'control-insufficient',
        explanation: 'The inspected control does not constrain the claimed condition.',
        evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
      },
      obligationReconciliations,
      postureReconciliations,
    },
    hypothesis,
    evidenceMap,
    sourcePosture,
  );
  expect(result).toBeUndefined();
});

test('requires each candidate-relevant posture assessment to have map-selected evidence', () => {
  const result = materializeVerificationResult(
    {
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the supplied hypothesis.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'control-insufficient',
        explanation: 'The inspected control does not constrain the claimed condition.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations,
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'supports-claim',
          explanation: 'Fresh scoped inspection supports the same claimed condition.',
          evidenceSelections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
        },
      ],
    },
    hypothesis,
    evidenceMap,
    sourcePosture,
  );
  expect(result).toBeUndefined();
});

test('requires exactly one map-bound reconciliation for every hypothesis obligation', () => {
  const result = materializeVerificationResult(
    {
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the supplied hypothesis.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'control-insufficient',
        explanation: 'The inspected control does not constrain the claimed condition.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations,
      postureReconciliations,
    },
    {
      ...hypothesis,
      planObligations: [
        { obligationId: 'verification-obligation-01' },
        { obligationId: 'missing-obligation-01' },
      ],
    },
    evidenceMap,
    sourcePosture,
  );
  expect(result).toBeUndefined();
});

test('rejects a reconciliation selection that is not bound to its exact obligation', () => {
  const result = materializeVerificationResult(
    {
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the supplied hypothesis.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'control-insufficient',
        explanation: 'The inspected control does not constrain the claimed condition.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations: [
        {
          planObligation: { obligationId: 'verification-obligation-01' },
          disposition: 'supports-claim',
          explanation: 'The selected evidence supports this obligation.',
          evidenceSelections: [{ factId: 'fact-unbound-01', evidenceIndex: 0 }],
        },
      ],
      postureReconciliations,
    },
    hypothesis,
    {
      ...evidenceMap,
      facts: [
        ...evidenceMap.facts,
        {
          factId: 'fact-unbound-01',
          role: 'assumption',
          statement: 'This fact is outside the approved obligation.',
          evidence: [
            { path: 'src/reviewed.unknown', startLine: 3, snippet: 'other', kind: 'source' },
          ],
          planObligations: [{ obligationId: 'different-obligation-01' }],
        },
      ],
    },
    sourcePosture,
  );
  expect(result).toBeUndefined();
});
