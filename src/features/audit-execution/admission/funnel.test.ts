import { expect, test } from 'bun:test';

import {
  aggregateCandidateIntegrityRejectionLedgers,
  aggregateFindingAdmissionFunnels,
  aggregateHypothesisGroundingFunnels,
  createFindingAdmissionFunnel,
  emptyFindingAdmissionFunnel,
  emptyHypothesisGroundingFunnel,
} from './funnel.js';

test('builds and aggregates a balanced content-free finding admission funnel', () => {
  const first = createFindingAdmissionFunnel({
    modelCandidateCount: 3,
    integrityRejectedCount: 1,
    toolEvidenceRejectedCount: 0,
    verificationResults: [
      {
        decision: 'accepted',
        terminalLane: 'accepted',
      },
      {
        decision: 'rejected',
        terminalLane: 'rejected',
      },
    ],
    verifierToolEvidenceRejectedCount: 0,
    verifierReconciledCount: 1,
    admittedFindingCount: 1,
  });
  const combined = aggregateFindingAdmissionFunnels([first, emptyFindingAdmissionFunnel(), first]);
  expect(combined).toMatchObject({
    modelCandidateCount: 6,
    integrityRejectedCount: 2,
    verifierAcceptedCount: 2,
    verifierRejectedCount: 2,
    verifierReconciledCount: 2,
    admittedFindingCount: 2,
    verificationTerminalLanes: {
      accepted: 2,
      rejected: 2,
      modelIncomplete: 0,
      evidenceProjectionInvalid: 0,
      stageFailed: 0,
      inspectionMissing: 0,
      wrapperContractInvalid: 0,
    },
  });
});

test('keeps each source-free incomplete verifier lane distinct', () => {
  const funnel = createFindingAdmissionFunnel({
    modelCandidateCount: 5,
    integrityRejectedCount: 0,
    toolEvidenceRejectedCount: 0,
    verificationResults: [
      { decision: 'incomplete', terminalLane: 'model-incomplete' },
      { decision: 'incomplete', terminalLane: 'evidence-projection-invalid' },
      { decision: 'incomplete', terminalLane: 'stage-failed' },
      { decision: 'incomplete', terminalLane: 'inspection-missing' },
      { decision: 'incomplete', terminalLane: 'wrapper-contract-invalid' },
    ],
    verifierToolEvidenceRejectedCount: 0,
    verifierReconciledCount: 0,
    admittedFindingCount: 0,
  });
  expect(funnel).toMatchObject({
    verifierIncompleteCount: 5,
    verificationTerminalLanes: {
      modelIncomplete: 1,
      evidenceProjectionInvalid: 1,
      stageFailed: 1,
      inspectionMissing: 1,
      wrapperContractInvalid: 1,
    },
  });
});

test('conserves discovery validation and grounding outcomes separately', () => {
  const combined = aggregateHypothesisGroundingFunnels([
    {
      discoveredSeedCount: 3,
      discoveryBindingRejectedCount: 1,
      discoveryIntegrityRejections: {
        'model-hypothesis-invalid': 0,
        'model-seed-duplicate': 0,
        'model-vector-mismatch': 0,
        'model-plan-obligation-invalid': 0,
        'model-evidence-map-reference-invalid': 1,
        'model-source-posture-reference-invalid': 0,
      },
      groundingNullCount: 1,
      groundingBindingRejectedCount: 0,
      submittedCandidateCount: 1,
    },
    emptyHypothesisGroundingFunnel(),
  ]);
  expect(combined).toMatchObject({
    discoveredSeedCount: 3,
    discoveryBindingRejectedCount: 1,
    groundingNullCount: 1,
    submittedCandidateCount: 1,
  });
  expect(combined.discoveryIntegrityRejections['model-evidence-map-reference-invalid']).toBe(1);
});

test('aggregates only the centrally owned structural rejection categories', () => {
  const aggregate = aggregateCandidateIntegrityRejectionLedgers([
    {
      'model-hypothesis-invalid': 0,
      'model-plan-obligation-invalid': 0,
      'model-evidence-map-reference-invalid': 1,
      'model-source-posture-reference-invalid': 0,
      'model-claim-evidence-insufficient': 0,
      'model-evidence-invalid-or-out-of-scope': 0,
    },
  ]);
  expect(aggregate['model-evidence-map-reference-invalid']).toBe(1);
});
