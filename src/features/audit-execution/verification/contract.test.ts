import { expect, test } from 'bun:test';

import {
  AuditVerificationResultSchema,
  HypothesisEvidenceListSchema,
  SourceClaimEvidenceListSchema,
  UnverifiedAuditVerificationResultSchema,
} from './contract.js';

const unsafeEvidence = {
  path: 'src/reviewed.unknown',
  startLine: 1,
  snippet: 'request derived value',
  kind: 'source' as const,
  role: 'unsafe-condition' as const,
};

const operationEvidence = {
  path: 'src/reviewed.unknown',
  startLine: 2,
  snippet: 'security relevant operation',
  kind: 'source' as const,
  role: 'operation' as const,
};

const planObligation = { obligationId: 'verification-obligation-01' };

const obligationReconciliations = [
  {
    planObligation,
    disposition: 'supports-claim' as const,
    explanation: 'The scoped source supports the approved obligation.',
    evidence: [operationEvidence],
  },
];

const modelObligationReconciliations = [
  {
    planObligation,
    disposition: 'supports-claim' as const,
    explanation: 'The scoped source supports the approved obligation.',
    evidenceSelections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
  },
];

test('allows an investigator hypothesis to defer operation localization to verification', () => {
  expect(
    HypothesisEvidenceListSchema.parse([unsafeEvidence, { ...unsafeEvidence, startLine: 2 }]),
  ).toHaveLength(2);
  expect(() =>
    SourceClaimEvidenceListSchema.parse([unsafeEvidence, { ...unsafeEvidence, startLine: 2 }]),
  ).toThrow('security-relevant operation');
});

test('requires reconciled evidence only for accepted verification', () => {
  expect(
    AuditVerificationResultSchema.parse({
      decision: 'rejected',
      reason: 'A source-backed guard contradicts the claim.',
    }),
  ).toMatchObject({ verifiedEvidence: null });
  expect(() =>
    AuditVerificationResultSchema.parse({
      decision: 'accepted',
      reason: 'The source supports the claim.',
    }),
  ).toThrow('independently reconciled source evidence');
  expect(
    AuditVerificationResultSchema.parse({
      decision: 'accepted',
      reason: 'The source supports the claim.',
      verifiedEvidence: [operationEvidence, unsafeEvidence],
      verifiedPlanObligations: [planObligation],
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No scoped control contradicts the claim.',
        evidence: [operationEvidence],
        consideredEvidenceMapFactIds: ['fact-control-01'],
      },
      obligationReconciliations,
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'supports-claim',
          explanation: 'The posture aligns with the inspected source.',
          evidence: [operationEvidence],
        },
      ],
    }),
  ).toMatchObject({
    decision: 'accepted',
    controlAssessment: { consideredEvidenceMapFactIds: ['fact-control-01'] },
  });
});

test('canonicalizes verifier source-evidence role tokens', () => {
  expect(
    SourceClaimEvidenceListSchema.parse([
      { ...operationEvidence, role: ' OPERATION ' },
      { ...unsafeEvidence, role: ' UNSAFE-CONDITION ' },
    ]),
  ).toMatchObject([{ role: 'operation' }, { role: 'unsafe-condition' }]);
});

test('requires accepted model output to select existing map evidence without source locations', () => {
  expect(
    UnverifiedAuditVerificationResultSchema.parse({
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the claim.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No inspected control negates the claim.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations: modelObligationReconciliations,
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'supports-claim',
          explanation: 'The posture aligns with the inspected source.',
          evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
    }),
  ).toMatchObject({ decision: 'accepted' });
  expect(() =>
    UnverifiedAuditVerificationResultSchema.parse({
      decision: 'accepted',
      reason: 'Fresh scoped inspection supports the claim.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No inspected control negates the claim.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
        evidence: [operationEvidence],
      },
      obligationReconciliations: modelObligationReconciliations,
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'supports-claim',
          explanation: 'The posture aligns with the inspected source.',
          evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
    }),
  ).toThrow('Unrecognized key');
});

test('rejects an accepted model output that leaves posture unresolved', () => {
  expect(() =>
    UnverifiedAuditVerificationResultSchema.parse({
      decision: 'accepted',
      reason: 'Fresh scoped inspection is inconclusive.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No inspected control negates the claim.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations: modelObligationReconciliations,
      postureReconciliations: [
        {
          assessmentId: 'posture-01',
          disposition: 'unresolved',
          explanation: 'The bounded source cannot resolve the prior posture.',
          evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
        },
      ],
    }),
  ).toThrow('cannot leave a posture assessment unresolved');
});

test('rejects an accepted model output that leaves an approved obligation unresolved', () => {
  expect(() =>
    UnverifiedAuditVerificationResultSchema.parse({
      decision: 'accepted',
      reason: 'Fresh scoped inspection is inconclusive.',
      operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
      unsafeConditionEvidence: { factId: 'fact-input-01', evidenceIndex: 0 },
      controlAssessment: {
        conclusion: 'no-effective-control-found',
        explanation: 'No inspected control negates the claim.',
        evidenceSelections: [{ factId: 'fact-control-01', evidenceIndex: 0 }],
      },
      obligationReconciliations: [
        {
          planObligation,
          disposition: 'unresolved',
          explanation: 'The bounded source cannot resolve this approved obligation.',
          evidenceSelections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
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
  ).toThrow('cannot leave a plan obligation unresolved');
});
