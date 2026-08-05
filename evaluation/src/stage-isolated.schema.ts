import { z } from 'zod';
import { AttackPlanSchema } from '../../src/features/attack-planning/index.js';
import {
  ModelCostSummarySchema,
  ModelRouteSchema,
  ModelStageErrorCodeSchema,
  ModelStageObservationSchema,
  ModelStageTraceEventSchema,
  ModelUsageSchema,
  ToolUsageSchema,
} from '../../src/features/model-operations/model-operations.schema.js';
import { IdentifierSchema, Sha256Schema } from '../../src/shared/contracts/core.js';
import {
  ModelIdentifierSchema,
  ModelProviderIdentifierSchema,
} from '../../src/shared/contracts/model-identity.js';
import {
  CorpusVariantSchema,
  ExpectedFindingEvidenceRoleSchema,
  PlanEvaluationProfileSchema,
} from './corpus.schema.js';

/** Evaluator-only measurement boundaries. They are not product workflow stages. */
export const StageIsolatedEvaluationStageSchema = z.enum([
  'planning',
  'evidence-mapping',
  'source-posture',
  'investigation-grounding',
  'verification',
  'full-reviewed-plan-audit',
]);

/**
 * The evaluator-owned scope identity for a reviewed-plan audit. It duplicates
 * no product decision: it seals the exact enabled vector identities and their
 * existing approved scope globs before the normal audit service is entered.
 */
export const StageIsolatedReviewedPlanAuditScopeIdentitySchema = z.strictObject({
  vectorId: IdentifierSchema,
  vectorDigest: Sha256Schema,
  scopeGlobs: z.array(z.string().trim().min(1)).min(1),
});

/**
 * The minimal evaluator-owned input for measuring the normal reviewed-plan
 * audit entrypoint. Paths are dispatch bindings only and never appear in the
 * persisted public projection or in an evaluator expectation.
 */
export const StageIsolatedFullReviewedPlanAuditCanonicalInputSchema = z
  .strictObject({
    stage: z.literal('full-reviewed-plan-audit'),
    targetFingerprint: Sha256Schema,
    contextDigest: Sha256Schema,
    targetRoot: z.string().trim().min(1),
    contextRoot: z.string().trim().min(1).nullable(),
    targetDisplayName: z.string().trim().min(1),
    plan: AttackPlanSchema,
    requiredScopeIdentity: z.array(StageIsolatedReviewedPlanAuditScopeIdentitySchema).min(1),
    runId: IdentifierSchema,
    generatedAt: z.iso.datetime({ offset: true }),
    sessionId: IdentifierSchema,
  })
  .superRefine((input, context) => {
    if (
      input.plan.targetFingerprint !== input.targetFingerprint ||
      input.plan.contextDigest !== input.contextDigest
    ) {
      context.addIssue({
        code: 'custom',
        path: ['plan'],
        message: 'The reviewed plan must bind the exact target and context fingerprints.',
      });
    }
    const enabled = input.plan.vectors.filter((vector) => vector.enabled);
    const expected = enabled.map((vector) => ({
      vectorId: vector.vectorId,
      vectorDigest: vector.vectorDigest,
      scopeGlobs: vector.scopeGlobs,
    }));
    if (JSON.stringify(input.requiredScopeIdentity) !== JSON.stringify(expected)) {
      context.addIssue({
        code: 'custom',
        path: ['requiredScopeIdentity'],
        message:
          'The required scope identity must exactly match every enabled reviewed-plan vector.',
      });
    }
  });

/**
 * A sealed reference to the exact production input made available to one
 * isolated stage. The referenced payload is deliberately outside this
 * source-free contract.
 */
export const StageIsolatedProductInputReferenceSchema = z.strictObject({
  stage: StageIsolatedEvaluationStageSchema,
  referenceId: IdentifierSchema,
  fingerprint: Sha256Schema,
});

/**
 * A sealed evaluator-only reference to the expected outcome. It never enters
 * a product session, repository tool, or product prompt.
 */
export const StageIsolatedExpectedOutcomeReferenceSchema = z.strictObject({
  /** Evaluator-private reference; it never appears in the public projection. */
  privateReferenceId: IdentifierSchema,
  fingerprint: Sha256Schema,
  expectedOutcomeCount: z.int().nonnegative(),
});

/**
 * Exact, source-free identity of one evaluator-owned stage input. The same
 * stage never stands in for a preceding live product-stage result.
 */
export const StageIsolatedEvaluationStagePackSchema = z
  .strictObject({
    schemaVersion: z.literal(4),
    packId: IdentifierSchema,
    stage: StageIsolatedEvaluationStageSchema,
    corpusPackId: IdentifierSchema,
    corpusPackVersion: z.string().trim().min(1).max(32),
    corpusManifestFingerprint: Sha256Schema,
    caseId: IdentifierSchema,
    variant: CorpusVariantSchema,
    repetition: z.int().positive(),
    planProfile: PlanEvaluationProfileSchema,
    /** Directory digest from the corpus manifest; pins the acquired source tree. */
    corpusSourceDigest: Sha256Schema,
    /** Product inventory identity derived from that exact source tree and context. */
    targetFingerprint: Sha256Schema,
    contextDigest: Sha256Schema,
    workflowProtocolFingerprint: Sha256Schema,
    stageProtocolFingerprint: Sha256Schema,
    evaluatorProtocolFingerprint: Sha256Schema,
    provider: ModelProviderIdentifierSchema,
    model: ModelIdentifierSchema,
    route: ModelRouteSchema,
    evaluatorProvider: ModelProviderIdentifierSchema,
    evaluatorModel: ModelIdentifierSchema,
    evaluatorRoute: ModelRouteSchema,
    productInput: StageIsolatedProductInputReferenceSchema,
    expectedOutcome: StageIsolatedExpectedOutcomeReferenceSchema,
  })
  .superRefine((pack, context) => {
    if (pack.productInput.stage !== pack.stage) {
      context.addIssue({
        code: 'custom',
        path: ['productInput', 'stage'],
        message: 'The product input reference must identify the same stage as its stage pack.',
      });
    }
    if (pack.stage === 'full-reviewed-plan-audit' && pack.planProfile !== 'audit-reviewed-plan') {
      context.addIssue({
        code: 'custom',
        path: ['planProfile'],
        message: 'A full reviewed-plan audit stage requires the audit-reviewed-plan profile.',
      });
    }
  });

export const StageIsolatedCompletionStatusSchema = z.enum([
  'completed',
  'incomplete',
  'failed',
  'cancelled',
]);

/** Source-free terminal state for one isolated stage invocation. */
export const StageIsolatedCompletionSchema = z
  .strictObject({
    status: StageIsolatedCompletionStatusSchema,
    errorCode: ModelStageErrorCodeSchema.nullable(),
  })
  .superRefine((completion, context) => {
    if (completion.status === 'completed' && completion.errorCode !== null) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Completed work cannot carry a terminal error code.',
      });
    }
    if (completion.status !== 'completed' && completion.errorCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Non-completed work requires a stable terminal error code.',
      });
    }
  });

export const StageIsolatedValidationStatusSchema = z.enum(['passed', 'failed']);

/** Validation outcome contains stable codes only, never rejected payloads. */
export const StageIsolatedValidationRecordSchema = z
  .strictObject({
    status: StageIsolatedValidationStatusSchema,
    errorCodes: z.array(ModelStageErrorCodeSchema),
  })
  .superRefine((record, context) => {
    if (record.status === 'passed' && record.errorCodes.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['errorCodes'],
        message: 'A passed validation record cannot contain error codes.',
      });
    }
    if (record.status === 'failed' && record.errorCodes.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['errorCodes'],
        message: 'A failed validation record requires at least one stable error code.',
      });
    }
  });

export const StageIsolatedValidationSchema = z.strictObject({
  input: StageIsolatedValidationRecordSchema,
  output: StageIsolatedValidationRecordSchema,
});

/** Aggregate-only proof that the scoped source tools inspected the target. */
export const StageIsolatedToolInspectionSchema = z
  .strictObject({
    scopedManifestEntryCount: z.number().int().nonnegative(),
    inspectionRequired: z.boolean(),
    inspectedWithReadOrGrep: z.boolean(),
    usage: ToolUsageSchema,
  })
  .superRefine((inspection, context) => {
    const inspected =
      inspection.usage.successfulReadFileCallCount > 0 ||
      inspection.usage.successfulGrepFilesCallCount > 0;
    if (inspection.inspectedWithReadOrGrep !== inspected) {
      context.addIssue({
        code: 'custom',
        path: ['inspectedWithReadOrGrep'],
        message: 'Tool inspection must agree with successful repo_read or repo_grep usage.',
      });
    }
    if (inspection.scopedManifestEntryCount === 0 && inspection.inspectionRequired) {
      context.addIssue({
        code: 'custom',
        path: ['inspectionRequired'],
        message: 'An empty scoped manifest cannot require source inspection.',
      });
    }
  });

/** Source-free model cost and timing for an isolated stage. */
export const StageIsolatedTelemetrySchema = z
  .strictObject({
    latencyMs: z.number().int().nonnegative(),
    usage: ModelUsageSchema,
    cost: ModelCostSummarySchema,
    trace: z.array(ModelStageTraceEventSchema),
  })
  .superRefine((telemetry, context) => {
    if (telemetry.cost.totalTokens !== telemetry.usage.inputTokens + telemetry.usage.outputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['cost', 'totalTokens'],
        message: 'Telemetry totalTokens must equal input plus output tokens.',
      });
    }
  });

export const StageIsolatedSemanticOutcomeStatusSchema = z.enum([
  'matched-expected-outcome',
  'missing-expected-outcome',
  'unexpected-outcome',
  'inconclusive',
  'not-applicable',
]);

/** Evaluator-only outcome identifiers; no model-authored explanation is retained here. */
export const StageIsolatedSemanticOutcomeSchema = z
  .strictObject({
    status: StageIsolatedSemanticOutcomeStatusSchema,
    matchedExpectedOutcomeIds: z.array(IdentifierSchema),
    missingExpectedOutcomeIds: z.array(IdentifierSchema),
    notApplicableExpectedOutcomeIds: z.array(IdentifierSchema),
    unexpectedOutcomeIds: z.array(IdentifierSchema),
  })
  .superRefine((outcome, context) => {
    const expected = [
      ...outcome.matchedExpectedOutcomeIds,
      ...outcome.missingExpectedOutcomeIds,
      ...outcome.notApplicableExpectedOutcomeIds,
    ];
    if (new Set(expected).size !== expected.length) {
      context.addIssue({
        code: 'custom',
        message: 'Expected outcome identities must be unique and disjoint.',
      });
    }
    if (new Set(outcome.unexpectedOutcomeIds).size !== outcome.unexpectedOutcomeIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['unexpectedOutcomeIds'],
        message: 'Unexpected outcome identities must be unique.',
      });
    }
    if (outcome.unexpectedOutcomeIds.some((id) => expected.includes(id))) {
      context.addIssue({
        code: 'custom',
        message: 'Expected and unexpected outcome identities must be disjoint.',
      });
    }
  });

/** A source location without source text, snippet, tool payload, or model output. */
/** Source-free evaluator-local role references; source locations never persist. */
export const StageIsolatedEvidenceRoleBundleSchema = z
  .strictObject({
    expectedOutcomeId: IdentifierSchema,
    roles: z.array(
      z.strictObject({
        role: ExpectedFindingEvidenceRoleSchema,
        localizationIds: z.array(IdentifierSchema).min(1),
      }),
    ),
  })
  .superRefine((bundle, context) => {
    const roles = bundle.roles.map((role) => role.role);
    if (new Set(roles).size !== roles.length) {
      context.addIssue({
        code: 'custom',
        path: ['roles'],
        message: 'An expected outcome may have each evidence role only once.',
      });
    }
    for (const [index, role] of bundle.roles.entries()) {
      if (new Set(role.localizationIds).size !== role.localizationIds.length) {
        context.addIssue({
          code: 'custom',
          path: ['roles', index, 'localizationIds'],
          message: 'Localization identities must be unique within one role.',
        });
      }
    }
  });

/**
 * One source-free record for evaluator-only stage measurement. It retains
 * result metadata, never prompts, source, repository-tool payloads, or raw
 * model output.
 */
export const StageIsolatedEvaluationStageForensicResultSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    pack: StageIsolatedEvaluationStagePackSchema,
    completion: StageIsolatedCompletionSchema,
    validation: StageIsolatedValidationSchema,
    toolInspection: StageIsolatedToolInspectionSchema,
    telemetry: StageIsolatedTelemetrySchema,
    /** Exact source-free observations retain each wrapper's independent trace and terminal code. */
    modelObservations: z.array(ModelStageObservationSchema),
    productProjectionFingerprint: Sha256Schema.nullable(),
    rubricFingerprint: Sha256Schema,
    evaluatorObservation: ModelStageObservationSchema.nullable(),
    semanticOutcome: StageIsolatedSemanticOutcomeSchema,
    evidenceRoleBundles: z.array(StageIsolatedEvidenceRoleBundleSchema),
  })
  .superRefine((result, context) => {
    if (
      result.completion.status === 'completed' &&
      (result.validation.input.status !== 'passed' || result.validation.output.status !== 'passed')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validation'],
        message: 'Completed work requires both input and output validation to pass.',
      });
    }
    if (
      result.completion.status === 'completed' &&
      result.toolInspection.inspectionRequired &&
      !result.toolInspection.inspectedWithReadOrGrep
    ) {
      context.addIssue({
        code: 'custom',
        path: ['toolInspection', 'inspectedWithReadOrGrep'],
        message: 'Completed inspected work requires successful repo_read or repo_grep usage.',
      });
    }
    const expectedIds = [
      ...result.semanticOutcome.matchedExpectedOutcomeIds,
      ...result.semanticOutcome.missingExpectedOutcomeIds,
      ...result.semanticOutcome.notApplicableExpectedOutcomeIds,
    ];
    if (
      result.semanticOutcome.status === 'matched-expected-outcome' &&
      expectedIds.length !== result.pack.expectedOutcome.expectedOutcomeCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['semanticOutcome'],
        message: 'Semantic outcome must close the exact private expected-outcome denominator.',
      });
    }
    if (result.completion.status === 'completed' && result.productProjectionFingerprint === null) {
      context.addIssue({
        code: 'custom',
        path: ['productProjectionFingerprint'],
        message: 'A completed product stage requires its exact semantic projection binding.',
      });
    }
    const bundleIds = result.evidenceRoleBundles.map((bundle) => bundle.expectedOutcomeId);
    if (
      new Set(bundleIds).size !== bundleIds.length ||
      bundleIds.some((id) => !result.semanticOutcome.matchedExpectedOutcomeIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceRoleBundles'],
        message: 'Role bundles must be unique and belong only to matched expected outcomes.',
      });
    }
  });

/** Count-only public identity; private expectation and product-input references are omitted. */
export const StageIsolatedEvaluationStagePublicPackSchema = z.strictObject({
  schemaVersion: z.literal(4),
  packId: IdentifierSchema,
  stage: StageIsolatedEvaluationStageSchema,
  corpusPackId: IdentifierSchema,
  corpusPackVersion: z.string().trim().min(1).max(32),
  corpusManifestFingerprint: Sha256Schema,
  caseId: IdentifierSchema,
  variant: CorpusVariantSchema,
  repetition: z.int().positive(),
  planProfile: PlanEvaluationProfileSchema,
  corpusSourceDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  workflowProtocolFingerprint: Sha256Schema,
  stageProtocolFingerprint: Sha256Schema,
  evaluatorProtocolFingerprint: Sha256Schema,
  provider: ModelProviderIdentifierSchema,
  model: ModelIdentifierSchema,
  route: ModelRouteSchema,
  evaluatorProvider: ModelProviderIdentifierSchema,
  evaluatorModel: ModelIdentifierSchema,
  evaluatorRoute: ModelRouteSchema,
  expectedOutcomeCount: z.int().nonnegative(),
});

export const StageIsolatedSemanticOutcomeCountsSchema = z.strictObject({
  matchedExpectedOutcomeCount: z.int().nonnegative(),
  missingExpectedOutcomeCount: z.int().nonnegative(),
  notApplicableExpectedOutcomeCount: z.int().nonnegative(),
  unexpectedOutcomeCount: z.int().nonnegative(),
});

export const StageIsolatedEvidenceLocalizationCountsSchema = z.strictObject({
  matchedExpectedOutcomeWithRoleBundleCount: z.int().nonnegative(),
  roleBundleCount: z.int().nonnegative(),
  roleCount: z.int().nonnegative(),
  locationCount: z.int().nonnegative(),
});

/** Source-free public projection. It deliberately contains no locations or evaluator expectation IDs. */
export const StageIsolatedEvaluationStagePublicResultSchema = z.strictObject({
  schemaVersion: z.literal(3),
  pack: StageIsolatedEvaluationStagePublicPackSchema,
  completion: StageIsolatedCompletionSchema,
  validation: StageIsolatedValidationSchema,
  toolInspection: StageIsolatedToolInspectionSchema,
  telemetry: StageIsolatedTelemetrySchema,
  modelObservations: z.array(ModelStageObservationSchema),
  evaluatorObservation: ModelStageObservationSchema.nullable(),
  semanticOutcome: StageIsolatedSemanticOutcomeCountsSchema,
  localization: StageIsolatedEvidenceLocalizationCountsSchema,
});

export type StageIsolatedEvaluationStage = z.infer<typeof StageIsolatedEvaluationStageSchema>;
export type StageIsolatedReviewedPlanAuditScopeIdentity = z.infer<
  typeof StageIsolatedReviewedPlanAuditScopeIdentitySchema
>;
export type StageIsolatedFullReviewedPlanAuditCanonicalInput = z.infer<
  typeof StageIsolatedFullReviewedPlanAuditCanonicalInputSchema
>;
export type StageIsolatedProductInputReference = z.infer<
  typeof StageIsolatedProductInputReferenceSchema
>;
export type StageIsolatedExpectedOutcomeReference = z.infer<
  typeof StageIsolatedExpectedOutcomeReferenceSchema
>;
export type StageIsolatedEvaluationStagePack = z.infer<
  typeof StageIsolatedEvaluationStagePackSchema
>;
export type StageIsolatedCompletion = z.infer<typeof StageIsolatedCompletionSchema>;
export type StageIsolatedValidationRecord = z.infer<typeof StageIsolatedValidationRecordSchema>;
export type StageIsolatedValidation = z.infer<typeof StageIsolatedValidationSchema>;
export type StageIsolatedToolInspection = z.infer<typeof StageIsolatedToolInspectionSchema>;
export type StageIsolatedTelemetry = z.infer<typeof StageIsolatedTelemetrySchema>;
export type StageIsolatedSemanticOutcome = z.infer<typeof StageIsolatedSemanticOutcomeSchema>;
export type StageIsolatedEvidenceRoleBundle = z.infer<typeof StageIsolatedEvidenceRoleBundleSchema>;
export type StageIsolatedEvaluationStageForensicResult = z.infer<
  typeof StageIsolatedEvaluationStageForensicResultSchema
>;
export type StageIsolatedEvaluationStagePublicPack = z.infer<
  typeof StageIsolatedEvaluationStagePublicPackSchema
>;
export type StageIsolatedSemanticOutcomeCounts = z.infer<
  typeof StageIsolatedSemanticOutcomeCountsSchema
>;
export type StageIsolatedEvidenceLocalizationCounts = z.infer<
  typeof StageIsolatedEvidenceLocalizationCountsSchema
>;
export type StageIsolatedEvaluationStagePublicResult = z.infer<
  typeof StageIsolatedEvaluationStagePublicResultSchema
>;
