import { z } from 'zod';

import { IdentifierSchema, IsoDateTimeSchema, Sha256Schema } from '../../shared/contracts/core.js';
import {
  ModelIdentifierSchema,
  ModelProviderIdentifierSchema,
} from '../../shared/contracts/model-identity.js';
import {
  AuditRuntimeErrorCodeSchema,
  isRetryableAuditRuntimeErrorCode,
} from '../../shared/errors/audit-runtime-error.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';
import {
  ModelRunObservationSchema,
  ModelStageErrorCodeSchema,
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
import { NarratedProposedFindingSchema } from './narrative/contract.js';
import { AuditInvestigationRequestSchema, SourceDocumentSchema } from './phase-input/contract.js';
import { SourcePostureSchema } from './source-posture/contract.js';
import { isTerminallyCompleteVector } from './terminal-classification.js';
import type { AuditVerificationRequestSchema } from './verification/contract.js';
import {
  PersistedAuditVerificationResultSchema,
  VerificationTerminalLaneCountsSchema,
  VerificationTerminalLaneSchema,
} from './verification/contract.js';

export { MaxParallelVectorsSchema } from '../../shared/contracts/concurrency.js';
export type {
  AuditInvestigationRequest,
  SourceDocument,
} from './phase-input/contract.js';
export { AuditInvestigationRequestSchema, SourceDocumentSchema };

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
    /** Equivalent source-backed claims collapsed before coverage and reporting. */
    duplicateCollapsedCount: z.number().int().nonnegative(),
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
      value.postVerificationRejectedCount +
        value.duplicateCollapsedCount +
        value.admittedFindingCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['verifierReconciledCount'],
        message:
          'Reconciled verifier results must be admitted, duplicate-collapsed, or rejected by a post-verification phase.',
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

/**
 * Closed source-free limitation signals permitted in durable vector coverage.
 * Any model-authored explanation is collapsed before checkpoint or report
 * persistence; it is never a durable artifact field.
 */
export const VectorCoverageLimitationCodes = [
  'coverage-incomplete',
  'audit-continuation-failed',
  'checkpoint-persistence-failed',
  'evidence-map-incomplete',
  'model-declared-limitation',
  'obligation-closure-incomplete',
  'provider-cancelled',
  'provider-failure',
  'scope-no-matches',
  'source-inspection-missing',
  'source-posture-unavailable',
] as const;

const vectorCoverageLimitationCodeSet: ReadonlySet<string> = new Set(VectorCoverageLimitationCodes);

/** Runtime-closed while remaining compatible with transient pre-persistence strings. */
export const VectorCoverageLimitationCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .superRefine((value, context) => {
    if (vectorCoverageLimitationCodeSet.has(value)) return;
    context.addIssue({
      code: 'custom',
      message: 'Vector coverage limitations must use a closed durable code.',
    });
  });

/** Collapses transient model or operational prose into the only generic durable code. */
export function materializeVectorCoverageLimitations(limitations: readonly string[]): string[] {
  return [
    ...new Set(
      limitations.map((limitation) =>
        vectorCoverageLimitationCodeSet.has(limitation) ? limitation : 'model-declared-limitation',
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

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
    errorCode: ModelStageErrorCodeSchema.nullable(),
    limitations: z.array(VectorCoverageLimitationCodeSchema),
    /** Source-free terminal accounting for every plan-owned review obligation. */
    obligationClosure: ObligationClosureMatrixSchema,
    admissionFunnel: FindingAdmissionFunnelSchema.optional(),
    hypothesisGroundingFunnel: HypothesisGroundingFunnelSchema.optional(),
    /** Per-reason integrity loss; no candidate content or model text is retained. */
    candidateIntegrityRejections: CandidateIntegrityRejectionLedgerSchema.optional(),
    evidenceMapObservation: ModelStageObservationSchema.optional(),
    evidenceMapRepairObservations: z.array(ModelStageObservationSchema).optional(),
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
    const terminallyComplete = isTerminallyCompleteVector(coverage);
    if (coverage.completed !== terminallyComplete) {
      context.addIssue({
        code: 'custom',
        path: ['completed'],
        message: 'Only a complete terminal closure may mark coverage complete.',
      });
    }
    if (terminallyComplete && coverage.errorCode !== null) {
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

/**
 * Stable, source-free error vocabulary for reports and resumable checkpoints.
 * Unknown operational detail is intentionally collapsed before it can cross
 * this boundary.
 */
export const AuditErrorCodeSchema = z.union([
  AuditRuntimeErrorCodeSchema,
  z.enum([
    'evidence-map-incomplete',
    'evidence-map-repair-no-progress',
    'evidence-map-repair-unavailable',
    'model-evidence-rejected',
    'obligation-closure-incomplete',
    'source-posture-incomplete',
    'tool-evidence-required',
    'validation-output-shape',
    'verifier-evidence-rejected',
    'verifier-evidence-projection-invalid',
    'verifier-inspection-missing',
    'verifier-stage-failed',
    'verifier-wrapper-contract-invalid',
  ]),
]);

export type AuditErrorCode = z.infer<typeof AuditErrorCodeSchema>;

/**
 * `retryable` on a persisted audit error means that the exact unfinished
 * boundary has a defined recovery path. It does not promise another dispatch
 * within the current invocation.
 */
const ExplicitlyRecoverableAuditErrorCodes = [
  'evidence-map-incomplete',
  'evidence-map-repair-no-progress',
  'evidence-map-repair-unavailable',
  'obligation-closure-incomplete',
  'source-posture-incomplete',
  'tool-evidence-required',
] as const satisfies readonly AuditErrorCode[];

/** Single owner for the persisted audit-error recovery affordance. */
export function isRetryableAuditErrorCode(code: AuditErrorCode): boolean {
  return (
    isRetryableAuditRuntimeErrorCode(code) ||
    ExplicitlyRecoverableAuditErrorCodes.includes(
      code as (typeof ExplicitlyRecoverableAuditErrorCodes)[number],
    )
  );
}

/** Collapses an unrecognized runtime error token to the stable provider failure code. */
export function materializeAuditErrorCode(value: string): AuditErrorCode {
  const parsed = AuditErrorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'provider-failure';
}

export const AuditErrorSchema = z.strictObject({
  code: AuditErrorCodeSchema,
  stage: z.enum([
    'inventory',
    'planning',
    'evidence-mapping',
    'evidence-map-repair',
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
  retryable: z.boolean(),
});

/** Completed vector work is checkpointable only after verification and redaction. */
export const AuditVectorResultSchema = z
  .strictObject({
    coverage: VectorCoverageSchema,
    errors: z.array(AuditErrorSchema),
    proposed: z.array(NarratedProposedFindingSchema),
    reviewRequired: z.array(NarratedProposedFindingSchema),
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

/** Materializes the sole durable vector-limitation representation before persistence. */
export function materializeAuditVectorResultForPersistence(
  result: AuditVectorResult,
): AuditVectorResult {
  return {
    ...result,
    errors: result.errors.map((error) => ({
      code: materializeAuditErrorCode(error.code),
      stage: error.stage,
      retryable: error.retryable,
    })),
    coverage: {
      ...result.coverage,
      limitations: materializeVectorCoverageLimitations(result.coverage.limitations),
    },
  };
}

/** The immutable identity a checkpoint must match before it can be reused. */
export const AuditCheckpointBindingSchema = z.strictObject({
  runId: IdentifierSchema,
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
  provider: ModelProviderIdentifierSchema,
  model: ModelIdentifierSchema,
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
 * The only telemetry retained for a recovered child. Provider-backed work
 * must retain its content-free observation; a deterministic empty child must
 * say so explicitly rather than making provider usage appear to be zero.
 */
/**
 * The execution ownership attached to every reusable audit-stage decision.
 * Provider-backed work is inseparable from its content-free cost observation;
 * a no-provider result must say so explicitly.
 */
export const AuditCheckpointExecutionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('provider'),
    modelObservation: ModelStageObservationSchema,
  }),
  z.strictObject({
    kind: z.literal('deterministic'),
  }),
]);

/** A persisted child is never the terminal phase result; reduction owns that boundary. */
export const ContextOverflowRecoveryLeafStateSchema = z.literal('partial');

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
    errorCode: ModelStageErrorCodeSchema.nullable(),
    execution: AuditCheckpointExecutionSchema.optional(),
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
    const terminalExecutionRequired =
      event.state === 'overflowed' ||
      event.state === 'completed' ||
      event.state === 'failed' ||
      event.state === 'cancelled';
    if (terminalExecutionRequired && event.execution === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['execution'],
        message: 'A terminal recovery transition must declare provider or deterministic execution.',
      });
    }
    if (
      (event.state === 'overflowed' || event.state === 'failed' || event.state === 'cancelled') &&
      event.execution?.kind === 'deterministic'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['execution'],
        message: 'An errored recovery transition must retain its provider observation.',
      });
    }
    if ((event.state === 'pending' || event.state === 'running') && event.execution !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['execution'],
        message: 'A non-terminal recovery transition cannot retain execution telemetry.',
      });
    }
  });

/**
 * Durable deterministic topology only. It never caches child model output,
 * which remains reusable exclusively through feature-owned validated drafts.
 */
export const AuditContextOverflowLedgerSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(3),
  phase: z.enum([
    'evidence-mapping',
    'evidence-map-repair',
    'source-posture',
    'investigation',
    'candidate-grounding',
  ]),
  parentStageId: ModelStageIdSchema,
  phaseInputFingerprint: Sha256Schema,
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
const AuditEvidenceMapRecoveryLeafBaseSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(4),
  parentStageId: ModelStageIdSchema,
  phaseInputFingerprint: Sha256Schema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  childKey: z.string().regex(/^root(?:\/(?:left|right))*$/u),
  scopeFingerprint: Sha256Schema,
  recoveryState: ContextOverflowRecoveryLeafStateSchema,
  execution: AuditCheckpointExecutionSchema,
  savedAt: IsoDateTimeSchema,
});

/** Validated neutral-map recovery output for mapping or append-only repair. */
export const AuditEvidenceMapRecoveryLeafSchema = z.discriminatedUnion('phase', [
  AuditEvidenceMapRecoveryLeafBaseSchema.extend({
    phase: z.literal('evidence-mapping'),
    evidenceMap: EvidenceMapSchema,
  }),
  AuditEvidenceMapRecoveryLeafBaseSchema.extend({
    phase: z.literal('evidence-map-repair'),
    evidenceMap: EvidenceMapSchema,
  }),
]);

/** Validated candidate-blind posture fragment for one exact recovered scope. */
export const AuditSourcePostureRecoveryLeafSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(4),
  phase: z.literal('source-posture'),
  parentStageId: ModelStageIdSchema,
  phaseInputFingerprint: Sha256Schema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  childKey: z.string().regex(/^root(?:\/(?:left|right))*$/u),
  scopeFingerprint: Sha256Schema,
  recoveryState: ContextOverflowRecoveryLeafStateSchema,
  execution: AuditCheckpointExecutionSchema,
  sourcePosture: SourcePostureSchema,
  savedAt: IsoDateTimeSchema,
});

/** Canonical grounding outcomes for one exact recovered scope; raw outputs never persist. */
export const AuditCandidateGroundingRecoveryLeafSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(3),
  phase: z.literal('candidate-grounding'),
  parentStageId: ModelStageIdSchema,
  phaseInputFingerprint: Sha256Schema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  childKey: z.string().regex(/^root(?:\/(?:left|right))*$/u),
  scopeFingerprint: Sha256Schema,
  recoveryState: ContextOverflowRecoveryLeafStateSchema,
  execution: AuditCheckpointExecutionSchema,
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
  schemaVersion: z.literal(17),
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

/** Complete canonical per-seed outcomes reusable without persisting discovery seeds. */
export const AuditCandidateGroundingDraftSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(10),
  phase: z.literal('candidate-grounding'),
  candidateGroundingProtocolFingerprint: Sha256Schema,
  evidenceMapFingerprint: Sha256Schema,
  sourcePostureFingerprint: Sha256Schema,
  savedAt: IsoDateTimeSchema,
  groundings: CanonicalCandidateGroundingOutputSchema,
  closures: InvestigationObligationClosuresSchema,
  hypothesisGroundingFunnel: HypothesisGroundingFunnelSchema,
  candidateIntegrityRejections: CandidateIntegrityRejectionLedgerSchema,
  discoveryObservation: ModelStageObservationSchema,
  modelObservation: ModelStageObservationSchema,
});

/** A redacted, terminal candidate-aware decision. Raw model rationale is never checkpointed. */
export const PersistedCandidateAwareResultSchema = z.discriminatedUnion('decision', [
  PersistedAuditVerificationResultSchema.options[0].extend({
    terminalLane: VerificationTerminalLaneSchema,
    execution: AuditCheckpointExecutionSchema,
  }),
  PersistedAuditVerificationResultSchema.options[1].extend({
    terminalLane: VerificationTerminalLaneSchema,
    execution: AuditCheckpointExecutionSchema,
  }),
  PersistedAuditVerificationResultSchema.options[2].extend({
    terminalLane: VerificationTerminalLaneSchema,
    execution: AuditCheckpointExecutionSchema,
  }),
]);

/**
 * Candidate-bound overflow history. It is source-free and lives beside the
 * exact verifier/countercheck work unit, not in a vector-wide shared ledger.
 */
export const CandidateAwareContextOverflowTopologySchema = z.strictObject({
  phaseInputFingerprint: Sha256Schema,
  recoveryProtocolFingerprint: Sha256Schema,
  rootScopeFingerprint: Sha256Schema,
  events: z.array(ContextOverflowTopologyEventSchema),
});

/**
 * One durable unit of verifier or countercheck work. The candidate digest binds
 * reuse to the exact canonical input without retaining a second candidate copy.
 */
export const AuditCandidateAwareCheckpointSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(5),
  phase: z.enum(['verification', 'countercheck']),
  candidateGroundingProtocolFingerprint: Sha256Schema,
  candidateOrdinal: z.number().int().min(1),
  candidateFingerprint: Sha256Schema,
  evidenceMapFingerprint: Sha256Schema,
  sourcePostureFingerprint: Sha256Schema,
  state: z.enum(['pending', 'running', 'completed']),
  savedAt: IsoDateTimeSchema,
  result: PersistedCandidateAwareResultSchema.optional(),
  contextOverflowTopology: CandidateAwareContextOverflowTopologySchema.optional(),
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

/** One source-free candidate-blind repair transition for an immutable map input. */
export const AuditEvidenceMapRepairAttemptSchema = z.strictObject({
  gapSignature: Sha256Schema,
  inputMapFingerprint: Sha256Schema,
  outputMapFingerprint: Sha256Schema,
  appendedFactCount: z.number().int().nonnegative(),
  execution: AuditCheckpointExecutionSchema,
});

/** A validated map can be reused for an interrupted investigation or verification. */
export const AuditEvidenceMapDraftSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(5),
  phase: z.literal('evidence-mapping'),
  savedAt: IsoDateTimeSchema,
  evidenceMap: EvidenceMapSchema,
  evidenceMapFingerprint: Sha256Schema,
  repairAttempts: z.array(AuditEvidenceMapRepairAttemptSchema),
  execution: AuditCheckpointExecutionSchema,
}).superRefine((draft, context) => {
  const noProgressAttempts = draft.repairAttempts.filter(
    (attempt) =>
      attempt.inputMapFingerprint === attempt.outputMapFingerprint &&
      attempt.appendedFactCount === 0,
  );
  const keys = noProgressAttempts.map(
    (attempt) => `${attempt.inputMapFingerprint}\0${attempt.gapSignature}`,
  );
  if (new Set(keys).size === keys.length) return;
  context.addIssue({
    code: 'custom',
    path: ['repairAttempts'],
    message: 'A map draft cannot retain repeated no-progress repair signatures.',
  });
});

/** A validated candidate-blind posture can be reused only by later phases. */
export const AuditSourcePostureDraftSchema = AuditCheckpointBindingSchema.extend({
  schemaVersion: z.literal(4),
  phase: z.literal('source-posture'),
  evidenceMapFingerprint: Sha256Schema,
  savedAt: IsoDateTimeSchema,
  sourcePosture: SourcePostureSchema,
  execution: AuditCheckpointExecutionSchema,
});

export const FindingVerificationSchema = z.strictObject({
  status: z.enum(['verified', 'insufficient-evidence', 'rejected']),
  checks: z
    .array(
      z.enum([
        'approved-obligation',
        'scope',
        'source-path',
        'line-range',
        'source-content-digest',
        'claim-evidence-roles',
      ]),
    )
    .min(1),
});

export const FindingSchema = NarratedProposedFindingSchema.extend({
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
  provider: ModelProviderIdentifierSchema.nullable(),
  model: ModelIdentifierSchema.nullable(),
  outcome: z.enum(['completed', 'partial', 'failed', 'cancelled']),
  counters: z.strictObject({
    plannedVectors: z.number().int().nonnegative(),
    completedVectors: z.number().int().nonnegative(),
    failedVectors: z.number().int().nonnegative(),
    findingCount: z.number().int().nonnegative(),
  }),
  modelObservation: ModelRunObservationSchema.optional(),
});

/** Content-free lifecycle record for the exclusive audit owner. */
export const AuditRunAttemptSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    runId: IdentifierSchema,
    planId: IdentifierSchema,
    planDigest: Sha256Schema,
    targetFingerprint: Sha256Schema,
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema.nullable(),
    status: z.enum(['starting', 'completed', 'partial', 'failed', 'cancelled']),
    /**
     * The exact source-minimal report binding prepared before public publication.
     * A prepared binding is private recovery state, not evidence that publication
     * completed.
     */
    publicReport: z
      .strictObject({
        reportId: IdentifierSchema,
        reportDigest: Sha256Schema,
      })
      .nullable(),
    /** Separates a durable private publication intent from completed public publication. */
    publicationState: z.enum(['not-prepared', 'prepared', 'published']),
    /** Cleanup is operational state; it never changes the audit's terminal outcome. */
    snapshotState: z.enum([
      'not-retained',
      'retained',
      'release-pending',
      'released',
      'release-failed',
    ]),
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
    if (value.status === 'starting') {
      const isUnprepared = value.publicationState === 'not-prepared';
      const isPrepared = value.publicationState === 'prepared';
      const validStartingState =
        (isUnprepared &&
          value.publicReport === null &&
          (value.snapshotState === 'not-retained' || value.snapshotState === 'retained')) ||
        (isPrepared && value.publicReport !== null && value.snapshotState === 'retained');
      if (!validStartingState) {
        context.addIssue({
          code: 'custom',
          message:
            'A starting audit attempt must be unprepared without a report or retain a prepared report binding.',
        });
      }
      return;
    }
    if (value.status === 'partial' && value.publicReport === null) {
      context.addIssue({
        code: 'custom',
        path: ['publicReport'],
        message: 'A partial audit attempt requires its published public report binding.',
      });
    }
    if (value.status === 'completed') {
      if (value.publicReport === null) {
        context.addIssue({
          code: 'custom',
          path: ['publicReport'],
          message: 'A completed audit attempt requires its published public report binding.',
        });
      }
      if (
        value.snapshotState !== 'release-pending' &&
        value.snapshotState !== 'released' &&
        value.snapshotState !== 'release-failed'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['snapshotState'],
          message:
            'A completed audit attempt must record pending, completed, or failed snapshot release.',
        });
      }
    }
    if (value.publicationState === 'published' && value.publicReport === null) {
      context.addIssue({
        code: 'custom',
        path: ['publicReport'],
        message: 'A published audit attempt requires its public report binding.',
      });
    }
    if (
      (value.status === 'completed' || value.status === 'partial') &&
      value.publicationState !== 'published'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['publicationState'],
        message: 'A completed or partial audit attempt requires completed public publication.',
      });
    }
    if (
      (value.status === 'failed' || value.status === 'cancelled') &&
      value.publicationState === 'prepared' &&
      (value.publicReport === null || value.snapshotState !== 'retained')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A failed prepared publication must retain its exact binding and snapshot.',
      });
    }
  });

export const AuditReportSchema = z
  .strictObject({
    schemaVersion: z.literal(21),
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
export type AuditCheckpointExecution = z.infer<typeof AuditCheckpointExecutionSchema>;
export type AuditEvidenceMapRecoveryLeaf = z.infer<typeof AuditEvidenceMapRecoveryLeafSchema>;
export type AuditSourcePostureRecoveryLeaf = z.infer<typeof AuditSourcePostureRecoveryLeafSchema>;
export type AuditCandidateGroundingRecoveryLeaf = z.infer<
  typeof AuditCandidateGroundingRecoveryLeafSchema
>;
export type AuditCandidateAwareCheckpoint = z.infer<typeof AuditCandidateAwareCheckpointSchema>;
export type CandidateAwareContextOverflowTopology = z.infer<
  typeof CandidateAwareContextOverflowTopologySchema
>;
export type AuditCandidateGroundingDraft = z.infer<typeof AuditCandidateGroundingDraftSchema>;
export type AuditEvidenceMapRepairAttempt = z.infer<typeof AuditEvidenceMapRepairAttemptSchema>;
export type AuditEvidenceMapDraft = z.infer<typeof AuditEvidenceMapDraftSchema>;
export type AuditSourcePostureDraft = z.infer<typeof AuditSourcePostureDraftSchema>;
export type AuditVerificationRequest = z.infer<typeof AuditVerificationRequestSchema>;
export type AuditRunManifest = z.infer<typeof AuditRunManifestSchema>;
export type AuditRunAttempt = z.infer<typeof AuditRunAttemptSchema>;
export type AuditReport = z.infer<typeof AuditReportSchema>;
export type AuditVectorCheckpoint = z.infer<typeof AuditVectorCheckpointSchema>;
export type AuditVectorResult = z.infer<typeof AuditVectorResultSchema>;
export type PersistedCandidateAwareResult = z.infer<typeof PersistedCandidateAwareResultSchema>;

/** The sole projection from reusable execution ownership to provider telemetry. */
export function modelObservationForAuditCheckpointExecution(
  execution: AuditCheckpointExecution,
): ModelStageObservation | undefined {
  return execution.kind === 'provider' ? execution.modelObservation : undefined;
}
export type Finding = z.infer<typeof FindingSchema>;
export type FindingVerification = z.infer<typeof FindingVerificationSchema>;
export type VectorCoverage = z.infer<typeof VectorCoverageSchema>;
