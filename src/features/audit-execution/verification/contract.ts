import { z } from 'zod';
import {
  IdentifierSchema,
  modelTokenSchema,
  RelativePathSchema,
} from '../../../shared/contracts/core.js';
import {
  AttackVectorSchema,
  PlanObligationReferenceSchema,
  PlanObligationReferencesSchema,
  ProposedFindingSchema,
  SourceEvidenceRoleSchema,
} from '../../attack-planning/plan.schema.js';
import {
  EvidenceMapFactIdsSchema,
  EvidenceMapSchema,
  UnverifiedEvidenceMapEvidenceSelectionSchema,
} from '../evidence-map/contract.js';
import {
  SourcePostureAssessmentIdsSchema,
  SourcePostureSchema,
} from '../source-posture/contract.js';

/** A verifier decides whether an investigator hypothesis can enter a report. */
const CanonicalVerificationDecisionSchema = z.enum(['accepted', 'rejected', 'incomplete']);

/** Provider tokens may vary in case; persisted decisions are always canonical lowercase. */
export const VerificationDecisionSchema = modelTokenSchema(CanonicalVerificationDecisionSchema);

/**
 * Source-free operational terminal lane for a candidate-aware attempt. It is
 * not a security conclusion and never carries model or source content.
 */
export const VerificationTerminalLaneSchema = z.enum([
  'accepted',
  'rejected',
  'model-incomplete',
  'evidence-projection-invalid',
  'stage-failed',
  'inspection-missing',
  'wrapper-contract-invalid',
]);

export const VerificationTerminalLaneCountsSchema = z.strictObject({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  modelIncomplete: z.number().int().nonnegative(),
  evidenceProjectionInvalid: z.number().int().nonnegative(),
  stageFailed: z.number().int().nonnegative(),
  inspectionMissing: z.number().int().nonnegative(),
  wrapperContractInvalid: z.number().int().nonnegative(),
});

export type VerificationTerminalLane = z.infer<typeof VerificationTerminalLaneSchema>;
export type VerificationTerminalLaneCounts = z.infer<typeof VerificationTerminalLaneCountsSchema>;

/** The one shared default for a schema-valid candidate-aware model decision. */
export function terminalLaneForVerificationDecision(
  decision: VerificationDecision,
): VerificationTerminalLane {
  if (decision === 'accepted') return 'accepted';
  if (decision === 'rejected') return 'rejected';
  return 'model-incomplete';
}

export function emptyVerificationTerminalLaneCounts(): VerificationTerminalLaneCounts {
  return VerificationTerminalLaneCountsSchema.parse({
    accepted: 0,
    rejected: 0,
    modelIncomplete: 0,
    evidenceProjectionInvalid: 0,
    stageFailed: 0,
    inspectionMissing: 0,
    wrapperContractInvalid: 0,
  });
}

/** Aggregates closed operational lanes without retaining candidate identity or content. */
export function countVerificationTerminalLanes(
  lanes: readonly VerificationTerminalLane[],
): VerificationTerminalLaneCounts {
  const counts = emptyVerificationTerminalLaneCounts();
  for (const lane of lanes) {
    if (lane === 'accepted') counts.accepted += 1;
    else if (lane === 'rejected') counts.rejected += 1;
    else if (lane === 'model-incomplete') counts.modelIncomplete += 1;
    else if (lane === 'evidence-projection-invalid') counts.evidenceProjectionInvalid += 1;
    else if (lane === 'stage-failed') counts.stageFailed += 1;
    else if (lane === 'inspection-missing') counts.inspectionMissing += 1;
    else counts.wrapperContractInvalid += 1;
  }
  return VerificationTerminalLaneCountsSchema.parse(counts);
}

export function aggregateVerificationTerminalLaneCounts(
  counts: readonly VerificationTerminalLaneCounts[],
): VerificationTerminalLaneCounts {
  return counts.reduce(
    (aggregate, next) =>
      VerificationTerminalLaneCountsSchema.parse({
        accepted: aggregate.accepted + next.accepted,
        rejected: aggregate.rejected + next.rejected,
        modelIncomplete: aggregate.modelIncomplete + next.modelIncomplete,
        evidenceProjectionInvalid:
          aggregate.evidenceProjectionInvalid + next.evidenceProjectionInvalid,
        stageFailed: aggregate.stageFailed + next.stageFailed,
        inspectionMissing: aggregate.inspectionMissing + next.inspectionMissing,
        wrapperContractInvalid: aggregate.wrapperContractInvalid + next.wrapperContractInvalid,
      }),
    emptyVerificationTerminalLaneCounts(),
  );
}

/** Source facts a model must independently reconcile before a claim can be accepted. */
export const SourceClaimEvidenceSchema = ProposedFindingSchema.shape.evidence.element.extend({
  role: modelTokenSchema(SourceEvidenceRoleSchema),
});

export const HypothesisEvidenceListSchema = z
  .array(SourceClaimEvidenceSchema)
  .min(2)
  .superRefine((evidence, context) => {
    if (!evidence.some((item) => item.role === 'unsafe-condition')) {
      context.addIssue({
        code: 'custom',
        message: 'Hypothesis evidence must identify the unsafe condition.',
      });
    }
  });

export const SourceClaimEvidenceListSchema = HypothesisEvidenceListSchema.superRefine(
  (evidence, context) => {
    if (!evidence.some((item) => item.role === 'operation')) {
      context.addIssue({
        code: 'custom',
        message: 'Verified evidence must identify the security-relevant operation.',
      });
    }
  },
);

/** Source locations considered while deciding whether a local control negates a claim. */
export const ReconciliationEvidenceSchema = z.array(SourceClaimEvidenceSchema).min(1);

/** Source locations considered while deciding whether a local control negates a claim. */
export const ControlAssessmentEvidenceSchema = ReconciliationEvidenceSchema;

const UnverifiedReconciliationEvidenceSelectionsSchema = z
  .array(UnverifiedEvidenceMapEvidenceSelectionSchema)
  .min(1);

/** Map facts whose control relevance the verifier explicitly reconciled. */
export const ControlAssessmentFactIdsSchema = z.array(IdentifierSchema).optional();

const ControlAssessmentFields = {
  conclusion: z.enum(['no-effective-control-found', 'control-insufficient', 'not-applicable']),
  explanation: z.string().trim().min(1),
};

/** Canonical source-backed control assessment persisted after verification. */
export const ControlAssessmentSchema = z.strictObject({
  ...ControlAssessmentFields,
  evidence: ControlAssessmentEvidenceSchema,
  consideredEvidenceMapFactIds: ControlAssessmentFactIdsSchema,
});

/** Model output selects map evidence; it cannot author verifier source locations. */
export const UnverifiedControlAssessmentSchema = z.strictObject({
  ...ControlAssessmentFields,
  evidenceSelections: UnverifiedReconciliationEvidenceSelectionsSchema,
});

/** A verifier's declared relationship between an approved evidence basis and the claim. */
export const ClaimReconciliationDispositionSchema = modelTokenSchema(
  z.enum(['supports-claim', 'contradicts-claim', 'unresolved']),
);

const SourcePostureReconciliationFields = {
  assessmentId: IdentifierSchema,
  disposition: ClaimReconciliationDispositionSchema,
  explanation: z.string().trim().min(1),
};

/** Canonical, source-backed record that a verifier confronted prior posture. */
export const SourcePostureReconciliationSchema = z.strictObject({
  ...SourcePostureReconciliationFields,
  evidence: ControlAssessmentEvidenceSchema,
});

/** Model output selects posture-map evidence; it cannot author source locations. */
export const UnverifiedSourcePostureReconciliationSchema = z.strictObject({
  ...SourcePostureReconciliationFields,
  assessmentId: z.string().trim().min(1).max(160),
  evidenceSelections: UnverifiedReconciliationEvidenceSelectionsSchema,
});

const PlanObligationReconciliationFields = {
  planObligation: PlanObligationReferenceSchema,
  disposition: ClaimReconciliationDispositionSchema,
  explanation: z.string().trim().min(1),
};

/** A verifier's source-backed disposition for one exact human-approved review obligation. */
export const PlanObligationReconciliationSchema = z.strictObject({
  ...PlanObligationReconciliationFields,
  evidence: ReconciliationEvidenceSchema,
});

/** Model output selects existing map evidence; canonical locations are projected by the system. */
export const UnverifiedPlanObligationReconciliationSchema = z.strictObject({
  ...PlanObligationReconciliationFields,
  evidenceSelections: UnverifiedReconciliationEvidenceSelectionsSchema,
});

function assertUniquePlanObligationReconciliations(
  reconciliations: readonly { planObligation: { obligationId: string } }[],
  context: z.RefinementCtx,
): void {
  const keys = reconciliations.map((reconciliation) => reconciliation.planObligation.obligationId);
  if (keys.length !== new Set(keys).size) {
    context.addIssue({
      code: 'custom',
      message: 'Plan-obligation reconciliations must not duplicate an obligation.',
    });
  }
}

export const PlanObligationReconciliationsSchema = z
  .array(PlanObligationReconciliationSchema)
  .superRefine(assertUniquePlanObligationReconciliations);

export const UnverifiedPlanObligationReconciliationsSchema = z
  .array(UnverifiedPlanObligationReconciliationSchema)
  .superRefine(assertUniquePlanObligationReconciliations);

export const VerifiableHypothesisSchema = ProposedFindingSchema.extend({
  evidence: HypothesisEvidenceListSchema,
  planObligations: PlanObligationReferencesSchema,
  evidenceMapFactIds: EvidenceMapFactIdsSchema,
  sourcePostureAssessmentIds: SourcePostureAssessmentIdsSchema,
});

export const AuditVerificationRequestSchema = z.strictObject({
  verificationId: IdentifierSchema,
  vector: AttackVectorSchema,
  evidenceMap: EvidenceMapSchema,
  sourcePosture: SourcePostureSchema,
  hypothesis: VerifiableHypothesisSchema,
  availableSourcePaths: z.array(RelativePathSchema),
});

/**
 * A countercheck may challenge one verifier-reconciled claim but never create
 * another claim or widen its approved evidence scope.
 */
export const AuditCountercheckRequestSchema = z.strictObject({
  countercheckId: IdentifierSchema,
  vector: AttackVectorSchema,
  evidenceMap: EvidenceMapSchema,
  sourcePosture: SourcePostureSchema,
  hypothesis: VerifiableHypothesisSchema,
  availableSourcePaths: z.array(RelativePathSchema),
});

/** Canonical verifier decision fields shared by runtime and redacted persistence. */
const AuditVerificationResultPayloadSchema = z.strictObject({
  decision: VerificationDecisionSchema,
  verifiedEvidence: SourceClaimEvidenceListSchema.nullable().default(null),
  verifiedPlanObligations: z.array(PlanObligationReferenceSchema).default([]),
  controlAssessment: ControlAssessmentSchema.nullable().default(null),
  obligationReconciliations: PlanObligationReconciliationsSchema.default([]),
  postureReconciliations: z.array(SourcePostureReconciliationSchema).default([]),
});

function assertAuditVerificationResultInvariants(
  result: z.infer<typeof AuditVerificationResultPayloadSchema>,
  context: z.RefinementCtx,
): void {
  if (result.decision === 'accepted' && result.verifiedEvidence === null) {
    context.addIssue({
      code: 'custom',
      path: ['verifiedEvidence'],
      message: 'An accepted verdict requires independently reconciled source evidence.',
    });
  }
  if (result.decision === 'accepted' && result.verifiedPlanObligations.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['verifiedPlanObligations'],
      message: 'An accepted verdict requires approved-plan obligation references.',
    });
  }
  if (result.decision === 'accepted' && result.controlAssessment === null) {
    context.addIssue({
      code: 'custom',
      path: ['controlAssessment'],
      message: 'An accepted verdict requires a source-backed control assessment.',
    });
  }
  if (result.decision === 'accepted' && result.obligationReconciliations.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['obligationReconciliations'],
      message: 'An accepted verdict requires source-backed plan-obligation reconciliations.',
    });
  }
  if (
    result.decision === 'accepted' &&
    result.obligationReconciliations.some(
      (reconciliation) => reconciliation.disposition === 'unresolved',
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['obligationReconciliations'],
      message: 'An accepted verdict cannot leave a plan obligation unresolved.',
    });
  }
  if (result.decision === 'accepted' && result.postureReconciliations.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['postureReconciliations'],
      message: 'An accepted verdict requires source-backed posture reconciliations.',
    });
  }
  if (
    result.decision === 'accepted' &&
    result.postureReconciliations.some(
      (reconciliation) => reconciliation.disposition === 'unresolved',
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['postureReconciliations'],
      message: 'An accepted verdict cannot leave a posture assessment unresolved.',
    });
  }
  if (result.decision !== 'accepted' && result.verifiedEvidence !== null) {
    context.addIssue({
      code: 'custom',
      path: ['verifiedEvidence'],
      message: 'Only an accepted verdict may return verified source evidence.',
    });
  }
  if (result.decision !== 'accepted' && result.verifiedPlanObligations.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['verifiedPlanObligations'],
      message: 'Only an accepted verdict may return approved-plan obligation references.',
    });
  }
  if (result.decision !== 'accepted' && result.controlAssessment !== null) {
    context.addIssue({
      code: 'custom',
      path: ['controlAssessment'],
      message: 'Only an accepted verdict may return a control assessment.',
    });
  }
  if (result.decision !== 'accepted' && result.obligationReconciliations.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['obligationReconciliations'],
      message: 'Only an accepted verdict may return plan-obligation reconciliations.',
    });
  }
  if (result.decision !== 'accepted' && result.postureReconciliations.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['postureReconciliations'],
      message: 'Only an accepted verdict may return posture reconciliations.',
    });
  }
}

/** A runtime verifier result; its model-authored reason is never checkpointed. */
export const AuditVerificationResultSchema = AuditVerificationResultPayloadSchema.extend({
  reason: z.string().trim().min(1),
}).superRefine(assertAuditVerificationResultInvariants);

/** Canonical terminal fields safe to persist for exact recovery. */
export const PersistedAuditVerificationResultSchema =
  AuditVerificationResultPayloadSchema.superRefine(assertAuditVerificationResultInvariants);

/**
 * Model-facing verifier result. Exact obligations, control-fact coverage, and
 * source locations are projected deterministically from the supplied request.
 */
export const UnverifiedAuditVerificationResultSchema = z
  .strictObject({
    decision: VerificationDecisionSchema,
    reason: z.string().trim().min(1),
    operationEvidence: UnverifiedEvidenceMapEvidenceSelectionSchema.nullable().default(null),
    unsafeConditionEvidence: UnverifiedEvidenceMapEvidenceSelectionSchema.nullable().default(null),
    controlAssessment: UnverifiedControlAssessmentSchema.nullable().default(null),
    obligationReconciliations: UnverifiedPlanObligationReconciliationsSchema.default([]),
    postureReconciliations: z.array(UnverifiedSourcePostureReconciliationSchema).default([]),
  })
  .superRefine((result, context) => {
    if (
      result.decision === 'accepted' &&
      (result.operationEvidence === null || result.unsafeConditionEvidence === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['operationEvidence'],
        message: 'An accepted verdict requires selected operation and unsafe-condition evidence.',
      });
    }
    if (result.decision === 'accepted' && result.controlAssessment === null) {
      context.addIssue({
        code: 'custom',
        path: ['controlAssessment'],
        message: 'An accepted verdict requires a source-backed control assessment.',
      });
    }
    if (result.decision === 'accepted' && result.obligationReconciliations.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['obligationReconciliations'],
        message: 'An accepted verdict requires plan-obligation reconciliations.',
      });
    }
    if (
      result.decision === 'accepted' &&
      result.obligationReconciliations.some(
        (reconciliation) => reconciliation.disposition === 'unresolved',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['obligationReconciliations'],
        message: 'An accepted verdict cannot leave a plan obligation unresolved.',
      });
    }
    if (result.decision === 'accepted' && result.postureReconciliations.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['postureReconciliations'],
        message: 'An accepted verdict requires posture reconciliations.',
      });
    }
    if (
      result.decision === 'accepted' &&
      result.postureReconciliations.some(
        (reconciliation) => reconciliation.disposition === 'unresolved',
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['postureReconciliations'],
        message: 'An accepted verdict cannot leave a posture assessment unresolved.',
      });
    }
    if (
      result.decision !== 'accepted' &&
      (result.operationEvidence !== null ||
        result.unsafeConditionEvidence !== null ||
        result.controlAssessment !== null ||
        result.obligationReconciliations.length > 0 ||
        result.postureReconciliations.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Only an accepted verdict may return selected source evidence or a control assessment.',
      });
    }
  });

export type AuditVerificationRequest = z.infer<typeof AuditVerificationRequestSchema>;
export type AuditCountercheckRequest = z.infer<typeof AuditCountercheckRequestSchema>;
export type AuditVerificationResult = z.infer<typeof AuditVerificationResultSchema>;
export type PlanObligationReconciliation = z.infer<typeof PlanObligationReconciliationSchema>;
export type SourcePostureReconciliation = z.infer<typeof SourcePostureReconciliationSchema>;
export type UnverifiedAuditVerificationResult = z.infer<
  typeof UnverifiedAuditVerificationResultSchema
>;
export type VerificationDecision = z.infer<typeof VerificationDecisionSchema>;
export type VerifiableHypothesis = z.infer<typeof VerifiableHypothesisSchema>;
