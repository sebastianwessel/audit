import { z } from 'zod';
import {
  MaxParallelVectorsSchema,
  VerificationModeSchema,
} from '../../platform/configuration/environment.js';
import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import {
  BoundedTextSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  RelativePathSchema,
  SchemaVersion,
  Sha256Schema,
} from '../../shared/contracts/core.js';
import { AttackPlanSchema, DraftAttackVectorSchema } from '../attack-planning/plan.schema.js';
import {
  CandidateIntegrityRejectionLedgerSchema,
  FindingAdmissionFunnelSchema,
  HypothesisGroundingFunnelSchema,
  VectorCoverageSchema,
} from '../audit-execution/audit.schema.js';
import { ModelRunObservationSchema } from '../model-operations/model-operations.schema.js';

import { FixtureDifficultySchema, LanguageTagSchema } from './evaluation.schema.js';
import { HoldoutAttestationReferenceSchema } from './holdout-attestation.schema.js';
import {
  ProviderCommandCheckpointStatusSchema,
  validateProviderCommandCheckpointLifecycle,
} from './provider-command-checkpoint-lifecycle.schema.js';

export const CorpusSplitSchema = z.enum(['development', 'test', 'private-holdout']);
/**
 * States what the selected corpus split can support. This is deliberately
 * independent from the workflow finding gate, which only evaluates the run.
 */
export const EvaluationEvidenceQualificationSchema = z.enum([
  'diagnostic',
  'development-pilot',
  'private-holdout',
]);
export const CorpusVariantSchema = z.enum(['vulnerable', 'patched', 'benign']);
export const CorpusVariantModeSchema = z.enum(['paired', 'single']);
export const AdjudicationStatusSchema = z.enum(['provisional', 'dual-reviewed']);
/** Separates real-world quality evidence from synthetic and semantic regression fixtures. */
export const CorpusEvidenceOriginSchema = z.enum([
  'real-world',
  'synthetic',
  'semantic-regression',
]);
/**
 * Evaluator-only sampling labels. They describe the source-supported control
 * a reviewed pair exercises; they are never model input or finding rules.
 */
export const CorpusControlFamilySchema = z.enum([
  'dynamic-state-ownership',
  'authorization-tenancy',
  'validation-canonicalization',
  'sensitive-data-handling',
  'unsafe-operation-bounds',
  'injection-outbound-boundary',
]);

export const CorpusControlFamiliesSchema = z
  .array(CorpusControlFamilySchema)
  .min(1)
  .max(CorpusControlFamilySchema.options.length)
  .refine((families) => new Set(families).size === families.length, {
    message: 'Control-family labels must be unique.',
  });

export const CorpusDatasetSchema = z.strictObject({
  datasetId: IdentifierSchema,
  title: z.string().trim().min(1).max(160),
  sourceUrl: z.url(),
  revision: z.string().trim().min(1).max(160),
  license: z.string().trim().min(1).max(160),
  retrievedAt: IsoDateTimeSchema,
  attribution: BoundedTextSchema.min(1).max(2_000),
});

export const AnswerKeyFindingCoverageSchema = z.enum(['targeted', 'exhaustive']);
/** The source-free coverage boundary preserved with a complete evaluation run. */
export const FindingCoverageClassSchema = z.enum(['targeted', 'exhaustive', 'mixed']);
export const ExpectedFindingEvidenceRoleSchema = z.enum(['operation', 'unsafe-condition']);

export const ExpectedFindingSourceRangeSchema = z
  .strictObject({
    path: RelativePathSchema,
    startLine: z.int().positive(),
    endLine: z.int().positive(),
  })
  .refine((range) => range.endLine >= range.startLine, {
    message: 'An expected source range end line must not precede its start line.',
  });

export const CorpusExpectedFindingEvidenceRoleSchema = z
  .strictObject({
    role: ExpectedFindingEvidenceRoleSchema,
    notApplicable: z.boolean(),
    ranges: z.array(ExpectedFindingSourceRangeSchema),
  })
  .superRefine((entry, context) => {
    if (entry.notApplicable === entry.ranges.length > 0) {
      context.addIssue({
        code: 'custom',
        message:
          'An expected evidence role is either not applicable or has one or more accepted ranges.',
      });
    }
  });

export const CorpusExpectedFindingSchema = z
  .strictObject({
    findingId: IdentifierSchema,
    staticReviewApplicable: z.boolean(),
    evidenceRoles: z.array(CorpusExpectedFindingEvidenceRoleSchema).length(2),
  })
  .superRefine((finding, context) => {
    const roles = finding.evidenceRoles.map((entry) => entry.role);
    if (
      new Set(roles).size !== roles.length ||
      !ExpectedFindingEvidenceRoleSchema.options.every((role) => roles.includes(role))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceRoles'],
        message: 'Expected findings require exactly one operation and one unsafe-condition role.',
      });
    }
  });

const CorpusRelevantPathsSchema = z
  .array(RelativePathSchema)
  .min(1)
  .refine((paths) => new Set(paths).size === paths.length, {
    message: 'Relevant paths must be unique.',
  });

/**
 * Evaluator-only review unit for planning measurement. A scenario remains
 * independent from model-visible source and does not add a product rule: the
 * scorer only measures whether the generated plan scoped any vector to the
 * scenario paths. It deliberately makes no semantic-alignment claim: a plan's
 * words are reviewed by humans, not reduced to a category token.
 */
export const ExpectedPlanScenarioSchema = z.strictObject({
  scenarioId: IdentifierSchema,
  relevantPaths: CorpusRelevantPathsSchema,
  expectedFindingIds: z.array(IdentifierSchema).min(1),
});

const ExpectedPlanScenariosSchema = z
  .array(ExpectedPlanScenarioSchema)
  .min(1)
  .superRefine((scenarios, context) => {
    const identifiers = scenarios.map((scenario) => scenario.scenarioId);
    if (new Set(identifiers).size !== identifiers.length) {
      context.addIssue({
        code: 'custom',
        message: 'Expected planning scenario identifiers must be unique.',
      });
    }
  });

const CorpusExpectedFindingsSchema = z
  .array(CorpusExpectedFindingSchema)
  .refine(
    (findings) =>
      new Set(
        findings.map((finding) =>
          [
            finding.findingId,
            ...finding.evidenceRoles.flatMap((role) => [
              role.role,
              role.notApplicable,
              ...role.ranges.flatMap((range) => [range.path, range.startLine, range.endLine]),
            ]),
            finding.staticReviewApplicable,
          ].join('\0'),
        ),
      ).size === findings.length,
    { message: 'Expected findings must be unique.' },
  );

/** Evaluator-only independent judgment; it is never mounted into an agent target view. */
export const CorpusIndependentReviewSchema = z.strictObject({
  reviewer: z.string().trim().min(1).max(160),
  reviewerKind: z.literal('human'),
  reviewedAt: IsoDateTimeSchema,
  decision: z.enum(['include', 'exclude']),
  findingCoverage: AnswerKeyFindingCoverageSchema,
  expectedPlanScenarios: ExpectedPlanScenariosSchema,
  expectedFindings: CorpusExpectedFindingsSchema,
  patchedExpectation: z.enum(['no-matching-finding', 'not-applicable']),
  staticReviewApplicable: z.boolean(),
  notes: BoundedTextSchema.min(1).max(4_000),
});

export const CorpusReviewResolutionSchema = z.strictObject({
  resolver: z.string().trim().min(1).max(160),
  resolvedAt: IsoDateTimeSchema,
  decision: z.enum(['include', 'exclude']),
  notes: BoundedTextSchema.min(1).max(4_000),
});

export const CorpusAnswerKeySchema = z
  .strictObject({
    schemaVersion: z.literal(5),
    caseId: IdentifierSchema,
    findingCoverage: AnswerKeyFindingCoverageSchema,
    expectedPlanScenarios: ExpectedPlanScenariosSchema,
    expectedFindings: CorpusExpectedFindingsSchema,
    patchedExpectation: z.enum(['no-matching-finding', 'not-applicable']),
    staticReviewApplicable: z.boolean(),
    adjudicationStatus: AdjudicationStatusSchema,
    reviewers: z.array(z.string().trim().min(1).max(160)).min(1).max(2),
    independentReviews: z.array(CorpusIndependentReviewSchema).min(1).max(2).optional(),
    resolution: CorpusReviewResolutionSchema.optional(),
    notes: BoundedTextSchema.min(1).max(4_000),
  })
  .superRefine((entry, context) => {
    for (const scenario of entry.expectedPlanScenarios) {
      const grounded = scenario.expectedFindingIds.every((findingId) =>
        entry.expectedFindings.some(
          (finding) =>
            finding.findingId === findingId &&
            finding.evidenceRoles.some((role) =>
              role.ranges.some((range) => scenario.relevantPaths.includes(range.path)),
            ),
        ),
      );
      if (!grounded) {
        context.addIssue({
          code: 'custom',
          path: ['expectedPlanScenarios'],
          message:
            'Each expected planning scenario requires its declared expected finding on one of its relevant paths.',
        });
      }
    }
    if (
      entry.adjudicationStatus === 'dual-reviewed' &&
      (entry.reviewers.length !== 2 ||
        new Set(entry.reviewers).size !== 2 ||
        entry.independentReviews === undefined ||
        entry.independentReviews.length !== 2 ||
        new Set(entry.independentReviews.map((review) => review.reviewer)).size !== 2 ||
        !entry.independentReviews.every((review) => entry.reviewers.includes(review.reviewer)))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Dual-reviewed answer keys require two matching independent review records.',
        path: ['reviewers'],
      });
    }
    if (
      entry.adjudicationStatus === 'dual-reviewed' &&
      entry.independentReviews !== undefined &&
      !entry.independentReviews.every(
        (review) =>
          review.decision === 'include' && reviewJudgmentKey(review) === reviewJudgmentKey(entry),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Dual-reviewed answer keys require matching include judgments.',
        path: ['independentReviews'],
      });
    }
    if (
      entry.adjudicationStatus === 'dual-reviewed' &&
      (!entry.staticReviewApplicable || entry.expectedFindings.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Dual-reviewed answer keys require source-only applicability and one expected vulnerable finding.',
        path: ['staticReviewApplicable'],
      });
    }
  });

function reviewJudgmentKey(
  judgment: z.output<typeof CorpusIndependentReviewSchema> | z.output<typeof CorpusAnswerKeySchema>,
): string {
  const decision = 'decision' in judgment ? judgment.decision : 'include';
  return JSON.stringify({
    decision,
    findingCoverage: judgment.findingCoverage,
    expectedPlanScenarios: judgment.expectedPlanScenarios
      .map((scenario) => ({
        scenarioId: scenario.scenarioId,
        relevantPaths: [...scenario.relevantPaths].sort(),
        expectedFindingIds: [...scenario.expectedFindingIds].sort(),
      }))
      .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId)),
    expectedFindings: judgment.expectedFindings
      .map((finding) =>
        [
          finding.findingId,
          ...finding.evidenceRoles.flatMap((role) => [
            role.role,
            role.notApplicable,
            ...role.ranges.flatMap((range) => [range.path, range.startLine, range.endLine]),
          ]),
          finding.staticReviewApplicable,
        ].join('\0'),
      )
      .sort(),
    patchedExpectation: judgment.patchedExpectation,
    staticReviewApplicable: judgment.staticReviewApplicable,
  });
}

/** Trusted plan guidance is evaluator-only and contains no expected location or answer data. */
export const ReviewedPlanFixtureSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  caseId: IdentifierSchema,
  reviewer: z.string().trim().min(1).max(160),
  reviewedAt: IsoDateTimeSchema,
  notes: BoundedTextSchema.min(1).max(2_000),
  vectors: z.array(DraftAttackVectorSchema).min(1),
});

export const PlanEvaluationProfileSchema = z.enum(['generated-plan', 'reviewed-plan']);
/** Separates step-1 planning evidence from the normal plan-plus-audit workflow. */
export const EvaluationMeasurementScopeSchema = z.enum(['full-workflow', 'planning-only']);

export const CorpusCaseSchema = z
  .strictObject({
    caseId: IdentifierSchema,
    datasetId: IdentifierSchema,
    projectId: IdentifierSchema,
    repositoryUrl: z.url(),
    vulnerableRevision: z.string().trim().min(1).max(160),
    patchedRevision: z.string().trim().min(1).max(160).optional(),
    language: LanguageTagSchema,
    difficulty: FixtureDifficultySchema,
    split: CorpusSplitSchema,
    evidenceOrigin: CorpusEvidenceOriginSchema,
    controlFamilies: CorpusControlFamiliesSchema,
    variantMode: CorpusVariantModeSchema,
    sourceDirectories: z.strictObject({
      vulnerable: RelativePathSchema,
      patched: RelativePathSchema.optional(),
      benign: RelativePathSchema.optional(),
    }),
    sourceDigests: z.strictObject({
      vulnerable: Sha256Schema,
      patched: Sha256Schema.optional(),
      benign: Sha256Schema.optional(),
    }),
    contextDirectory: RelativePathSchema.optional(),
    answerKeyPath: RelativePathSchema,
    reviewedPlanPath: RelativePathSchema,
    transformedContentDigest: Sha256Schema,
  })
  .superRefine((entry, context) => {
    if (
      entry.variantMode === 'paired' &&
      (entry.patchedRevision === undefined ||
        entry.sourceDirectories.patched === undefined ||
        entry.sourceDigests.patched === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Paired cases require patched revision, source directory, and digest.',
        path: ['variantMode'],
      });
    }
    if (entry.variantMode === 'single' && entry.sourceDirectories.patched !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Single cases cannot declare a patched directory.',
        path: ['sourceDirectories', 'patched'],
      });
    }
  });

export const CorpusPackManifestSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  createdAt: IsoDateTimeSchema,
  datasets: z.array(CorpusDatasetSchema).min(1),
  cases: z.array(CorpusCaseSchema).min(1),
  redistributionDecision: z.enum(['metadata-only', 'source-included-with-license']),
  manifestDigest: Sha256Schema,
});

export const CorpusImportRequestSchema = z.strictObject({
  sourceRoot: z.string().trim().min(1).max(1_024),
  outputRoot: z.string().trim().min(1).max(1_024),
  importedAt: IsoDateTimeSchema,
});

export const CorpusContentRecordSchema = z.strictObject({
  relativePath: RelativePathSchema,
  digest: Sha256Schema,
});

export const ImportedCorpusManifestSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  sourceManifestDigest: Sha256Schema,
  importedAt: IsoDateTimeSchema,
  content: z.array(CorpusContentRecordSchema).min(1),
});

export const PlanScoreSchema = z.strictObject({
  /** Source-only-applicable scenarios; static-review-inapplicable scenarios are neutral. */
  expectedScenarioCount: z.int().nonnegative(),
  scopedScenarioCount: z.int().nonnegative(),
  notApplicableScenarioCount: z.int().nonnegative(),
  relevantPathCoverage: z.number().min(0).max(1).nullable(),
  generatedVectorCount: z.int().nonnegative(),
});

export const FindingScoreSchema = z.strictObject({
  truePositives: z.int().nonnegative(),
  falsePositives: z.int().nonnegative(),
  falseNegatives: z.int().nonnegative(),
  findingPrecision: z.number().min(0).max(1).nullable(),
  findingRecall: z.number().min(0).max(1).nullable(),
  findingF1: z.number().min(0).max(1).nullable(),
  /** Expected findings excluded because static source review cannot assess them. */
  notApplicableExpectedFindingCount: z.int().nonnegative(),
  unnecessaryVectorCount: z.int().nonnegative(),
  matchedLocalizedCount: z.int().nonnegative(),
  matchedMislocalizedCount: z.int().nonnegative(),
  unmatchedAdjudicatedFalsePositiveCount: z.int().nonnegative(),
  unmatchedUnadjudicatedCount: z.int().nonnegative(),
  patchedMatchingFindingCount: z.int().nonnegative(),
  localizationAccuracy: z.number().min(0).max(1).nullable(),
  pairedPersistence: z.number().min(0).max(1).nullable(),
});

/** Source-free evaluator diagnostic; it cannot influence product admission or scores. */
export const FirstIncompleteEvidenceStageSchema = z.enum([
  'not-applicable',
  'planning-scope',
  'evidence-mapping',
  'source-posture',
  'investigation',
  'candidate-grounding',
  'verification',
  'terminal',
  'complete',
]);

/**
 * Evaluator-only derived trace. It deliberately retains neither an answer-key
 * source location nor any product/model identity below the expected role.
 */
export const ExpectedEvidenceRoleTraceSchema = z.strictObject({
  findingId: IdentifierSchema,
  role: ExpectedFindingEvidenceRoleSchema,
  planScoped: z.boolean(),
  mapperSelected: z.boolean(),
  postureReconciled: z.boolean(),
  discoverySeeded: z.boolean(),
  groundingSelected: z.boolean(),
  verifierSelected: z.boolean(),
  terminalCompleted: z.boolean(),
  firstIncompleteStage: FirstIncompleteEvidenceStageSchema,
});

export const EvidenceStageCoverageSchema = z.strictObject({
  expectedRoleCount: z.int().nonnegative(),
  mappedLocationCount: z.int().nonnegative(),
  groundedRoleCount: z.int().nonnegative(),
  verifiedRoleCount: z.int().nonnegative(),
  /** First normal evidence stage that did not retain every expected role overlap. */
  firstIncompleteStage: FirstIncompleteEvidenceStageSchema,
  /** Evaluator-only derived stage booleans; never model input or a score. */
  roleTraces: z.array(ExpectedEvidenceRoleTraceSchema).optional(),
});

export const EvaluationTrialSchema = z.strictObject({
  caseId: IdentifierSchema,
  variant: CorpusVariantSchema,
  repetition: z.int().positive(),
  status: z.enum(['completed', 'incomplete', 'failed', 'cancelled']),
  /** Exact evaluator-owned reviewed-plan fixture identity; null for generated-plan trials. */
  reviewedPlanFingerprint: Sha256Schema.nullable(),
  planScore: PlanScoreSchema.nullable(),
  findingScore: FindingScoreSchema.nullable(),
  /** Evaluator-only answer-key diagnostic, never provider/model input or a score. */
  stageEvidenceCoverage: EvidenceStageCoverageSchema.optional(),
  /** Diagnostic-only match score for source-backed human-review items; never a release gate. */
  reviewRequiredScore: FindingScoreSchema.nullable().optional(),
  planKeys: z.array(z.string().min(1)),
  findingKeys: z.array(z.string().min(1)),
  reviewRequiredKeys: z.array(z.string().min(1)).optional(),
  durationMs: z.int().nonnegative(),
  errorCode: z.string().trim().min(1).max(64).nullable(),
  /** Source-free audited vector state; required whenever an audit returned. */
  vectorCoverage: z.array(VectorCoverageSchema).min(1).optional(),
  modelObservation: ModelRunObservationSchema.nullable().optional(),
  /** Present only when the audit reached a terminal report. */
  admissionFunnel: FindingAdmissionFunnelSchema.optional(),
  /** Source-free discovery/grounding attrition when the audit reached a terminal report. */
  hypothesisGroundingFunnel: HypothesisGroundingFunnelSchema.optional(),
  candidateIntegrityRejections: CandidateIntegrityRejectionLedgerSchema.optional(),
});

export const CheckpointedEvaluationTrialSchema = z.strictObject({
  trial: EvaluationTrialSchema,
  attempts: z.int().positive(),
});

/** Source-free, exact-bound generated-plan predecessor for evaluator retry. */
export const EvaluationGeneratedPlanCheckpointSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    trialId: IdentifierSchema,
    configFingerprint: Sha256Schema,
    targetFingerprint: Sha256Schema,
    contextDigest: Sha256Schema,
    plan: AttackPlanSchema,
    modelObservation: ModelRunObservationSchema,
    savedAt: IsoDateTimeSchema,
  })
  .superRefine((checkpoint, context) => {
    if (checkpoint.plan.targetFingerprint !== checkpoint.targetFingerprint) {
      context.addIssue({
        code: 'custom',
        path: ['plan', 'targetFingerprint'],
        message: 'Generated-plan checkpoint target binding must match its plan.',
      });
    }
    if (checkpoint.plan.contextDigest !== checkpoint.contextDigest) {
      context.addIssue({
        code: 'custom',
        path: ['plan', 'contextDigest'],
        message: 'Generated-plan checkpoint context binding must match its plan.',
      });
    }
  });

/** Exact evaluator-only binding for resumable derived expected-role trace state. */
export const ExpectedEvidenceTraceCheckpointBindingSchema = z.strictObject({
  trialId: IdentifierSchema,
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  provider: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(160),
  verificationRouteFingerprint: Sha256Schema,
  promptProtocolFingerprint: Sha256Schema,
  answerKeyDigest: Sha256Schema,
});

/** Separate evaluator-work artifact; raw answer-key locations and discovery seeds are excluded. */
export const ExpectedEvidenceTraceCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: ExpectedEvidenceTraceCheckpointBindingSchema,
  roleTraces: z.array(ExpectedEvidenceRoleTraceSchema),
  savedAt: IsoDateTimeSchema,
});

export const ProviderEvaluationCheckpointErrorCodeSchema = z.enum([
  'provider-cancelled',
  'evaluation-run-failed',
]);

export const ProviderEvaluationCheckpointSchema = z
  .strictObject({
    schemaVersion: z.literal(7),
    runId: IdentifierSchema,
    configFingerprint: Sha256Schema,
    packId: IdentifierSchema,
    packVersion: z.string().trim().min(1).max(32),
    corpusManifestDigest: Sha256Schema,
    populationDigest: Sha256Schema,
    benchmarkProtocolFingerprint: Sha256Schema,
    provider: z.string().trim().min(1).max(160),
    model: z.string().trim().min(1).max(160),
    verificationMode: VerificationModeSchema,
    verificationRouteFingerprint: Sha256Schema,
    selectedSplit: CorpusSplitSchema,
    /** Optional evaluator-only case selection for a bounded provider experiment. */
    caseIdFilter: IdentifierSchema.optional(),
    /** Required for newly written private-holdout checkpoints. */
    holdoutAttestation: HoldoutAttestationReferenceSchema.optional(),
    repetitions: z.int().positive(),
    planProfile: PlanEvaluationProfileSchema,
    measurementScope: EvaluationMeasurementScopeSchema.default('full-workflow'),
    executionBudget: HarnessExecutionConfigurationSchema,
    maxParallelVectors: MaxParallelVectorsSchema,
    status: ProviderCommandCheckpointStatusSchema,
    errorCode: ProviderEvaluationCheckpointErrorCodeSchema.nullable(),
    startedAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    trials: z.array(CheckpointedEvaluationTrialSchema),
  })
  .superRefine((checkpoint, context) =>
    validateProviderCommandCheckpointLifecycle(checkpoint, context, {
      cancelled: 'provider-cancelled',
      failed: 'evaluation-run-failed',
    }),
  );

export const ReliabilitySummarySchema = z.strictObject({
  completedTrials: z.int().nonnegative(),
  incompleteTrials: z.int().nonnegative(),
  failedTrials: z.int().nonnegative(),
  cancelledTrials: z.int().nonnegative(),
  completionRate: z.number().min(0).max(1).nullable(),
  planJaccard: z.number().min(0).max(1).nullable(),
  findingJaccard: z.number().min(0).max(1).nullable(),
  findingRecallMedian: z.number().min(0).max(1).nullable(),
  findingRecallMinimum: z.number().min(0).max(1).nullable(),
  durationMsMedian: z.number().nonnegative().nullable(),
  durationMsP95: z.number().nonnegative().nullable(),
  modelObservation: ModelRunObservationSchema.nullable().optional(),
});

export const EvaluationBaselineSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  corpusManifestDigest: Sha256Schema,
  populationDigest: Sha256Schema,
  benchmarkProtocolFingerprint: Sha256Schema,
  /** A baseline with a false-positive threshold needs exhaustive finding labels. */
  findingCoverage: z.literal('exhaustive'),
  planProfile: PlanEvaluationProfileSchema,
  verificationMode: VerificationModeSchema,
  verificationRouteFingerprint: Sha256Schema,
  reviewedAt: IsoDateTimeSchema,
  reviewNote: BoundedTextSchema.min(1).max(2_000),
  requiredCaseIds: z.array(IdentifierSchema).min(1),
  thresholds: z.strictObject({
    minimumCompletionRate: z.number().min(0).max(1),
    minimumVulnerableFindingRecall: z.number().min(0).max(1),
    maximumNonVulnerableFalsePositives: z.int().nonnegative(),
  }),
});

export const RealWorldEvaluationRunSchema = z.strictObject({
  schemaVersion: z.literal(7),
  runId: IdentifierSchema,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  corpusManifestDigest: Sha256Schema,
  populationDigest: Sha256Schema,
  benchmarkProtocolFingerprint: Sha256Schema,
  mode: z.enum(['deterministic', 'provider']),
  provider: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(160),
  verificationMode: VerificationModeSchema,
  verificationRouteFingerprint: Sha256Schema,
  selectedSplit: CorpusSplitSchema,
  /** Optional evaluator-only case selection for a bounded provider experiment. */
  caseIdFilter: IdentifierSchema.optional(),
  /** Derived from the selected pack's answer keys; it constrains score interpretation. */
  findingCoverage: FindingCoverageClassSchema,
  /** Required for newly written private-holdout reports. */
  holdoutAttestation: HoldoutAttestationReferenceSchema.optional(),
  evidenceQualification: EvaluationEvidenceQualificationSchema,
  repetitions: z.int().positive(),
  planProfile: PlanEvaluationProfileSchema,
  measurementScope: EvaluationMeasurementScopeSchema.default('full-workflow'),
  executionBudget: HarnessExecutionConfigurationSchema,
  maxParallelVectors: MaxParallelVectorsSchema,
  promptProtocolFingerprint: Sha256Schema,
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  trials: z.array(EvaluationTrialSchema).min(1),
  reliability: ReliabilitySummarySchema,
  safetyViolations: z.int().nonnegative(),
  gatePassed: z.boolean(),
});

export type CorpusAnswerKey = z.infer<typeof CorpusAnswerKeySchema>;
export type FindingCoverageClass = z.infer<typeof FindingCoverageClassSchema>;
export type ReviewedPlanFixture = z.infer<typeof ReviewedPlanFixtureSchema>;
export type PlanEvaluationProfile = z.infer<typeof PlanEvaluationProfileSchema>;
export type EvaluationMeasurementScope = z.infer<typeof EvaluationMeasurementScopeSchema>;
export type CorpusCase = z.infer<typeof CorpusCaseSchema>;
export type CorpusControlFamily = z.infer<typeof CorpusControlFamilySchema>;
export type CorpusEvidenceOrigin = z.infer<typeof CorpusEvidenceOriginSchema>;
export type CorpusImportRequest = z.infer<typeof CorpusImportRequestSchema>;
export type ImportedCorpusManifest = z.infer<typeof ImportedCorpusManifestSchema>;
export type CorpusPackManifest = z.infer<typeof CorpusPackManifestSchema>;
export type CorpusSplit = z.infer<typeof CorpusSplitSchema>;
export type EvaluationEvidenceQualification = z.infer<typeof EvaluationEvidenceQualificationSchema>;
export type EvaluationBaseline = z.infer<typeof EvaluationBaselineSchema>;
export type CorpusVariant = z.infer<typeof CorpusVariantSchema>;
export type ProviderEvaluationCheckpoint = z.infer<typeof ProviderEvaluationCheckpointSchema>;
export type CheckpointedEvaluationTrial = z.infer<typeof CheckpointedEvaluationTrialSchema>;
export type EvaluationGeneratedPlanCheckpoint = z.infer<
  typeof EvaluationGeneratedPlanCheckpointSchema
>;
export type ExpectedEvidenceTraceCheckpoint = z.infer<typeof ExpectedEvidenceTraceCheckpointSchema>;
export type ExpectedEvidenceTraceCheckpointBinding = z.infer<
  typeof ExpectedEvidenceTraceCheckpointBindingSchema
>;
export type EvaluationTrial = z.infer<typeof EvaluationTrialSchema>;
export type FindingScore = z.infer<typeof FindingScoreSchema>;
export type EvidenceStageCoverage = z.infer<typeof EvidenceStageCoverageSchema>;
export type ExpectedEvidenceRoleTrace = z.infer<typeof ExpectedEvidenceRoleTraceSchema>;
export type PlanScore = z.infer<typeof PlanScoreSchema>;
export type RealWorldEvaluationRun = z.infer<typeof RealWorldEvaluationRunSchema>;
export type ReliabilitySummary = z.infer<typeof ReliabilitySummarySchema>;
