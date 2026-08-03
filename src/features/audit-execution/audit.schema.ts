import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from '../../shared/contracts/core.js';
import { ProposedFindingSchema } from '../attack-planning/plan.schema.js';
import {
  ModelCostCeilingStateSchema,
  ModelRunObservationSchema,
  ModelStageIdSchema,
  ModelStageObservationSchema,
} from '../model-operations/model-operations.schema.js';
import { CanonicalCandidateGroundingOutputSchema } from './candidate-grounding/contract.js';
import { ObligationClosureMatrixSchema } from './coverage-closure/contract.js';
import { EvidenceMapSchema } from './evidence-map/contract.js';
import {
  CandidateStructuralRejectionReasonSchema,
  HypothesisSeedStructuralRejectionReasonSchema,
  InvestigationObligationClosuresSchema,
} from './investigation/contract.js';
import { AuditInvestigationRequestSchema, SourceDocumentSchema } from './phase-input/contract.js';
import { SourcePostureSchema } from './source-posture/contract.js';
import type { AuditVerificationRequestSchema } from './verification/contract.js';
import {
  PersistedAuditVerificationResultSchema,
  VerifiableHypothesisSchema,
  VerificationTerminalLaneCountsSchema,
  VerificationTerminalLaneSchema,
} from './verification/contract.js';

export type {
  AuditInvestigationRequest,
  SourceDocument,
} from './phase-input/contract.js';
export { AuditInvestigationRequestSchema, SourceDocumentSchema };

export const MaxParallelVectorsSchema = z.number().int().min(1).max(8);

/** Content-free accounting of how a vector's model hypotheses reached a terminal outcome. */
export const FindingAdmissionFunnelSchema = z
  .strictObject({
    modelCandidateCount: z.number().int().nonnegative(),
    integrityRejectedCount: z.number().int().nonnegative(),
    toolEvidenceRejectedCount: z.number().int().nonnegative(),
    verifierAcceptedCount: z.number().int().nonnegative(),
    verifierRejectedCount: z.number().int().nonnegative(),
    verifierIncompleteCount: z.number().int().nonnegative(),
    verifierToolEvidenceRejectedCount: z.number().int().nonnegative(),
    verifierEvidenceRejectedCount: z.number().int().nonnegative(),
    verifierReconciledCount: z.number().int().nonnegative(),
    postVerificationRejectedCount: z.number().int().nonnegative(),
    admittedFindingCount: z.number().int().nonnegative(),
    /** Closed source-free diagnostic lanes for candidate-aware terminal attempts. */
    verificationTerminalLanes: VerificationTerminalLaneCountsSchema,
  })
  .superRefine((value, context) => {
    if (
      value.modelCandidateCount !==
      value.integrityRejectedCount +
        value.toolEvidenceRejectedCount +
        value.verifierAcceptedCount +
        value.verifierRejectedCount +
        value.verifierIncompleteCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modelCandidateCount'],
        message: 'Model candidates must equal their terminal investigation or verifier outcomes.',
      });
    }
    if (
      value.verifierAcceptedCount !==
      value.verifierToolEvidenceRejectedCount +
        value.verifierEvidenceRejectedCount +
        value.verifierReconciledCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['verifierAcceptedCount'],
        message:
          'Accepted verifier results must be reconciled or rejected by tool or evidence integrity.',
      });
    }
    if (
      value.verifierReconciledCount !==
      value.postVerificationRejectedCount + value.admittedFindingCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['verifierReconciledCount'],
        message:
          'Reconciled verifier results must be admitted or rejected by a post-verification phase.',
      });
    }
    const lanes = value.verificationTerminalLanes;
    if (
      lanes.accepted !== value.verifierAcceptedCount ||
      lanes.rejected !== value.verifierRejectedCount ||
      lanes.modelIncomplete +
        lanes.evidenceProjectionInvalid +
        lanes.stageFailed +
        lanes.inspectionMissing +
        lanes.wrapperContractInvalid !==
        value.verifierIncompleteCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['verificationTerminalLanes'],
        message:
          'Candidate-aware terminal lanes must reconcile to the verifier accepted, rejected, and incomplete counts.',
      });
    }
  });

/** Source-free attrition between non-reportable discovery and canonical grounding. */
export const HypothesisGroundingFunnelSchema = z
  .strictObject({
    discoveredSeedCount: z.number().int().nonnegative(),
    discoveryBindingRejectedCount: z.number().int().nonnegative(),
    discoveryIntegrityRejections: z.record(
      HypothesisSeedStructuralRejectionReasonSchema,
      z.number().int().nonnegative(),
    ),
    groundingNullCount: z.number().int().nonnegative(),
    groundingBindingRejectedCount: z.number().int().nonnegative(),
    submittedCandidateCount: z.number().int().nonnegative(),
  })
  .superRefine((value, context) => {
    if (
      value.discoveredSeedCount !==
      value.discoveryBindingRejectedCount +
        value.groundingNullCount +
        value.groundingBindingRejectedCount +
        value.submittedCandidateCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['discoveredSeedCount'],
        message: 'Discovery seeds must equal validation and terminal grounding outcomes.',
      });
    }
  });

/** Source-free counts for canonical candidate rejection categories. */
export const CandidateIntegrityRejectionLedgerSchema = z.record(
  CandidateStructuralRejectionReasonSchema,
  z.number().int().nonnegative(),
);

/** Source-free categories for discovery seeds rejected before grounding. */
export const DiscoveryIntegrityRejectionLedgerSchema = z.record(
  HypothesisSeedStructuralRejectionReasonSchema,
  z.number().int().nonnegative(),
);

export const VectorCoverageSchema = z
  .strictObject({
    vectorId: IdentifierSchema,
    planned: z.boolean(),
    completed: z.boolean(),
    matchedSourcePaths: z.number().int().nonnegative(),
    deterministicCandidateCount: z.number().int().nonnegative(),
    evidenceMapFactCount: z.number().int().nonnegative(),
    evidenceMapUnansweredObligationCount: z.number().int().nonnegative(),
    sourcePostureAssessmentCount: z.number().int().nonnegative(),
    sourcePostureSupportedCount: z.number().int().nonnegative(),
    sourcePostureContradictedCount: z.number().int().nonnegative(),
    sourcePostureInconclusiveCount: z.number().int().nonnegative(),
    sourcePostureNotApplicableCount: z.number().int().nonnegative().optional(),
    findingCount: z.number().int().nonnegative(),
    reviewRequiredCount: z.number().int().nonnegative().optional(),
    outcome: z.enum([
      'completed',
      'not-applicable',
      'incomplete',
      'skipped',
      'failed',
      'cancelled',
    ]),
    errorCode: z.string().trim().min(1).max(64).nullable(),
    limitations: z.array(BoundedTextSchema.min(1)),
    /** Source-free terminal accounting for every plan-owned review obligation. */
    obligationClosure: ObligationClosureMatrixSchema,
    admissionFunnel: FindingAdmissionFunnelSchema.optional(),
    hypothesisGroundingFunnel: HypothesisGroundingFunnelSchema.optional(),
    /** Per-reason integrity loss; no candidate content or model text is retained. */
    candidateIntegrityRejections: CandidateIntegrityRejectionLedgerSchema.optional(),
    evidenceMapObservation: ModelStageObservationSchema.optional(),
    sourcePostureObservation: ModelStageObservationSchema.optional(),
    modelObservation: ModelStageObservationSchema.optional(),
    candidateGroundingObservation: ModelStageObservationSchema.optional(),
    verificationObservations: z.array(ModelStageObservationSchema).optional(),
    countercheckObservations: z.array(ModelStageObservationSchema).optional(),
  })
  .superRefine((coverage, context) => {
    const closures = coverage.obligationClosure;
    const closureFactCount = closures.reduce(
      (total, closure) => total + closure.evidenceMapFactCount,
      0,
    );
    const maximumClosureFactCount = Math.max(
      ...closures.map((closure) => closure.evidenceMapFactCount),
    );
    if (
      coverage.evidenceMapFactCount < maximumClosureFactCount ||
      coverage.evidenceMapFactCount > closureFactCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceMapFactCount'],
        message: 'Evidence-map facts must be conserved by the obligation-closure rows.',
      });
    }
    const unansweredCount = closures.filter((closure) => closure.mapState === 'unanswered').length;
    if (coverage.evidenceMapUnansweredObligationCount !== unansweredCount) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceMapUnansweredObligationCount'],
        message: 'Unanswered evidence-map obligations must equal their closure rows.',
      });
    }
    const postureCounts = {
      total: closures.filter((closure) => closure.sourcePostureConclusion !== null).length,
      supported: closures.filter((closure) => closure.sourcePostureConclusion === 'risk-supported')
        .length,
      contradicted: closures.filter(
        (closure) => closure.sourcePostureConclusion === 'risk-contradicted',
      ).length,
      inconclusive: closures.filter((closure) => closure.sourcePostureConclusion === 'inconclusive')
        .length,
      notApplicable: closures.filter(
        (closure) => closure.sourcePostureConclusion === 'not-applicable',
      ).length,
    };
    if (
      coverage.sourcePostureAssessmentCount !== postureCounts.total ||
      coverage.sourcePostureSupportedCount !== postureCounts.supported ||
      coverage.sourcePostureContradictedCount !== postureCounts.contradicted ||
      coverage.sourcePostureInconclusiveCount !== postureCounts.inconclusive ||
      (coverage.sourcePostureNotApplicableCount ?? 0) !== postureCounts.notApplicable
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourcePostureAssessmentCount'],
        message: 'Source-posture counters must equal the obligation-closure rows.',
      });
    }
    const admittedFindingCount = closures.reduce(
      (total, closure) => total + closure.admittedFindingCount,
      0,
    );
    if (coverage.findingCount > admittedFindingCount) {
      context.addIssue({
        code: 'custom',
        path: ['findingCount'],
        message: 'Reported findings must be represented by admitted obligation closures.',
      });
    }
    if (
      coverage.admissionFunnel?.admittedFindingCount !== undefined &&
      coverage.findingCount !== coverage.admissionFunnel.admittedFindingCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['findingCount'],
        message: 'Reported findings must equal the admission-funnel finding count.',
      });
    }
    const successfulOutcome =
      coverage.outcome === 'completed' ||
      coverage.outcome === 'not-applicable' ||
      coverage.outcome === 'skipped';
    if (coverage.completed !== successfulOutcome) {
      context.addIssue({
        code: 'custom',
        path: ['completed'],
        message:
          'Only completed, not-applicable, and intentionally skipped outcomes may mark coverage complete.',
      });
    }
    if (successfulOutcome && coverage.errorCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Completed coverage cannot retain an error code.',
      });
    }
    if (
      coverage.outcome === 'not-applicable' &&
      closures.some((closure) => closure.terminalDisposition !== 'not-applicable')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outcome'],
        message: 'A not-applicable vector requires every obligation to be not-applicable.',
      });
    }
  });

export const AuditErrorSchema = z.strictObject({
  code: z.string().trim().min(1).max(64),
  stage: z.enum([
    'inventory',
    'planning',
    'evidence-mapping',
    'source-posture',
    'investigation',
    'candidate-grounding',
    'verification',
    'countercheck',
    'synthesis',
    'audit',
    'report',
    'provider',
  ]),
  message: z.string().trim().min(1).max(320),
  retryable: z.boolean(),
});

/** Completed vector work is checkpointable only after verification and redaction. */
export const AuditVectorResultSchema = z
  .strictObject({
    coverage: VectorCoverageSchema,
    errors: z.array(AuditErrorSchema),
    proposed: z.array(ProposedFindingSchema),
    reviewRequired: z.array(ProposedFindingSchema),
  })
  .superRefine((result, context) => {
    if (result.coverage.findingCount !== result.proposed.length) {
      context.addIssue({
        code: 'custom',
        path: ['coverage', 'findingCount'],
        message: 'Coverage finding count must equal the persisted proposed findings.',
      });
    }
    if ((result.coverage.reviewRequiredCount ?? 0) !== result.reviewRequired.length) {
      context.addIssue({
        code: 'custom',
        path: ['coverage', 'reviewRequiredCount'],
        message: 'Coverage review-required count must equal the persisted review queue.',
      });
    }
    for (const [index, finding] of [...result.proposed, ...result.reviewRequired].entries()) {
      if (finding.vectorId === result.coverage.vectorId) continue;
      context.addIssue({
        code: 'custom',
        path: ['proposed', index, 'vectorId'],
        message: 'A vector result may retain only findings from its own vector.',
      });
    }
  });

/** The immutable identity a checkpoint must match before it can be reused. */
export const AuditCheckpointBindingSchema = z.strictObject({
  runId: IdentifierSchema,
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
  provider: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(160),
  verificationRouteFingerprint: Sha256Schema,
  evidenceMapProtocolFingerprint: Sha256Schema,
  reviewWorkflowProtocolFingerprint: Sha256Schema,
  vectorId: IdentifierSchema,
  vectorDigest: Sha256Schema,
});

/** Source-free lifecycle state for one deterministic context-overflow scope. */
export const ContextOverflowTopologyStateSchema = z.enum([
  'pending',
  'running',
  'overflowed',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * An opaque scope identity; source paths, ranges, context bodies, and their
 * digests remain in the retained snapshot and never enter this ledger.
 */
export const ContextOverflowTopologyEventSchema = z
  .strictObject({
    ordinal: z.number().int().positive(),
    childKey: z.string().regex(/^root(?:\/(?:left|right))*$/u),
    attempt: z.number().int().positive(),
    scopeFingerprint: Sha256Schema,
    state: ContextOverflowTopologyStateSchema,
    errorCode: z.string().trim().min(1).max(64).nullable(),
    modelObservation: ModelStageObservationSchema.optional(),
    savedAt: IsoDateTimeSchema,
  })
  .superRefine((event, context) => {
    if (event.state === 'overflowed' && event.errorCode !== 'provider-context-overflow') {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'An overflowed scope must retain the normalized overflow code.',
      });
    }
    if (
      (event.state === 'pending' || event.state === 'running' || event.state === 'completed') &&
      event.errorCode !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'A non-error scope state cannot retain an error code.',
      });
    }
    if ((event.state === 'failed' || event.state === 'cancelled') && event.errorCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'A failed or cancelled scope must retain a stable error code.',
      });
    }
  });

/**
 * Durable deterministic topology only. It never caches child model output,
 * which remains reusable exclusively through feature-owned validated drafts.
 */
export const AuditContextOverflowLedgerSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(1),
  phase: z.enum(['evidence-mapping', 'source-posture', 'investigation', 'candidate-grounding']),
  parentStageId: ModelStageIdSchema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  events: z.array(ContextOverflowTopologyEventSchema),
}).superRefine((ledger, context) => {
  const previousStateByAttempt = new Map<
    string,
    z.infer<typeof ContextOverflowTopologyStateSchema>
  >();
  for (const [index, event] of ledger.events.entries()) {
    if (event.ordinal !== index + 1) {
      context.addIssue({
        code: 'custom',
        path: ['events', index, 'ordinal'],
        message: 'Context-overflow event ordinals must be contiguous from one.',
      });
    }
    const attemptKey = `${event.childKey}\0${event.attempt}`;
    const previous = previousStateByAttempt.get(attemptKey);
    if (previous !== undefined && !validContextOverflowTransition(previous, event.state)) {
      context.addIssue({
        code: 'custom',
        path: ['events', index, 'state'],
        message: 'Context-overflow state transition is invalid.',
      });
    }
    previousStateByAttempt.set(attemptKey, event.state);
  }
});

/**
 * A phase-owned replacement for raw child model output. The map has already
 * passed source-location, obligation, and redaction validation for this exact
 * recovery scope before it can be written.
 */
export const AuditEvidenceMapRecoveryLeafSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(1),
  phase: z.literal('evidence-mapping'),
  parentStageId: ModelStageIdSchema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  childKey: z.string().regex(/^root(?:\/(?:left|right))*$/u),
  scopeFingerprint: Sha256Schema,
  evidenceMap: EvidenceMapSchema,
  savedAt: IsoDateTimeSchema,
});

/** Validated candidate-blind posture fragment for one exact recovered scope. */
export const AuditSourcePostureRecoveryLeafSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(1),
  phase: z.literal('source-posture'),
  parentStageId: ModelStageIdSchema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  childKey: z.string().regex(/^root(?:\/(?:left|right))*$/u),
  scopeFingerprint: Sha256Schema,
  sourcePosture: SourcePostureSchema,
  savedAt: IsoDateTimeSchema,
});

/** Canonical grounding outcomes for one exact recovered scope; raw outputs never persist. */
export const AuditCandidateGroundingRecoveryLeafSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(1),
  phase: z.literal('candidate-grounding'),
  parentStageId: ModelStageIdSchema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  childKey: z.string().regex(/^root(?:\/(?:left|right))*$/u),
  scopeFingerprint: Sha256Schema,
  groundings: CanonicalCandidateGroundingOutputSchema,
  savedAt: IsoDateTimeSchema,
});

function validContextOverflowTransition(
  previous: z.infer<typeof ContextOverflowTopologyStateSchema>,
  next: z.infer<typeof ContextOverflowTopologyStateSchema>,
): boolean {
  if (previous === 'pending') return next === 'running';
  if (previous === 'running') {
    return (
      next === 'overflowed' || next === 'completed' || next === 'failed' || next === 'cancelled'
    );
  }
  return false;
}

export const AuditVectorCheckpointSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(13),
  savedAt: IsoDateTimeSchema,
  result: AuditVectorResultSchema,
}).superRefine((value, context) => {
  if (value.vectorId !== value.result.coverage.vectorId) {
    context.addIssue({
      code: 'custom',
      path: ['result', 'coverage', 'vectorId'],
      message: 'Checkpoint vectorId must match result coverage vectorId.',
    });
  }
});

/** A grounded, canonical candidate set reusable for verifier retry. Discovery seeds are never persisted. */
export const AuditCandidateGroundingDraftSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(4),
  phase: z.literal('candidate-grounding'),
  candidateGroundingProtocolFingerprint: Sha256Schema,
  savedAt: IsoDateTimeSchema,
  findings: z.array(VerifiableHypothesisSchema),
  closures: InvestigationObligationClosuresSchema,
  hypothesisGroundingFunnel: HypothesisGroundingFunnelSchema,
  candidateIntegrityRejections: CandidateIntegrityRejectionLedgerSchema,
  discoveryObservation: ModelStageObservationSchema.optional(),
  modelObservation: ModelStageObservationSchema.optional(),
});

/** A redacted, terminal candidate-aware decision. Raw model rationale is never checkpointed. */
export const PersistedCandidateAwareResultSchema = PersistedAuditVerificationResultSchema.extend({
  terminalLane: VerificationTerminalLaneSchema,
  modelObservation: ModelStageObservationSchema.optional(),
});

/**
 * One durable unit of verifier or countercheck work. The candidate digest binds
 * reuse to the exact canonical input without retaining a second candidate copy.
 */
export const AuditCandidateAwareCheckpointSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(1),
  phase: z.enum(['verification', 'countercheck']),
  candidateGroundingProtocolFingerprint: Sha256Schema,
  candidateOrdinal: z.number().int().min(1),
  candidateFingerprint: Sha256Schema,
  state: z.enum(['pending', 'running', 'completed']),
  savedAt: IsoDateTimeSchema,
  result: PersistedCandidateAwareResultSchema.optional(),
}).superRefine((value, context) => {
  if (value.state === 'completed' && value.result === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: 'Completed candidate-aware work requires its canonical terminal result.',
    });
  }
  if (value.state !== 'completed' && value.result !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['result'],
      message: 'Only completed candidate-aware work may retain a terminal result.',
    });
  }
});

/** A validated map can be reused for an interrupted investigation or verification. */
export const AuditEvidenceMapDraftSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(1),
  phase: z.literal('evidence-mapping'),
  savedAt: IsoDateTimeSchema,
  evidenceMap: EvidenceMapSchema,
  modelObservation: ModelStageObservationSchema.optional(),
});

/** A validated candidate-blind posture can be reused only by later phases. */
export const AuditSourcePostureDraftSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(1),
  phase: z.literal('source-posture'),
  savedAt: IsoDateTimeSchema,
  sourcePosture: SourcePostureSchema,
  modelObservation: ModelStageObservationSchema.optional(),
});

export const FindingVerificationSchema = z.strictObject({
  status: z.enum(['verified', 'insufficient-evidence', 'rejected']),
  reason: BoundedTextSchema.min(1).max(2_000),
  checks: z
    .array(
      z.enum([
        'approved-obligation',
        'scope',
        'source-path',
        'line-range',
        'source-snippet',
        'claim-evidence-roles',
      ]),
    )
    .min(1)
    .max(8),
});

export const FindingSchema = ProposedFindingSchema.extend({
  findingId: IdentifierSchema,
  status: z.enum(['needs-review', 'accepted']),
  verification: FindingVerificationSchema,
});

export const AuditRunManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  runId: IdentifierSchema,
  command: z.enum(['plan', 'audit', 'report']),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  targetFingerprint: Sha256Schema,
  planId: IdentifierSchema.nullable(),
  provider: z.string().trim().min(1).max(64).nullable(),
  model: z.string().trim().min(1).max(160).nullable(),
  outcome: z.enum(['completed', 'partial', 'failed', 'cancelled']),
  counters: z.strictObject({
    plannedVectors: z.number().int().nonnegative(),
    completedVectors: z.number().int().nonnegative(),
    failedVectors: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
  }),
  modelObservation: ModelRunObservationSchema.optional(),
  modelCostCeilingState: ModelCostCeilingStateSchema.optional(),
});

/** Content-free lifecycle record for the exclusive audit owner. */
export const AuditRunAttemptSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: IdentifierSchema,
    planId: IdentifierSchema,
    planDigest: Sha256Schema,
    targetFingerprint: Sha256Schema,
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema.nullable(),
    status: z.enum(['starting', 'completed', 'partial', 'failed', 'cancelled']),
  })
  .superRefine((value, context) => {
    const terminal = value.status !== 'starting';
    if ((value.finishedAt !== null) !== terminal) {
      context.addIssue({
        code: 'custom',
        path: ['finishedAt'],
        message: 'Only a terminal audit attempt may have a completion timestamp.',
      });
    }
  });

export const AuditReportSchema = z
  .strictObject({
    schemaVersion: z.literal(15),
    reportId: IdentifierSchema,
    runId: IdentifierSchema,
    planId: IdentifierSchema,
    targetFingerprint: Sha256Schema,
    generatedAt: IsoDateTimeSchema,
    coverage: z.array(VectorCoverageSchema).min(1),
    findings: z.array(FindingSchema),
    reviewRequired: z.array(FindingSchema),
    errors: z.array(AuditErrorSchema),
  })
  .superRefine((report, context) => {
    const vectorIds = report.coverage.map((coverage) => coverage.vectorId);
    if (new Set(vectorIds).size !== vectorIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'Audit report coverage vector identifiers must be unique.',
      });
    }
    const findingIds = report.findings.map((finding) => finding.findingId);
    if (new Set(findingIds).size !== findingIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'Audit report finding identifiers must be unique.',
      });
    }
    const reviewRequiredIds = report.reviewRequired.map((finding) => finding.findingId);
    if (new Set(reviewRequiredIds).size !== reviewRequiredIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['reviewRequired'],
        message: 'Review-required finding identifiers must be unique.',
      });
    }
    if (reviewRequiredIds.some((findingId) => findingIds.includes(findingId))) {
      context.addIssue({
        code: 'custom',
        path: ['reviewRequired'],
        message: 'A report item cannot be both a verified finding and review-required.',
      });
    }
    for (const coverage of report.coverage) {
      const findingCount = report.findings.filter(
        (finding) => finding.vectorId === coverage.vectorId,
      ).length;
      const reviewRequiredCount = report.reviewRequired.filter(
        (finding) => finding.vectorId === coverage.vectorId,
      ).length;
      if (coverage.findingCount !== findingCount) {
        context.addIssue({
          code: 'custom',
          path: ['coverage'],
          message: 'Coverage finding counts must equal report findings for the same vector.',
        });
      }
      if ((coverage.reviewRequiredCount ?? 0) !== reviewRequiredCount) {
        context.addIssue({
          code: 'custom',
          path: ['coverage'],
          message:
            'Coverage review-required counts must equal the report queue for the same vector.',
        });
      }
    }
    const coveredVectorIds = new Set(vectorIds);
    if (
      [...report.findings, ...report.reviewRequired].some(
        (finding) => !coveredVectorIds.has(finding.vectorId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'Every report finding must belong to a covered vector.',
      });
    }
  });

export type AuditError = z.infer<typeof AuditErrorSchema>;
export type FindingAdmissionFunnel = z.infer<typeof FindingAdmissionFunnelSchema>;
export type HypothesisGroundingFunnel = z.infer<typeof HypothesisGroundingFunnelSchema>;
export type CandidateIntegrityRejectionLedger = z.infer<
  typeof CandidateIntegrityRejectionLedgerSchema
>;
export type DiscoveryIntegrityRejectionLedger = z.infer<
  typeof DiscoveryIntegrityRejectionLedgerSchema
>;
export type AuditCheckpointBinding = z.infer<typeof AuditCheckpointBindingSchema>;
export type AuditContextOverflowLedger = z.infer<typeof AuditContextOverflowLedgerSchema>;
export type ContextOverflowTopologyEvent = z.infer<typeof ContextOverflowTopologyEventSchema>;
export type AuditEvidenceMapRecoveryLeaf = z.infer<typeof AuditEvidenceMapRecoveryLeafSchema>;
export type AuditSourcePostureRecoveryLeaf = z.infer<typeof AuditSourcePostureRecoveryLeafSchema>;
export type AuditCandidateGroundingRecoveryLeaf = z.infer<
  typeof AuditCandidateGroundingRecoveryLeafSchema
>;
export type AuditCandidateAwareCheckpoint = z.infer<typeof AuditCandidateAwareCheckpointSchema>;
export type AuditCandidateGroundingDraft = z.infer<typeof AuditCandidateGroundingDraftSchema>;
export type AuditEvidenceMapDraft = z.infer<typeof AuditEvidenceMapDraftSchema>;
export type AuditSourcePostureDraft = z.infer<typeof AuditSourcePostureDraftSchema>;
export type AuditVerificationRequest = z.infer<typeof AuditVerificationRequestSchema>;
export type AuditRunManifest = z.infer<typeof AuditRunManifestSchema>;
export type AuditRunAttempt = z.infer<typeof AuditRunAttemptSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type AuditVectorCheckpoint = z.infer<typeof AuditVectorCheckpointSchema>;
export type AuditVectorResult = z.infer<typeof AuditVectorResultSchema>;
export type PersistedCandidateAwareResult = z.infer<typeof PersistedCandidateAwareResultSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type FindingVerification = z.infer<typeof FindingVerificationSchema>;
export type VectorCoverage = z.infer<typeof VectorCoverageSchema>;
