import { z } from 'zod';
import {
  BoundedTextSchema,
  IdentifierSchema,
  modelTokenSchema,
  RelativePathSchema,
} from '../../../shared/contracts/core.js';
import {
  AttackVectorSchema,
  ClaimEvidenceBundlesSchema,
  type ClaimEvidenceRole,
  ClaimEvidenceRoleSchema,
  PlanObligationReferenceSchema,
  PlanObligationReferencesSchema,
  SourceEvidenceRoleSchema,
  SourceEvidenceSchema,
} from '../../attack-planning/index.js';
import {
  EvidenceMapFactIdsSchema,
  EvidenceMapInsufficienciesSchema,
  EvidenceMapSchema,
  UnverifiedEvidenceMapEvidenceSelectionSchema,
} from '../evidence-map/contract.js';
import { NarratedProposedFindingSchema } from '../narrative/contract.js';
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
  'stage-failed',
  'inspection-missing',
  'wrapper-contract-invalid',
]);

export const VerificationTerminalLaneCountsSchema = z.strictObject({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  modelIncomplete: z.number().int().nonnegative(),
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
        stageFailed: aggregate.stageFailed + next.stageFailed,
        inspectionMissing: aggregate.inspectionMissing + next.inspectionMissing,
        wrapperContractInvalid: aggregate.wrapperContractInvalid + next.wrapperContractInvalid,
      }),
    emptyVerificationTerminalLaneCounts(),
  );
}

/** Source facts a model must independently reconcile before a claim can be accepted. */
export const SourceClaimEvidenceSchema = SourceEvidenceSchema.extend({
  role: modelTokenSchema(SourceEvidenceRoleSchema),
});

/** Source locations considered while deciding whether a local control negates a claim. */
export const ReconciliationEvidenceSchema = z.array(SourceClaimEvidenceSchema).min(1);

/** Source locations considered while deciding whether a local control negates a claim. */
export const ControlAssessmentEvidenceSchema = ReconciliationEvidenceSchema;

function evidenceSelectionKey(selection: { factId: string; evidenceIndex: number }): string {
  return JSON.stringify([selection.factId, selection.evidenceIndex]);
}

const UnverifiedReconciliationEvidenceSelectionsSchema = z
  .array(UnverifiedEvidenceMapEvidenceSelectionSchema)
  .min(1);

/** One map-bound role-selection lineage bundle shared across model stages. */
export const UnverifiedClaimEvidenceSelectionBundleSchema = z
  .strictObject({
    role: ClaimEvidenceRoleSchema,
    selections: z.array(UnverifiedEvidenceMapEvidenceSelectionSchema).min(1),
  })
  .superRefine((bundle, context) => {
    const keys = bundle.selections.map(evidenceSelectionKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: 'custom',
        path: ['selections'],
        message: 'A claim-evidence bundle must not select the same map location twice.',
      });
    }
  });

function assertExactClaimEvidenceRoles(
  bundles: readonly { role: ClaimEvidenceRole }[],
  context: z.RefinementCtx,
): void {
  const operation = bundles.filter((bundle) => bundle.role === 'operation');
  const unsafeCondition = bundles.filter((bundle) => bundle.role === 'unsafe-condition');
  if (operation.length !== 1 || unsafeCondition.length !== 1) {
    context.addIssue({
      code: 'custom',
      message: 'A claim requires exactly one operation and one unsafe-condition bundle.',
    });
  }
}

/** The minimal source-free role-selection lineage shared by discovery, grounding, and verification. */
export const UnverifiedClaimEvidenceSelectionBundlesSchema = z
  .array(UnverifiedClaimEvidenceSelectionBundleSchema)
  .length(2)
  .superRefine(assertExactClaimEvidenceRoles);

/** Shared source-free role-selection lineage for discovery, grounding, and evaluator diagnostics. */
export type ClaimEvidenceSelectionBundles = z.infer<
  typeof UnverifiedClaimEvidenceSelectionBundlesSchema
>;

/** One map-bound role in a relational claim; its locations are never reduced to one line. */
export const UnverifiedClaimEvidenceBundleSchema =
  UnverifiedClaimEvidenceSelectionBundleSchema.extend({
    explanation: BoundedTextSchema.min(1),
  });

/** The exact shared model-facing claim-bundle contract for grounding and verification. */
export const UnverifiedClaimEvidenceBundlesSchema = z
  .array(UnverifiedClaimEvidenceBundleSchema)
  .length(2)
  .superRefine(assertExactClaimEvidenceRoles);

/** Validates that a later stage retained every inherited map selection under the same role. */
export function preservesClaimEvidenceSelectionLineage(
  required: readonly {
    role: ClaimEvidenceRole;
    selections: readonly { factId: string; evidenceIndex: number }[];
  }[],
  actual: readonly {
    role: ClaimEvidenceRole;
    selections: readonly { factId: string; evidenceIndex: number }[];
  }[],
): boolean {
  return required.every((requiredBundle) => {
    const actualBundle = actual.find((bundle) => bundle.role === requiredBundle.role);
    return (
      actualBundle !== undefined &&
      requiredBundle.selections.every((selection) =>
        actualBundle.selections.some(
          (candidate) => evidenceSelectionKey(candidate) === evidenceSelectionKey(selection),
        ),
      )
    );
  });
}

/** Map facts whose control relevance the verifier explicitly reconciled. */
export const ControlAssessmentFactIdsSchema = z.array(IdentifierSchema).optional();

const ControlAssessmentConclusionSchema = z.enum([
  'no-effective-control-found',
  'control-insufficient',
  'not-applicable',
]);

/** Canonical source-backed control assessment persisted after verification. */
export const ControlAssessmentSchema = z.strictObject({
  conclusion: ControlAssessmentConclusionSchema,
  evidence: ControlAssessmentEvidenceSchema,
  consideredEvidenceMapFactIds: ControlAssessmentFactIdsSchema,
});

/** Model output selects map evidence; it cannot author verifier source locations. */
export const UnverifiedControlAssessmentSchema = z.strictObject({
  conclusion: ControlAssessmentConclusionSchema,
  explanation: z.string().trim().min(1),
  evidenceSelections: UnverifiedReconciliationEvidenceSelectionsSchema,
});

/** A verifier's declared relationship between an approved evidence basis and the claim. */
export const ClaimReconciliationDispositionSchema = modelTokenSchema(
  z.enum(['supports-claim', 'contradicts-claim', 'unresolved']),
);

const SourcePostureReconciliationFields = {
  assessmentId: IdentifierSchema,
  disposition: ClaimReconciliationDispositionSchema,
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
  explanation: z.string().trim().min(1),
  evidenceSelections: UnverifiedReconciliationEvidenceSelectionsSchema,
});

const PlanObligationReconciliationFields = {
  planObligation: PlanObligationReferenceSchema,
  disposition: ClaimReconciliationDispositionSchema,
};

/** A verifier's source-backed disposition for one exact human-approved review obligation. */
export const PlanObligationReconciliationSchema = z.strictObject({
  ...PlanObligationReconciliationFields,
  evidence: ReconciliationEvidenceSchema,
});

/** Model output selects existing map evidence; canonical locations are projected by the system. */
export const UnverifiedPlanObligationReconciliationSchema = z.strictObject({
  ...PlanObligationReconciliationFields,
  explanation: z.string().trim().min(1),
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

export const VerifiableHypothesisSchema = NarratedProposedFindingSchema.extend({
  planObligations: PlanObligationReferencesSchema,
  evidenceMapFactIds: EvidenceMapFactIdsSchema,
  claimEvidenceSelections: UnverifiedClaimEvidenceSelectionBundlesSchema,
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

export const VerificationReasonCodeSchema = z.enum([
  'claim-supported',
  'operation-evidence-insufficient',
  'unsafe-condition-evidence-insufficient',
  'effective-control',
  'claim-contradicted',
  'scope-insufficient',
  'context-required',
  'output-invalid',
]);

const AcceptedReasonCodeSchema = z.literal('claim-supported');
const RejectedReasonCodeSchema = z.enum(['effective-control', 'claim-contradicted']);
const IncompleteReasonCodeSchema = z.enum([
  'operation-evidence-insufficient',
  'unsafe-condition-evidence-insufficient',
  'scope-insufficient',
  'context-required',
  'output-invalid',
]);

const ResolvedPlanObligationReconciliationsSchema = PlanObligationReconciliationsSchema.min(
  1,
).refine(
  (reconciliations) =>
    reconciliations.every((reconciliation) => reconciliation.disposition !== 'unresolved'),
  'A resolved verifier decision cannot leave a plan obligation unresolved.',
);

const ResolvedPostureReconciliationsSchema = z
  .array(SourcePostureReconciliationSchema)
  .min(1)
  .refine(
    (reconciliations) =>
      reconciliations.every((reconciliation) => reconciliation.disposition !== 'unresolved'),
    'A resolved verifier decision cannot leave a posture assessment unresolved.',
  );

/** Canonical verifier result: accepted claims have a complete independent proof. */
const AcceptedAuditVerificationPayloadSchema = z.strictObject({
  decision: z.literal('accepted'),
  reasonCode: AcceptedReasonCodeSchema,
  claimEvidenceBundles: ClaimEvidenceBundlesSchema,
  contradictionEvidence: z.literal(null),
  inspectedEvidence: z.array(SourceClaimEvidenceSchema).max(0),
  verifiedPlanObligations: PlanObligationReferencesSchema,
  affectedPlanObligations: z.array(PlanObligationReferenceSchema).max(0),
  controlAssessment: ControlAssessmentSchema,
  obligationReconciliations: ResolvedPlanObligationReconciliationsSchema,
  postureReconciliations: ResolvedPostureReconciliationsSchema,
});

/** Canonical verifier result: a negative conclusion retains its counterevidence. */
const RejectedAuditVerificationPayloadSchema = z.strictObject({
  decision: z.literal('rejected'),
  reasonCode: RejectedReasonCodeSchema,
  claimEvidenceBundles: z.literal(null),
  contradictionEvidence: ReconciliationEvidenceSchema,
  inspectedEvidence: z.array(SourceClaimEvidenceSchema).max(0),
  verifiedPlanObligations: z.array(PlanObligationReferenceSchema).max(0),
  affectedPlanObligations: PlanObligationReferencesSchema,
  controlAssessment: z.literal(null),
  obligationReconciliations: ResolvedPlanObligationReconciliationsSchema,
  postureReconciliations: ResolvedPostureReconciliationsSchema,
});

/** Canonical verifier result: no security conclusion, only a typed coverage gap. */
const IncompleteAuditVerificationPayloadSchema = z.strictObject({
  decision: z.literal('incomplete'),
  reasonCode: IncompleteReasonCodeSchema,
  claimEvidenceBundles: z.literal(null),
  contradictionEvidence: z.literal(null),
  inspectedEvidence: z.array(SourceClaimEvidenceSchema),
  verifiedPlanObligations: z.array(PlanObligationReferenceSchema).max(0),
  affectedPlanObligations: z.array(PlanObligationReferenceSchema).max(0),
  controlAssessment: z.literal(null),
  obligationReconciliations: z.array(PlanObligationReconciliationSchema).max(0),
  postureReconciliations: z.array(SourcePostureReconciliationSchema).max(0),
  mapInsufficiencies: EvidenceMapInsufficienciesSchema.optional(),
});

const AuditVerificationResultPayloadSchema = z.discriminatedUnion('decision', [
  AcceptedAuditVerificationPayloadSchema,
  RejectedAuditVerificationPayloadSchema,
  IncompleteAuditVerificationPayloadSchema,
]);

/** Source-minimal runtime result; model-authored rationale ends at materialization. */
export const AuditVerificationResultSchema = AuditVerificationResultPayloadSchema;

/** Canonical terminal fields safe to persist for exact recovery. */
export const PersistedAuditVerificationResultSchema = AuditVerificationResultPayloadSchema;

const AcceptedUnverifiedAuditVerificationResultSchema = z.strictObject({
  decision: z.literal('accepted'),
  reasonCode: AcceptedReasonCodeSchema,
  reason: BoundedTextSchema.min(1),
  claimEvidenceBundles: UnverifiedClaimEvidenceBundlesSchema,
  controlAssessment: UnverifiedControlAssessmentSchema,
  obligationReconciliations: UnverifiedPlanObligationReconciliationsSchema.min(1).refine(
    (reconciliations) =>
      reconciliations.every((reconciliation) => reconciliation.disposition !== 'unresolved'),
    'An accepted verdict cannot leave a plan obligation unresolved.',
  ),
  postureReconciliations: z
    .array(UnverifiedSourcePostureReconciliationSchema)
    .min(1)
    .refine(
      (reconciliations) =>
        reconciliations.every((reconciliation) => reconciliation.disposition !== 'unresolved'),
      'An accepted verdict cannot leave a posture assessment unresolved.',
    ),
});

const RejectedUnverifiedAuditVerificationResultSchema = z.strictObject({
  decision: z.literal('rejected'),
  reasonCode: RejectedReasonCodeSchema,
  reason: BoundedTextSchema.min(1),
  contradictionEvidenceSelections: UnverifiedReconciliationEvidenceSelectionsSchema,
  affectedPlanObligations: PlanObligationReferencesSchema,
  obligationReconciliations: UnverifiedPlanObligationReconciliationsSchema.min(1).refine(
    (reconciliations) =>
      reconciliations.every((reconciliation) => reconciliation.disposition !== 'unresolved'),
    'A rejected verdict cannot leave a plan obligation unresolved.',
  ),
  postureReconciliations: z
    .array(UnverifiedSourcePostureReconciliationSchema)
    .min(1)
    .refine(
      (reconciliations) =>
        reconciliations.every((reconciliation) => reconciliation.disposition !== 'unresolved'),
      'A rejected verdict cannot leave a posture assessment unresolved.',
    ),
});

const IncompleteUnverifiedAuditVerificationResultSchema = z.strictObject({
  decision: z.literal('incomplete'),
  reasonCode: IncompleteReasonCodeSchema,
  reason: BoundedTextSchema.min(1),
  inspectedEvidenceSelections: z.array(UnverifiedEvidenceMapEvidenceSelectionSchema).optional(),
  mapInsufficiencies: EvidenceMapInsufficienciesSchema.optional(),
});

const CanonicalUnverifiedAuditVerificationResultSchema = z.discriminatedUnion('decision', [
  AcceptedUnverifiedAuditVerificationResultSchema,
  RejectedUnverifiedAuditVerificationResultSchema,
  IncompleteUnverifiedAuditVerificationResultSchema,
]);

/**
 * Model-facing verifier result. It carries only the selected decision's
 * semantic data; canonical inactive null/empty fields are owned by the
 * materializer, not by provider output. Casing is normalized once at the
 * model boundary and the strict union rejects cross-branch fields.
 */
export const UnverifiedAuditVerificationResultSchema = z
  .object({
    decision: z.string(),
    reasonCode: z.string(),
  })
  .passthrough()
  .transform((value) => ({
    ...value,
    decision: value.decision.trim().toLowerCase(),
    reasonCode: value.reasonCode.trim().toLowerCase(),
  }))
  .pipe(CanonicalUnverifiedAuditVerificationResultSchema);

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
