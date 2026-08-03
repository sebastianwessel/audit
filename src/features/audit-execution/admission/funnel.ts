import {
  type CandidateIntegrityRejectionLedger,
  CandidateIntegrityRejectionLedgerSchema,
  type DiscoveryIntegrityRejectionLedger,
  DiscoveryIntegrityRejectionLedgerSchema,
  type FindingAdmissionFunnel,
  FindingAdmissionFunnelSchema,
  type HypothesisGroundingFunnel,
  HypothesisGroundingFunnelSchema,
} from '../audit.schema.js';
import {
  CandidateStructuralRejectionReasonSchema,
  HypothesisSeedStructuralRejectionReasonSchema,
} from '../investigation/contract.js';
import {
  type AuditVerificationResult,
  aggregateVerificationTerminalLaneCounts,
  countVerificationTerminalLanes,
  emptyVerificationTerminalLaneCounts,
  type VerificationTerminalLane,
} from '../verification/contract.js';

export function emptyFindingAdmissionFunnel(): FindingAdmissionFunnel {
  return FindingAdmissionFunnelSchema.parse({
    modelCandidateCount: 0,
    integrityRejectedCount: 0,
    toolEvidenceRejectedCount: 0,
    verifierAcceptedCount: 0,
    verifierRejectedCount: 0,
    verifierIncompleteCount: 0,
    verifierToolEvidenceRejectedCount: 0,
    verifierEvidenceRejectedCount: 0,
    verifierReconciledCount: 0,
    postVerificationRejectedCount: 0,
    admittedFindingCount: 0,
    verificationTerminalLanes: emptyVerificationTerminalLaneCounts(),
  });
}

export function emptyHypothesisGroundingFunnel(): HypothesisGroundingFunnel {
  return HypothesisGroundingFunnelSchema.parse({
    discoveredSeedCount: 0,
    discoveryBindingRejectedCount: 0,
    discoveryIntegrityRejections: DiscoveryIntegrityRejectionLedgerSchema.parse(
      Object.fromEntries(
        HypothesisSeedStructuralRejectionReasonSchema.options.map((reason) => [reason, 0]),
      ),
    ),
    groundingNullCount: 0,
    groundingBindingRejectedCount: 0,
    submittedCandidateCount: 0,
  });
}

/** Creates the complete zero ledger for a vector that did not reach candidate validation. */
export function emptyCandidateIntegrityRejectionLedger(): CandidateIntegrityRejectionLedger {
  return CandidateIntegrityRejectionLedgerSchema.parse(
    Object.fromEntries(
      CandidateStructuralRejectionReasonSchema.options.map((reason) => [reason, 0]),
    ),
  );
}

export function aggregateCandidateIntegrityRejectionLedgers(
  ledgers: readonly CandidateIntegrityRejectionLedger[],
): CandidateIntegrityRejectionLedger {
  return ledgers.reduce(
    (aggregate, ledger) =>
      CandidateIntegrityRejectionLedgerSchema.parse(
        Object.fromEntries(
          CandidateStructuralRejectionReasonSchema.options.map((reason) => [
            reason,
            aggregate[reason] + ledger[reason],
          ]),
        ),
      ),
    emptyCandidateIntegrityRejectionLedger(),
  );
}

export function aggregateDiscoveryIntegrityRejectionLedgers(
  ledgers: readonly DiscoveryIntegrityRejectionLedger[],
): DiscoveryIntegrityRejectionLedger {
  return ledgers.reduce(
    (aggregate, ledger) =>
      DiscoveryIntegrityRejectionLedgerSchema.parse(
        Object.fromEntries(
          HypothesisSeedStructuralRejectionReasonSchema.options.map((reason) => [
            reason,
            aggregate[reason] + ledger[reason],
          ]),
        ),
      ),
    DiscoveryIntegrityRejectionLedgerSchema.parse(
      Object.fromEntries(
        HypothesisSeedStructuralRejectionReasonSchema.options.map((reason) => [reason, 0]),
      ),
    ),
  );
}

/** Creates a balanced numeric ledger after an investigator and verifier have completed. */
export function createFindingAdmissionFunnel(input: {
  modelCandidateCount: number;
  integrityRejectedCount: number;
  toolEvidenceRejectedCount: number;
  verificationResults: readonly (Pick<AuditVerificationResult, 'decision'> & {
    terminalLane: VerificationTerminalLane;
  })[];
  verifierToolEvidenceRejectedCount: number;
  verifierReconciledCount: number;
  admittedFindingCount: number;
}): FindingAdmissionFunnel {
  const verifierAcceptedCount = input.verificationResults.filter(
    (result) => result.decision === 'accepted',
  ).length;
  const verifierRejectedCount = input.verificationResults.filter(
    (result) => result.decision === 'rejected',
  ).length;
  const verifierIncompleteCount = input.verificationResults.filter(
    (result) => result.decision === 'incomplete',
  ).length;
  return FindingAdmissionFunnelSchema.parse({
    modelCandidateCount: input.modelCandidateCount,
    integrityRejectedCount: input.integrityRejectedCount,
    toolEvidenceRejectedCount: input.toolEvidenceRejectedCount,
    verifierAcceptedCount,
    verifierRejectedCount,
    verifierIncompleteCount,
    verifierToolEvidenceRejectedCount: input.verifierToolEvidenceRejectedCount,
    verifierEvidenceRejectedCount:
      verifierAcceptedCount -
      input.verifierToolEvidenceRejectedCount -
      input.verifierReconciledCount,
    verifierReconciledCount: input.verifierReconciledCount,
    postVerificationRejectedCount: input.verifierReconciledCount - input.admittedFindingCount,
    admittedFindingCount: input.admittedFindingCount,
    verificationTerminalLanes: countVerificationTerminalLanes(
      input.verificationResults.map((result) => result.terminalLane),
    ),
  });
}

/** Adds already-validated funnels without duplicating their accounting rules. */
export function aggregateFindingAdmissionFunnels(
  funnels: readonly FindingAdmissionFunnel[],
): FindingAdmissionFunnel {
  return funnels.reduce(
    (aggregate, funnel) =>
      FindingAdmissionFunnelSchema.parse({
        modelCandidateCount: aggregate.modelCandidateCount + funnel.modelCandidateCount,
        integrityRejectedCount: aggregate.integrityRejectedCount + funnel.integrityRejectedCount,
        toolEvidenceRejectedCount:
          aggregate.toolEvidenceRejectedCount + funnel.toolEvidenceRejectedCount,
        verifierAcceptedCount: aggregate.verifierAcceptedCount + funnel.verifierAcceptedCount,
        verifierRejectedCount: aggregate.verifierRejectedCount + funnel.verifierRejectedCount,
        verifierIncompleteCount: aggregate.verifierIncompleteCount + funnel.verifierIncompleteCount,
        verifierToolEvidenceRejectedCount:
          aggregate.verifierToolEvidenceRejectedCount + funnel.verifierToolEvidenceRejectedCount,
        verifierEvidenceRejectedCount:
          aggregate.verifierEvidenceRejectedCount + funnel.verifierEvidenceRejectedCount,
        verifierReconciledCount: aggregate.verifierReconciledCount + funnel.verifierReconciledCount,
        postVerificationRejectedCount:
          aggregate.postVerificationRejectedCount + funnel.postVerificationRejectedCount,
        admittedFindingCount: aggregate.admittedFindingCount + funnel.admittedFindingCount,
        verificationTerminalLanes: aggregateVerificationTerminalLaneCounts([
          aggregate.verificationTerminalLanes,
          funnel.verificationTerminalLanes,
        ]),
      }),
    emptyFindingAdmissionFunnel(),
  );
}

/** Adds source-free discovery-to-grounding terminal ledgers across vectors or trials. */
export function aggregateHypothesisGroundingFunnels(
  funnels: readonly HypothesisGroundingFunnel[],
): HypothesisGroundingFunnel {
  return funnels.reduce(
    (aggregate, funnel) =>
      HypothesisGroundingFunnelSchema.parse({
        discoveredSeedCount: aggregate.discoveredSeedCount + funnel.discoveredSeedCount,
        discoveryBindingRejectedCount:
          aggregate.discoveryBindingRejectedCount + funnel.discoveryBindingRejectedCount,
        discoveryIntegrityRejections: aggregateDiscoveryIntegrityRejectionLedgers([
          aggregate.discoveryIntegrityRejections,
          funnel.discoveryIntegrityRejections,
        ]),
        groundingNullCount: aggregate.groundingNullCount + funnel.groundingNullCount,
        groundingBindingRejectedCount:
          aggregate.groundingBindingRejectedCount + funnel.groundingBindingRejectedCount,
        submittedCandidateCount: aggregate.submittedCandidateCount + funnel.submittedCandidateCount,
      }),
    emptyHypothesisGroundingFunnel(),
  );
}
