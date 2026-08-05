import { expect, test } from 'bun:test';

import {
  AuditVerificationResultSchema,
  SourceClaimEvidenceSchema,
  UnverifiedAuditVerificationResultSchema,
} from './contract.js';

const unsafeEvidence = {
  path: 'src/reviewed.unknown',
  startLine: 1,
  contentDigest: 'a'.repeat(64),
  kind: 'source' as const,
  role: 'unsafe-condition' as const,
};

const operationEvidence = {
  path: 'src/reviewed.unknown',
  startLine: 2,
  contentDigest: 'a'.repeat(64),
  kind: 'source' as const,
  role: 'operation' as const,
};

const planObligation = { obligationId: 'verification-obligation-01' };

const acceptedCanonical = {
  decision: 'accepted' as const,
  reasonCode: 'claim-supported' as const,
  claimEvidenceBundles: [
    {
      role: 'operation' as const,
      evidence: [operationEvidence],
    },
    {
      role: 'unsafe-condition' as const,
      evidence: [unsafeEvidence],
    },
  ],
  contradictionEvidence: null,
  inspectedEvidence: [],
  verifiedPlanObligations: [planObligation],
  affectedPlanObligations: [],
  controlAssessment: {
    conclusion: 'no-effective-control-found' as const,
    evidence: [operationEvidence],
    consideredEvidenceMapFactIds: ['fact-control-01'],
  },
  obligationReconciliations: [
    {
      planObligation,
      disposition: 'supports-claim' as const,
      evidence: [operationEvidence],
    },
  ],
  postureReconciliations: [
    {
      assessmentId: 'posture-01',
      disposition: 'supports-claim' as const,
      evidence: [operationEvidence],
    },
  ],
};

test('requires complete independent bundles only for accepted decisions', () => {
  expect(AuditVerificationResultSchema.parse(acceptedCanonical)).toMatchObject({
    decision: 'accepted',
    reasonCode: 'claim-supported',
  });
  expect(() =>
    AuditVerificationResultSchema.parse({
      ...acceptedCanonical,
      claimEvidenceBundles: null,
    }),
  ).toThrow();
  expect(() =>
    AuditVerificationResultSchema.parse({
      ...acceptedCanonical,
      reason: 'MODEL_REASON_SENTINEL',
    }),
  ).toThrow();
});

test('requires contradiction evidence and reconciliations for rejected decisions', () => {
  expect(
    AuditVerificationResultSchema.parse({
      decision: 'rejected',
      reasonCode: 'effective-control',
      claimEvidenceBundles: null,
      contradictionEvidence: [{ ...operationEvidence, role: 'counterevidence' }],
      inspectedEvidence: [],
      verifiedPlanObligations: [],
      affectedPlanObligations: [planObligation],
      controlAssessment: null,
      obligationReconciliations: [
        {
          planObligation,
          disposition: 'contradicts-claim',
          evidence: [operationEvidence],
        },
      ],
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'contradicts-claim',
          evidence: [operationEvidence],
        },
      ],
    }),
  ).toMatchObject({ decision: 'rejected' });
  expect(() =>
    AuditVerificationResultSchema.parse({
      decision: 'rejected',
      reasonCode: 'claim-contradicted',
      claimEvidenceBundles: null,
      contradictionEvidence: null,
      inspectedEvidence: [],
      verifiedPlanObligations: [],
      affectedPlanObligations: [planObligation],
      controlAssessment: null,
      obligationReconciliations: [],
      postureReconciliations: [],
    }),
  ).toThrow();
});

test('permits incomplete decisions to retain only inspected non-claim evidence', () => {
  expect(
    AuditVerificationResultSchema.parse({
      decision: 'incomplete',
      reasonCode: 'context-required',
      claimEvidenceBundles: null,
      contradictionEvidence: null,
      inspectedEvidence: [{ ...operationEvidence, role: 'source' }],
      verifiedPlanObligations: [],
      affectedPlanObligations: [],
      controlAssessment: null,
      obligationReconciliations: [],
      postureReconciliations: [],
    }),
  ).toMatchObject({ decision: 'incomplete', reasonCode: 'context-required' });
});

test('canonicalizes model tokens before applying the strict decision union', () => {
  expect(
    UnverifiedAuditVerificationResultSchema.parse({
      decision: ' ACCEPTED ',
      reasonCode: ' CLAIM-SUPPORTED ',
      reason: 'Fresh scoped inspection supports the claim.',
      claimEvidenceBundles: [
        {
          role: 'operation',
          explanation: 'The operation supports the claim.',
          selections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
        },
        {
          role: 'unsafe-condition',
          explanation: 'The unsafe condition supports the claim.',
          selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No inspected control negates the claim.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations: [
        {
          planObligation,
          disposition: 'supports-claim',
          explanation: 'The source supports the approved obligation.',
          evidenceSelections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
        },
      ],
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'supports-claim',
          explanation: 'The posture aligns with the inspected source.',
          evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
    }),
  ).toMatchObject({ decision: 'accepted', reasonCode: 'claim-supported' });
});

test('allows minimal incomplete model output and rejects inactive decision fields', () => {
  expect(
    UnverifiedAuditVerificationResultSchema.parse({
      decision: 'incomplete',
      reasonCode: 'context-required',
      reason: 'The bounded source cannot establish the consequence.',
    }),
  ).toMatchObject({ decision: 'incomplete', reasonCode: 'context-required' });
  expect(() =>
    UnverifiedAuditVerificationResultSchema.parse({
      decision: 'incomplete',
      reasonCode: 'context-required',
      reason: 'The bounded source cannot establish the consequence.',
      contradictionEvidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
    }),
  ).toThrow();
});

test('accepts each decision-specific model shape and rejects cross-branch fields', () => {
  const rejected = {
    decision: 'rejected',
    reasonCode: 'effective-control',
    reason: 'The inspected control contradicts the supplied claim.',
    contradictionEvidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
    affectedPlanObligations: [planObligation],
    obligationReconciliations: [
      {
        planObligation,
        disposition: 'contradicts-claim',
        explanation: 'The selected control contradicts the approved obligation.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
    ],
    postureReconciliations: [
      {
        assessmentId: 'posture-01',
        disposition: 'contradicts-claim',
        explanation: 'The selected evidence contradicts the prior posture.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
    ],
  };
  expect(UnverifiedAuditVerificationResultSchema.parse(rejected)).toMatchObject({
    decision: 'rejected',
    reasonCode: 'effective-control',
  });
  expect(() =>
    UnverifiedAuditVerificationResultSchema.parse({
      ...rejected,
      claimEvidenceBundles: [],
    }),
  ).toThrow();
  expect(() =>
    UnverifiedAuditVerificationResultSchema.parse({
      decision: 'accepted',
      reasonCode: 'claim-supported',
      reason: 'The model selected an incomplete branch shape.',
      claimEvidenceBundles: [],
    }),
  ).toThrow();
});

test('requires a role on source evidence retained by verifier decisions', () => {
  expect(
    SourceClaimEvidenceSchema.parse({ ...operationEvidence, role: ' OPERATION ' }),
  ).toMatchObject({ role: 'operation' });
  expect(() =>
    SourceClaimEvidenceSchema.parse({
      path: 'src/reviewed.unknown',
      startLine: 2,
      contentDigest: 'a'.repeat(64),
      kind: 'source',
    }),
  ).toThrow();
});
