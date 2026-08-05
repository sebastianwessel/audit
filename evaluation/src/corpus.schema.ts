import { z } from 'zod';
import {
  AttackPlanSchema,
  ClaimEvidenceRoleSchema,
  DraftAttackVectorSchema,
} from '../../src/features/attack-planning/index.js';
import {
  CandidateIntegrityRejectionLedgerSchema,
  FindingAdmissionFunnelSchema,
  HypothesisGroundingFunnelSchema,
  VectorCoverageSchema,
} from '../../src/features/audit-execution/audit.schema.js';
import {
  ModelRunObservationSchema,
  ModelStageErrorCodeSchema,
  ModelStageObservationSchema,
} from '../../src/features/model-operations/model-operations.schema.js';
import {
  MaxParallelVectorsSchema,
  VerificationModeSchema,
} from '../../src/platform/configuration/environment.js';
import {
  BoundedTextSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  RelativePathSchema,
  SchemaVersion,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';
import { HarnessExecutionConfigurationSchema } from '../../src/shared/contracts/harness-execution.js';
import {
  ModelIdentifierSchema,
  ModelProviderIdentifierSchema,
} from '../../src/shared/contracts/model-identity.js';

import {
  CorpusVariantSchema,
  FixtureDifficultySchema,
  LanguageTagSchema,
} from './evaluation.schema.js';
import { HoldoutAttestationReferenceSchema } from './holdout-attestation.schema.js';
import {
  deriveEvaluationMeasurementState,
  EvaluationMeasurementStateSchema,
} from './measurement-state.js';
import {
  PlanSemanticMeasurementIdentitySchema,
  SemanticPlanEvaluatorIdentitySchema,
} from './plan-semantic-identity.schema.js';
import { PlanSemanticScoreSchema } from './plan-semantic-score.schema.js';

export const CorpusSplitSchema = z.enum(['development', 'test', 'private-holdout']);
/**
 * States what the selected corpus split can support. This is deliberately
 * independent from the workflow finding gate, which only evaluates the run.
 */
export const EvaluationEvidenceQualificationSchema = z.enum([
  'diagnostic',
  'development-calibration',
  'development-pilot',
  'private-holdout',
]);
export { CorpusVariantSchema } from './evaluation.schema.js';
export const CorpusVariantModeSchema = z.enum(['paired', 'single']);
/** A transparent one-review AI-assisted key supports internal development only. */
export const AdjudicationStatusSchema = z.enum(['provisional', 'ai-assisted', 'dual-reviewed']);
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
/** Evaluator alias of the product-owned relational claim-role vocabulary. */
export const ExpectedFindingEvidenceRoleSchema = ClaimEvidenceRoleSchema;

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
  /** Evaluator-only concise audit outcome, never product-model input. */
  objective: BoundedTextSchema.min(1).max(600),
  /** Evaluator-only source-only applicability declaration. */
  sourceOnlyApplicable: z.boolean(),
  /** Evaluator-only risk statement that a semantically relevant vector must cover. */
  requiredRiskCondition: BoundedTextSchema.min(1).max(1_000),
  /** Evaluator-only evidence expectations for semantic plan adjudication. */
  evidenceRequirements: z.array(BoundedTextSchema.min(1).max(600)).min(1),
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
    (findings) => new Set(findings.map((finding) => finding.findingId)).size === findings.length,
    { message: 'Expected finding identifiers must be unique.' },
  );

/** Evaluator-only independent judgment; it is never mounted into an agent target view. */
export const CorpusReviewerKindSchema = z.enum(['human', 'ai-assisted']);

export const CorpusIndependentReviewSchema = z.strictObject({
  reviewer: z.string().trim().min(1).max(160),
  reviewerKind: CorpusReviewerKindSchema,
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

/**
 * Evaluator-only confidence declaration for one bounded internal calibration
 * case. It is not model input and cannot promote a reliability claim.
 */
export const DevelopmentCalibrationUncertaintySchema = z.enum(['low', 'moderate', 'high']);
export const DevelopmentCalibrationConflictStatusSchema = z.enum(['none', 'open', 'resolved']);
export const CausalPatchValidationOutcomeSchema = z.enum([
  'confirmed',
  'inconclusive',
  'not-confirmed',
]);

export const CausalPatchValidationSchema = z.strictObject({
  outcome: CausalPatchValidationOutcomeSchema,
  validator: z.string().trim().min(1).max(160),
  validatedAt: IsoDateTimeSchema,
  notes: BoundedTextSchema.min(1).max(4_000),
});

export const DevelopmentCalibrationSchema = z
  .strictObject({
    protocolFingerprint: Sha256Schema,
    causalPatchValidation: CausalPatchValidationSchema,
    uncertainty: DevelopmentCalibrationUncertaintySchema,
    conflictStatus: DevelopmentCalibrationConflictStatusSchema,
    conflictNote: BoundedTextSchema.min(1).max(4_000).optional(),
  })
  .superRefine((record, context) => {
    if (record.conflictStatus !== 'none' && record.conflictNote === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['conflictNote'],
        message: 'A non-none development-calibration conflict status requires a conflict note.',
      });
    }
    if (record.conflictStatus === 'none' && record.conflictNote !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['conflictNote'],
        message: 'A no-conflict development-calibration record must not carry a conflict note.',
      });
    }
  });

export const CorpusAnswerKeySchema = z
  .strictObject({
    schemaVersion: z.literal(6),
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
    developmentCalibration: DevelopmentCalibrationSchema.optional(),
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
        !entry.independentReviews.every(
          (review) => review.reviewerKind === 'human' && entry.reviewers.includes(review.reviewer),
        ))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Dual-reviewed answer keys require two matching human independent review records.',
        path: ['reviewers'],
      });
    }
    if (
      entry.adjudicationStatus === 'ai-assisted' &&
      (entry.reviewers.length !== 1 ||
        entry.independentReviews === undefined ||
        entry.independentReviews.length !== 1 ||
        entry.independentReviews[0]?.reviewer !== entry.reviewers[0] ||
        entry.independentReviews[0]?.reviewerKind !== 'ai-assisted' ||
        entry.independentReviews[0]?.decision !== 'include' ||
        reviewJudgmentKey(entry.independentReviews[0]) !== reviewJudgmentKey(entry) ||
        !entry.staticReviewApplicable ||
        !entry.expectedFindings.some(isScoreableExpectedFinding))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'AI-assisted answer keys require one matching source-only AI include review and one expected finding.',
        path: ['independentReviews'],
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
    if (entry.developmentCalibration !== undefined && entry.adjudicationStatus !== 'ai-assisted') {
      context.addIssue({
        code: 'custom',
        message: 'Development-calibration metadata is permitted only on AI-assisted answer keys.',
        path: ['developmentCalibration'],
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
        objective: scenario.objective,
        sourceOnlyApplicable: scenario.sourceOnlyApplicable,
        requiredRiskCondition: scenario.requiredRiskCondition,
        evidenceRequirements: [...scenario.evidenceRequirements].sort(),
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

function isScoreableExpectedFinding(
  finding: z.output<typeof CorpusExpectedFindingSchema>,
): boolean {
  return (
    finding.staticReviewApplicable && finding.evidenceRoles.some((role) => !role.notApplicable)
  );
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

/** Each profile measures exactly one independently interpretable evaluator workflow. */
export const PlanEvaluationProfileSchema = z.enum([
  'planning-generated',
  'audit-reviewed-plan',
  'end-to-end-generated',
]);

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
    if (
      entry.variantMode === 'paired' &&
      (entry.vulnerableRevision === entry.patchedRevision ||
        entry.sourceDigests.vulnerable === entry.sourceDigests.patched)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Paired cases require distinct vulnerable and patched revisions and source digests.',
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
  redistributionDecision: z.enum([
    'metadata-only',
    'private-research-source-only',
    'source-included-with-license',
  ]),
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

/** Immediate source-path reachability only; it is never semantic plan quality. */
export const PathReachabilityScoreSchema = z.strictObject({
  /** Source-only-applicable scenarios; static-review-inapplicable scenarios are neutral. */
  eligibleScenarioCount: z.int().nonnegative(),
  pathReachableScenarioCount: z.int().nonnegative(),
  notApplicableScenarioCount: z.int().nonnegative(),
  relevantPathCoverage: z.number().min(0).max(1).nullable(),
  enabledVectorCount: z.int().nonnegative(),
});

export const FindingScoreSchema = z
  .strictObject({
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
    /** Evaluator-only expected identities matched by this trial; never model input. */
    matchedExpectedFindingIds: z
      .array(IdentifierSchema)
      .refine((identifiers) => new Set(identifiers).size === identifiers.length, {
        message: 'Matched expected finding identifiers must be unique.',
      }),
  })
  .superRefine((score, context) => {
    const issue = (path: string, message: string): void => {
      context.addIssue({ code: 'custom', path: [path], message });
    };
    if (score.truePositives !== score.matchedLocalizedCount) {
      issue('truePositives', 'True positives must equal fully localized expected-finding matches.');
    }
    if (
      score.falsePositives !==
      score.patchedMatchingFindingCount + score.unmatchedAdjudicatedFalsePositiveCount
    ) {
      issue(
        'falsePositives',
        'False positives must equal patched matches plus adjudicated unmatched findings.',
      );
    }
    if (score.unnecessaryVectorCount !== score.falsePositives) {
      issue(
        'unnecessaryVectorCount',
        'Unnecessary-vector count must equal the false-positive count.',
      );
    }
    if (score.falseNegatives < score.matchedMislocalizedCount) {
      issue(
        'falseNegatives',
        'Every mislocalized expected-finding match must remain a false negative.',
      );
    }
    if (
      score.matchedExpectedFindingIds.length !==
      score.truePositives + score.patchedMatchingFindingCount
    ) {
      issue(
        'matchedExpectedFindingIds',
        'Matched expected identities must equal fully localized vulnerable or patched matches.',
      );
    }
    const recallDenominator = score.truePositives + score.falseNegatives;
    assertNullableRatio(
      score.findingRecall,
      score.truePositives,
      recallDenominator,
      'findingRecall',
      'Finding recall must equal true positives divided by expected vulnerable findings.',
      issue,
    );
    if (score.findingPrecision !== null) {
      assertNullableRatio(
        score.findingPrecision,
        score.truePositives,
        score.truePositives + score.falsePositives,
        'findingPrecision',
        'Finding precision must equal true positives divided by admitted findings.',
        issue,
      );
    }
    const localizationDenominator = score.matchedLocalizedCount + score.matchedMislocalizedCount;
    assertNullableRatio(
      score.localizationAccuracy,
      score.matchedLocalizedCount,
      localizationDenominator,
      'localizationAccuracy',
      'Localization accuracy must equal fully localized matches divided by all expected-finding associations.',
      issue,
    );
    const expectedF1 =
      score.findingPrecision === null ||
      score.findingRecall === null ||
      score.findingPrecision + score.findingRecall === 0
        ? null
        : (2 * score.findingPrecision * score.findingRecall) /
          (score.findingPrecision + score.findingRecall);
    if (score.findingF1 !== expectedF1) {
      issue(
        'findingF1',
        'Finding F1 must equal the harmonic mean of available precision and recall.',
      );
    }
  });

function assertNullableRatio(
  actual: number | null,
  numerator: number,
  denominator: number,
  path: string,
  message: string,
  issue: (path: string, message: string) => void,
): void {
  const expected = denominator === 0 ? null : numerator / denominator;
  if (actual !== expected) issue(path, message);
}

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
  /** Selection by the terminal finding matched to this exact expected finding. */
  terminalVerifierSelected: z.boolean(),
  terminalCompleted: z.boolean(),
  firstIncompleteStage: FirstIncompleteEvidenceStageSchema,
});

/**
 * One evaluator-only terminal finding-to-answer-key match. It contains only
 * stable identifiers and role-completeness booleans, never source locations
 * or model/product content.
 */
export const TerminalEvidenceRoleSelectionSchema = z.strictObject({
  role: ExpectedFindingEvidenceRoleSchema,
  selected: z.boolean(),
});

export const TerminalFindingEvidenceMatchSchema = z
  .strictObject({
    expectedFindingId: IdentifierSchema,
    terminalFindingId: IdentifierSchema.nullable(),
    roleSelections: z.array(TerminalEvidenceRoleSelectionSchema),
  })
  .superRefine((match, context) => {
    const roles = match.roleSelections.map((selection) => selection.role);
    if (new Set(roles).size === roles.length) return;
    context.addIssue({
      code: 'custom',
      path: ['roleSelections'],
      message: 'A terminal evidence match may select each expected role only once.',
    });
  });

export const EvidenceStageCoverageSchema = z
  .strictObject({
    expectedRoleCount: z.int().nonnegative(),
    mappedLocationCount: z.int().nonnegative(),
    groundedRoleCount: z.int().nonnegative(),
    verifiedRoleCount: z.int().nonnegative(),
    /** First normal evidence stage that did not retain every expected role overlap. */
    firstIncompleteStage: FirstIncompleteEvidenceStageSchema,
    /** Evaluator-only derived stage booleans; never model input or a score. */
    roleTraces: z.array(ExpectedEvidenceRoleTraceSchema).optional(),
    /** Evaluator-only canonical terminal matching used by score and role trace projections. */
    terminalFindingEvidenceMatches: z.array(TerminalFindingEvidenceMatchSchema).optional(),
  })
  .superRefine((coverage, context) => {
    const traceKeys = coverage.roleTraces?.map((trace) => `${trace.findingId}\0${trace.role}`);
    if (traceKeys !== undefined && new Set(traceKeys).size !== traceKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['roleTraces'],
        message: 'An expected evidence role may appear only once in a coverage trace.',
      });
    }
    const expectedFindingIds = coverage.terminalFindingEvidenceMatches?.map(
      (match) => match.expectedFindingId,
    );
    if (
      expectedFindingIds !== undefined &&
      new Set(expectedFindingIds).size !== expectedFindingIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalFindingEvidenceMatches'],
        message: 'A terminal evidence projection may contain at most one row per expected finding.',
      });
    }
  });

/** Source-free observations retained after an otherwise incomplete evaluator trial. */
export const RetainedUnscoredOutcomeSchema = z.strictObject({
  acceptedFindingKeys: z
    .array(z.string().min(1))
    .refine((keys) => new Set(keys).size === keys.length, {
      message: 'Retained accepted finding identities must be unique.',
    }),
  reviewRequiredFindingKeys: z
    .array(z.string().min(1))
    .refine((keys) => new Set(keys).size === keys.length, {
      message: 'Retained review-required finding identities must be unique.',
    }),
});

/**
 * Source-free, evaluator-only projection of one generated plan's semantic
 * review. It is deliberately separate from product audit state and scores.
 */
const PlanSemanticMeasurementObservationSchema = ModelStageObservationSchema.refine(
  (observation) => observation.stage === 'plan-semantic-adjudication',
  { message: 'A semantic plan measurement observation must belong to its evaluator stage.' },
);

export const PlanSemanticMeasurementSchema = z.union([
  z.strictObject({
    status: z.literal('completed'),
    identity: PlanSemanticMeasurementIdentitySchema,
    score: PlanSemanticScoreSchema,
    modelObservation: PlanSemanticMeasurementObservationSchema,
  }),
  z.strictObject({
    status: z.literal('incomplete'),
    identity: PlanSemanticMeasurementIdentitySchema,
    errorCode: ModelStageErrorCodeSchema,
    /** Null only when the checkpoint-owning evaluator could not start a model stage. */
    modelObservation: PlanSemanticMeasurementObservationSchema.nullable(),
  }),
  z.strictObject({
    status: z.literal('cancelled'),
    identity: PlanSemanticMeasurementIdentitySchema,
    errorCode: z.literal('provider-cancelled'),
    modelObservation: PlanSemanticMeasurementObservationSchema,
  }),
  z.strictObject({
    status: z.literal('not-reached'),
    reason: z.enum(['product-cancelled', 'product-not-closed']),
  }),
  z.strictObject({
    status: z.literal('not-reached'),
    reason: z.literal('evaluator-not-configured'),
    identity: PlanSemanticMeasurementIdentitySchema,
  }),
  z.strictObject({
    status: z.literal('not-applicable'),
  }),
]);

export const EvaluationTrialSchema = z
  .strictObject({
    caseId: IdentifierSchema,
    variant: CorpusVariantSchema,
    repetition: z.int().positive(),
    status: z.enum(['completed', 'incomplete', 'failed', 'cancelled']),
    /** Exact evaluator-owned audit-reviewed-plan fixture identity; null for generated-plan trials. */
    reviewedPlanFingerprint: Sha256Schema.nullable(),
    pathReachability: PathReachabilityScoreSchema.nullable(),
    /**
     * Never affects audit admission, finding scoring, coverage, or the workflow
     * diagnostic gate. Newly written evaluation-run v15 artifacts always retain this state.
     */
    semanticPlanMeasurement: PlanSemanticMeasurementSchema.optional(),
    findingScore: FindingScoreSchema.nullable(),
    /** Evaluator-only answer-key diagnostic, never provider/model input or a score. */
    stageEvidenceCoverage: EvidenceStageCoverageSchema.optional(),
    /** Diagnostic-only match score for source-backed human-review items; never a release gate. */
    reviewRequiredScore: FindingScoreSchema.nullable().optional(),
    planKeys: z.array(z.string().min(1)),
    findingKeys: z.array(z.string().min(1)),
    reviewRequiredKeys: z.array(z.string().min(1)).optional(),
    /** Never scored; visible evaluator observations from an incomplete audit projection. */
    retainedUnscored: RetainedUnscoredOutcomeSchema.optional(),
    durationMs: z.int().nonnegative(),
    errorCode: ModelStageErrorCodeSchema.nullable(),
    /** Source-free audited vector state; required whenever an audit returned. */
    vectorCoverage: z.array(VectorCoverageSchema).min(1).optional(),
    modelObservation: ModelRunObservationSchema.nullable().optional(),
    /** Present only when the audit reached a terminal report. */
    admissionFunnel: FindingAdmissionFunnelSchema.optional(),
    /** Source-free discovery/grounding attrition when the audit reached a terminal report. */
    hypothesisGroundingFunnel: HypothesisGroundingFunnelSchema.optional(),
    candidateIntegrityRejections: CandidateIntegrityRejectionLedgerSchema.optional(),
  })
  .superRefine((trial, context) => {
    if (trial.status !== 'completed' || trial.findingScore === null) return;
    const coverage = trial.stageEvidenceCoverage;
    if (
      coverage?.roleTraces === undefined ||
      coverage.terminalFindingEvidenceMatches === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['stageEvidenceCoverage'],
        message: 'A completed scored audit trial requires terminal evidence traces and matches.',
      });
      return;
    }
    const tracesByExpectedFindingId = new Map<string, typeof coverage.roleTraces>();
    for (const trace of coverage.roleTraces) {
      const traces = tracesByExpectedFindingId.get(trace.findingId) ?? [];
      traces.push(trace);
      tracesByExpectedFindingId.set(trace.findingId, traces);
    }
    const matchedExpectedIds = new Set(trial.findingScore.matchedExpectedFindingIds);
    let completeTerminalMatches = 0;
    for (const [matchIndex, match] of coverage.terminalFindingEvidenceMatches.entries()) {
      const expectedTraces = tracesByExpectedFindingId.get(match.expectedFindingId) ?? [];
      const selectionByRole = new Map(
        match.roleSelections.map((selection) => [selection.role, selection] as const),
      );
      const selectedEveryRole =
        match.terminalFindingId !== null &&
        expectedTraces.length > 0 &&
        expectedTraces.every((trace) => selectionByRole.get(trace.role)?.selected === true) &&
        match.roleSelections.length === expectedTraces.length;
      if (selectedEveryRole) completeTerminalMatches += 1;
      for (const trace of expectedTraces) {
        const selection = selectionByRole.get(trace.role);
        if (selection !== undefined && trace.terminalVerifierSelected === selection.selected)
          continue;
        context.addIssue({
          code: 'custom',
          path: ['stageEvidenceCoverage', 'terminalFindingEvidenceMatches', matchIndex],
          message: 'Every expected terminal evidence role requires an exact matching role trace.',
        });
      }
      if (!matchedExpectedIds.has(match.expectedFindingId) || selectedEveryRole) continue;
      context.addIssue({
        code: 'custom',
        path: ['findingScore', 'matchedExpectedFindingIds'],
        message: 'A matched expected finding requires every applicable terminal evidence role.',
      });
    }
    for (const matchedExpectedId of matchedExpectedIds) {
      const match = coverage.terminalFindingEvidenceMatches.find(
        (entry) => entry.expectedFindingId === matchedExpectedId,
      );
      const expectedTraces = tracesByExpectedFindingId.get(matchedExpectedId) ?? [];
      const complete =
        match !== undefined &&
        match.terminalFindingId !== null &&
        match.roleSelections.length === expectedTraces.length &&
        expectedTraces.length > 0 &&
        expectedTraces.every(
          (trace) =>
            match.roleSelections.find((selection) => selection.role === trace.role)?.selected ===
            true,
        );
      if (complete) continue;
      context.addIssue({
        code: 'custom',
        path: ['findingScore', 'matchedExpectedFindingIds'],
        message: 'A scored expected finding requires a complete terminal evidence projection.',
      });
    }
    if (
      trial.variant === 'vulnerable' &&
      trial.findingScore.truePositives !== completeTerminalMatches
    ) {
      context.addIssue({
        code: 'custom',
        path: ['findingScore', 'truePositives'],
        message: 'Vulnerable true positives must equal complete terminal evidence matches.',
      });
    }
  });

/** One immutable evaluator-selected unit that must appear exactly once in a run. */
export const EvaluationTrialIdentitySchema = z.strictObject({
  caseId: IdentifierSchema,
  variant: CorpusVariantSchema,
  repetition: z.int().positive(),
});

const EvaluationTrialPopulationSchema = z
  .array(EvaluationTrialIdentitySchema)
  .min(1)
  .superRefine((population, context) => {
    const identities = population.map(
      (trial) => `${trial.caseId}\0${trial.variant}\0${trial.repetition}`,
    );
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: 'custom',
        message: 'Selected trial population entries must be unique.',
      });
    }
  });

export const CheckpointedEvaluationTrialSchema = z.strictObject({
  trial: EvaluationTrialSchema,
  attempts: z.int().positive(),
});

/** Source-free, exact-bound end-to-end-generated predecessor for evaluator retry. */
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
  provider: ModelProviderIdentifierSchema,
  model: ModelIdentifierSchema,
  verificationRouteFingerprint: Sha256Schema,
  promptProtocolFingerprint: Sha256Schema,
  answerKeyDigest: Sha256Schema,
});

/** Separate evaluator-work artifact; raw answer-key locations and discovery seeds are excluded. */
export const ExpectedEvidenceTraceCheckpointSchema = z.strictObject({
  schemaVersion: z.literal(2),
  binding: ExpectedEvidenceTraceCheckpointBindingSchema,
  roleTraces: z.array(ExpectedEvidenceRoleTraceSchema),
  savedAt: IsoDateTimeSchema,
});

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
  /** End-to-end latency across every terminal attempt, including unfinished work. */
  allTerminalDurationMsMedian: z.number().nonnegative().nullable(),
  allTerminalDurationMsP95: z.number().nonnegative().nullable(),
  /** Availability-only latency across completed trials; never substitutes for all-terminal cost. */
  completedDurationMsMedian: z.number().nonnegative().nullable(),
  completedDurationMsP95: z.number().nonnegative().nullable(),
  modelObservation: ModelRunObservationSchema.nullable().optional(),
});

const EvaluationBaselineCommonFields = {
  schemaVersion: z.literal(2),
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  corpusManifestDigest: Sha256Schema,
  populationDigest: Sha256Schema,
  benchmarkProtocolFingerprint: Sha256Schema,
  verificationMode: VerificationModeSchema,
  verificationRouteFingerprint: Sha256Schema,
  reviewedAt: IsoDateTimeSchema,
  reviewNote: BoundedTextSchema.min(1).max(2_000),
  requiredCaseIds: z.array(IdentifierSchema).min(1),
};

/**
 * Baselines are profile-specific by construction. Planning-only measurements
 * cannot accidentally inherit audit-finding thresholds.
 */
export const EvaluationBaselineSchema = z.discriminatedUnion('planProfile', [
  z.strictObject({
    ...EvaluationBaselineCommonFields,
    planProfile: z.literal('planning-generated'),
    semanticPlanEvaluator: SemanticPlanEvaluatorIdentitySchema,
    thresholds: z.strictObject({
      minimumCompletionRate: z.number().min(0).max(1),
      minimumSemanticEvaluatorCompletionRate: z.number().min(0).max(1),
      minimumSemanticScenarioRecall: z.number().min(0).max(1),
      minimumRelevantVectorPrecision: z.number().min(0).max(1),
    }),
  }),
  z.strictObject({
    ...EvaluationBaselineCommonFields,
    planProfile: z.literal('audit-reviewed-plan'),
    /** A false-positive gate needs exhaustive labels. */
    findingCoverage: z.literal('exhaustive'),
    semanticPlanEvaluator: z.null(),
    thresholds: z.strictObject({
      minimumCompletionRate: z.number().min(0).max(1),
      minimumVulnerableFindingRecall: z.number().min(0).max(1),
      maximumNonVulnerableFalsePositives: z.int().nonnegative(),
    }),
  }),
  z.strictObject({
    ...EvaluationBaselineCommonFields,
    planProfile: z.literal('end-to-end-generated'),
    /** A false-positive gate needs exhaustive labels. */
    findingCoverage: z.literal('exhaustive'),
    semanticPlanEvaluator: SemanticPlanEvaluatorIdentitySchema,
    thresholds: z.strictObject({
      minimumCompletionRate: z.number().min(0).max(1),
      minimumVulnerableFindingRecall: z.number().min(0).max(1),
      maximumNonVulnerableFalsePositives: z.int().nonnegative(),
    }),
  }),
]);

export const RealWorldEvaluationRunSchema = z
  .strictObject({
    schemaVersion: z.literal(15),
    runId: IdentifierSchema,
    packId: IdentifierSchema,
    packVersion: z.string().trim().min(1).max(32),
    corpusManifestDigest: Sha256Schema,
    populationDigest: Sha256Schema,
    benchmarkProtocolFingerprint: Sha256Schema,
    mode: z.enum(['deterministic', 'provider']),
    provider: ModelProviderIdentifierSchema,
    model: ModelIdentifierSchema,
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
    /** Null only for the audit-reviewed-plan profile. */
    semanticPlanEvaluator: SemanticPlanEvaluatorIdentitySchema.nullable(),
    executionBudget: HarnessExecutionConfigurationSchema,
    maxParallelVectors: MaxParallelVectorsSchema,
    promptProtocolFingerprint: Sha256Schema,
    startedAt: IsoDateTimeSchema,
    finishedAt: IsoDateTimeSchema,
    selectedTrialPopulation: EvaluationTrialPopulationSchema,
    trials: z.array(EvaluationTrialSchema).min(1),
    reliability: ReliabilitySummarySchema,
    /** Exact completion state for the dimensions this profile is allowed to measure. */
    measurementState: EvaluationMeasurementStateSchema,
    safetyViolations: z.int().nonnegative(),
    /** Diagnostic threshold result, never a product-security or provider-quality claim. */
    diagnosticGatePassed: z.boolean(),
  })
  .superRefine((run, context) => {
    const trialKeys = run.trials.map(
      (trial) => `${trial.caseId}\0${trial.variant}\0${trial.repetition}`,
    );
    if (new Set(trialKeys).size !== trialKeys.length) {
      context.addIssue({
        code: 'custom',
        path: ['trials'],
        message: 'Evaluation trials must have unique case, variant, and repetition identities.',
      });
    }
    const selectedPopulationKeys = run.selectedTrialPopulation.map(
      (trial) => `${trial.caseId}\0${trial.variant}\0${trial.repetition}`,
    );
    if (
      selectedPopulationKeys.length !== trialKeys.length ||
      selectedPopulationKeys.some((identity) => !trialKeys.includes(identity))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['selectedTrialPopulation'],
        message:
          'Evaluation trials must close exactly over the persisted selected trial population.',
      });
    }
    const completed = run.trials.filter((trial) => trial.status === 'completed');
    const incomplete = run.trials.filter((trial) => trial.status === 'incomplete');
    const failed = run.trials.filter((trial) => trial.status === 'failed');
    const cancelled = run.trials.filter((trial) => trial.status === 'cancelled');
    const countMismatches: ReadonlyArray<readonly [number, number, string]> = [
      [run.reliability.completedTrials, completed.length, 'completed'],
      [run.reliability.incompleteTrials, incomplete.length, 'incomplete'],
      [run.reliability.failedTrials, failed.length, 'failed'],
      [run.reliability.cancelledTrials, cancelled.length, 'cancelled'],
    ];
    for (const [reported, derived, state] of countMismatches) {
      if (reported !== derived) {
        context.addIssue({
          code: 'custom',
          path: ['reliability'],
          message: `Reliability ${state} trial count must equal the persisted trial population.`,
        });
      }
    }
    const completionRate = completed.length / run.trials.length;
    if (run.reliability.completionRate !== completionRate) {
      context.addIssue({
        code: 'custom',
        path: ['reliability', 'completionRate'],
        message: 'Reliability completion rate must equal the persisted trial population.',
      });
    }
    const recallValues = completed.flatMap((trial) =>
      trial.findingScore?.findingRecall === null || trial.findingScore === null
        ? []
        : [trial.findingScore.findingRecall],
    );
    const recallMinimum = recallValues.length === 0 ? null : Math.min(...recallValues);
    if (run.reliability.findingRecallMinimum !== recallMinimum) {
      context.addIssue({
        code: 'custom',
        path: ['reliability', 'findingRecallMinimum'],
        message: 'Reliability minimum finding recall must equal completed trial scores.',
      });
    }
    const recallMedian = percentile(recallValues, 0.5);
    if (run.reliability.findingRecallMedian !== recallMedian) {
      context.addIssue({
        code: 'custom',
        path: ['reliability', 'findingRecallMedian'],
        message: 'Reliability median finding recall must equal completed trial scores.',
      });
    }
    const expectedMeasurementState = deriveEvaluationMeasurementState({
      planProfile: run.planProfile,
      trials: run.trials,
    });
    if (
      run.measurementState.workflow !== expectedMeasurementState.workflow ||
      run.measurementState.semanticPlan !== expectedMeasurementState.semanticPlan ||
      run.measurementState.finding !== expectedMeasurementState.finding
    ) {
      context.addIssue({
        code: 'custom',
        path: ['measurementState'],
        message: 'Evaluation measurement state must equal its persisted trial terminals.',
      });
    }
    validateRetainedModelObservationLedger(run, context);
    if ((run.planProfile === 'audit-reviewed-plan') !== (run.semanticPlanEvaluator === null)) {
      context.addIssue({
        code: 'custom',
        path: ['semanticPlanEvaluator'],
        message: 'Only audit-reviewed-plan runs may omit the semantic-plan evaluator identity.',
      });
    }
    for (const [index, trial] of run.trials.entries()) {
      if (trial.semanticPlanMeasurement === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index, 'semanticPlanMeasurement'],
          message: 'Evaluation-run v13 trials require a semantic plan measurement state.',
        });
      }
      if (
        trial.semanticPlanMeasurement?.status === 'not-applicable' &&
        run.planProfile !== 'audit-reviewed-plan'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index, 'semanticPlanMeasurement'],
          message: 'Only audit-reviewed-plan trials may mark semantic measurement not applicable.',
        });
      }
      if (
        run.planProfile === 'audit-reviewed-plan' &&
        trial.semanticPlanMeasurement !== undefined &&
        trial.semanticPlanMeasurement.status !== 'not-applicable'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index, 'semanticPlanMeasurement'],
          message: 'Audit-reviewed-plan trials must mark semantic measurement not applicable.',
        });
      }
      const measurementIdentity =
        trial.semanticPlanMeasurement?.status === 'completed' ||
        trial.semanticPlanMeasurement?.status === 'incomplete' ||
        trial.semanticPlanMeasurement?.status === 'cancelled' ||
        (trial.semanticPlanMeasurement?.status === 'not-reached' &&
          trial.semanticPlanMeasurement.reason === 'evaluator-not-configured')
          ? trial.semanticPlanMeasurement.identity
          : undefined;
      if (
        measurementIdentity !== undefined &&
        (run.semanticPlanEvaluator === null ||
          measurementIdentity.protocolFingerprint !==
            run.semanticPlanEvaluator.protocolFingerprint ||
          measurementIdentity.route !== run.semanticPlanEvaluator.route)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index, 'semanticPlanMeasurement', 'identity'],
          message: 'Semantic measurement identity must match the run-level evaluator identity.',
        });
      }
      if (
        run.planProfile === 'audit-reviewed-plan' &&
        (trial.reviewedPlanFingerprint === null ||
          trial.pathReachability !== null ||
          trial.planKeys.length !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index],
          message:
            'Audit-reviewed-plan trials require their reviewed-plan binding and cannot carry generated-plan measurements.',
        });
      }
      if (run.planProfile !== 'audit-reviewed-plan' && trial.reviewedPlanFingerprint !== null) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index, 'reviewedPlanFingerprint'],
          message: 'Generated-plan trials cannot carry an evaluator-reviewed-plan binding.',
        });
      }
      if (
        run.planProfile === 'planning-generated' &&
        (trial.findingScore !== null ||
          (trial.reviewRequiredScore !== undefined && trial.reviewRequiredScore !== null) ||
          trial.findingKeys.length !== 0 ||
          (trial.reviewRequiredKeys?.length ?? 0) !== 0 ||
          trial.retainedUnscored !== undefined ||
          trial.vectorCoverage !== undefined ||
          trial.admissionFunnel !== undefined ||
          trial.hypothesisGroundingFunnel !== undefined ||
          trial.candidateIntegrityRejections !== undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index],
          message:
            'Planning-generated trials may retain only planning and semantic-measurement evidence, never audit or finding data.',
        });
      }
      if (
        trial.status !== 'completed' &&
        (trial.findingScore !== null ||
          (trial.reviewRequiredScore !== undefined && trial.reviewRequiredScore !== null))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index],
          message: 'Only completed trials may carry finding or review-required scores.',
        });
      }
      if (trial.status === 'completed' && trial.errorCode !== null) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index, 'errorCode'],
          message: 'Completed trials cannot carry an error code.',
        });
      }
      if (trial.status === 'completed' && trial.retainedUnscored !== undefined) {
        context.addIssue({
          code: 'custom',
          path: ['trials', index, 'retainedUnscored'],
          message: 'Completed trials cannot retain unscored outcomes.',
        });
      }
    }
  });

/**
 * Makes every published evaluation reconstructible from its persisted,
 * source-free trial observations. A response that cannot be reconstructed is
 * not eligible for scoring, comparison, or publication.
 */
function validateRetainedModelObservationLedger(
  run: z.output<typeof RealWorldEvaluationRunSchema>,
  context: z.RefinementCtx,
): void {
  const retainedStages = run.trials.flatMap((trial) => trial.modelObservation?.stages ?? []);
  const aggregate = run.reliability.modelObservation ?? null;
  if (retainedStages.length === 0) {
    if (aggregate !== null) {
      context.addIssue({
        code: 'custom',
        path: ['reliability', 'modelObservation'],
        message: 'Evaluation telemetry cannot contain stages absent from every persisted trial.',
      });
    }
    return;
  }
  if (aggregate === null) {
    context.addIssue({
      code: 'custom',
      path: ['reliability', 'modelObservation'],
      message: 'Evaluation trials with model stages require a retained aggregate observation.',
    });
    return;
  }
  if (
    aggregate.stages.length !== retainedStages.length ||
    aggregate.stages.some(
      (stage, index) => JSON.stringify(stage) !== JSON.stringify(retainedStages[index]),
    )
  ) {
    context.addIssue({
      code: 'custom',
      path: ['reliability', 'modelObservation', 'stages'],
      message:
        'Evaluation aggregate stages must close exactly over retained trial stage observations.',
    });
  }
  const knownCosts = retainedStages.map((stage) => stage.cost.estimatedCostUsd);
  const retainedCost = knownCosts.every((cost): cost is number => cost !== null)
    ? Math.round(knownCosts.reduce((total, cost) => total + cost, 0) * 1_000_000) / 1_000_000
    : null;
  if (aggregate.cost.estimatedCostUsd !== retainedCost) {
    context.addIssue({
      code: 'custom',
      path: ['reliability', 'modelObservation', 'cost', 'estimatedCostUsd'],
      message: 'Evaluation aggregate cost must equal the retained trial-stage ledger.',
    });
  }
}

/** Persisted command states are intentionally separate from individual trial outcomes. */
export const ProviderEvaluationLifecycleStatusSchema = z.enum([
  'created',
  'running',
  'finalizing',
  'completed',
  'failed',
  'cancelled',
]);

/** A stable, source-free failure classification for evaluator command recovery. */
export const ProviderEvaluationFailureDomainSchema = z.enum([
  'configuration',
  'corpus-validation',
  'provider',
  'provider-cancelled',
  'model-contract',
  'audit-workflow',
  'checkpoint-persistence',
  'artifact-validation',
  'artifact-publication',
  'lock-conflict',
  'operator-stop',
]);

/**
 * A source-free reason for an atomic terminal-publication stop. It never
 * carries a filesystem path, provider payload, or artifact content.
 */
export const ProviderEvaluationPublicationFailureReasonSchema = z.enum([
  'terminal-destination-occupied',
  'staging-directory-invalid',
  'rename-failed',
  'publication-unknown',
]);

export const ProviderEvaluationFailureSchema = z
  .strictObject({
    domain: ProviderEvaluationFailureDomainSchema,
    code: z.string().trim().min(1),
    publicationReason: ProviderEvaluationPublicationFailureReasonSchema.nullable(),
    phase: z.enum(['checkpoint', 'audit-work', 'finalization', 'publication', 'shutdown']),
    attemptId: IdentifierSchema,
    affectedTrialIds: z.array(IdentifierSchema),
    affectedStageIds: z.array(IdentifierSchema),
    recoveryDisposition: z.enum(['resume-work', 'resume-finalization', 'operator-action-required']),
  })
  .superRefine((value, context) => {
    const hasPublicationFailure = value.domain === 'artifact-publication';
    if (hasPublicationFailure !== (value.publicationReason !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['publicationReason'],
        message: 'Only artifact-publication failures retain a publication reason.',
      });
    }
    if (value.domain === 'artifact-publication') {
      const expectedDisposition =
        value.publicationReason === 'rename-failed'
          ? 'resume-finalization'
          : 'operator-action-required';
      if (value.recoveryDisposition !== expectedDisposition) {
        context.addIssue({
          code: 'custom',
          path: ['recoveryDisposition'],
          message:
            'Only a rename failure may resume finalization; every other publication failure requires operator action.',
        });
      }
    }
    if (
      value.domain === 'artifact-validation' &&
      value.phase === 'publication' &&
      value.recoveryDisposition !== 'operator-action-required'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recoveryDisposition'],
        message: 'A terminal artifact validation failure requires operator action.',
      });
    }
  });

export const ProviderEvaluationAttemptModeSchema = z.enum([
  'fresh',
  'resume-work',
  'resume-finalization',
]);

const ProviderEvaluationAttemptMetricsSchema = z.strictObject({
  modelDispatchCount: z.int().nonnegative(),
  reusedStageCount: z.int().nonnegative(),
  newEstimatedCostUsd: z.number().nonnegative().nullable(),
  cumulativeEstimatedCostUsd: z.number().nonnegative().nullable(),
  latestAttemptWallDurationMs: z.int().nonnegative(),
  cumulativeActiveWallDurationMs: z.int().nonnegative(),
  summedModelDurationMs: z.int().nonnegative(),
  finalizationDurationMs: z.int().nonnegative(),
});

const ProviderEvaluationActiveAttemptSchema = z.strictObject({
  attemptId: IdentifierSchema,
  mode: ProviderEvaluationAttemptModeSchema,
  startedAt: IsoDateTimeSchema,
  startingStatus: ProviderEvaluationLifecycleStatusSchema,
});

export const ProviderEvaluationAttemptSchema = ProviderEvaluationActiveAttemptSchema.extend({
  endedAt: IsoDateTimeSchema,
  endingStatus: ProviderEvaluationLifecycleStatusSchema,
  outcome: z.enum(['completed', 'failed', 'cancelled', 'interrupted']),
  metrics: ProviderEvaluationAttemptMetricsSchema,
  failureCodes: z.array(z.string().trim().min(1)),
});

export const ProviderEvaluationTerminalArtifactNameSchema = z.enum([
  'evaluation-run.json',
  'evaluation-report.md',
  'case-results.jsonl',
]);

export const ProviderEvaluationTerminalArtifactSchema = z.strictObject({
  name: ProviderEvaluationTerminalArtifactNameSchema,
  schemaVersion: z.int().positive().nullable(),
  sha256: Sha256Schema,
  byteLength: z.int().nonnegative(),
});

/** The finalization payload is immutable and sufficient to publish without a provider. */
export const ProviderEvaluationFinalizationSchema = z.strictObject({
  run: RealWorldEvaluationRunSchema,
  report: z.string().min(1),
  aggregateDigest: Sha256Schema,
  frozenAt: IsoDateTimeSchema,
});

/** Published last inside the atomically renamed terminal artifact directory. */
export const ProviderEvaluationTerminalManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    runId: IdentifierSchema,
    configFingerprint: Sha256Schema,
    packId: IdentifierSchema,
    packVersion: z.string().trim().min(1).max(32),
    corpusManifestDigest: Sha256Schema,
    populationDigest: Sha256Schema,
    benchmarkProtocolFingerprint: Sha256Schema,
    provider: ModelProviderIdentifierSchema,
    model: ModelIdentifierSchema,
    planProfile: PlanEvaluationProfileSchema,
    semanticPlanEvaluator: SemanticPlanEvaluatorIdentitySchema.nullable(),
    requiredArtifacts: z.array(ProviderEvaluationTerminalArtifactSchema).min(3),
    frozenTrialIds: EvaluationTrialPopulationSchema,
    aggregateDigest: Sha256Schema,
    publishedAt: IsoDateTimeSchema,
    attemptId: IdentifierSchema,
    terminalStatus: z.literal('completed'),
  })
  .superRefine((manifest, context) => {
    const names = manifest.requiredArtifacts.map((artifact) => artifact.name);
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['requiredArtifacts'],
        message: 'Terminal manifest artifact names must be unique.',
      });
    }
    for (const name of ProviderEvaluationTerminalArtifactNameSchema.options) {
      if (!names.includes(name)) {
        context.addIssue({
          code: 'custom',
          path: ['requiredArtifacts'],
          message: 'Terminal manifest must retain every required artifact.',
        });
      }
    }
  });

export const ProviderEvaluationCheckpointSchema = z
  .strictObject({
    schemaVersion: z.literal(15),
    runId: IdentifierSchema,
    configFingerprint: Sha256Schema,
    packId: IdentifierSchema,
    packVersion: z.string().trim().min(1).max(32),
    corpusManifestDigest: Sha256Schema,
    populationDigest: Sha256Schema,
    benchmarkProtocolFingerprint: Sha256Schema,
    provider: ModelProviderIdentifierSchema,
    model: ModelIdentifierSchema,
    verificationMode: VerificationModeSchema,
    verificationRouteFingerprint: Sha256Schema,
    selectedSplit: CorpusSplitSchema,
    caseIdFilter: IdentifierSchema.optional(),
    holdoutAttestation: HoldoutAttestationReferenceSchema.optional(),
    repetitions: z.int().positive(),
    planProfile: PlanEvaluationProfileSchema,
    semanticPlanEvaluator: SemanticPlanEvaluatorIdentitySchema.nullable(),
    executionBudget: HarnessExecutionConfigurationSchema,
    maxParallelVectors: MaxParallelVectorsSchema,
    status: ProviderEvaluationLifecycleStatusSchema,
    failure: ProviderEvaluationFailureSchema.nullable(),
    startedAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    selectedTrialPopulation: EvaluationTrialPopulationSchema,
    trials: z.array(CheckpointedEvaluationTrialSchema),
    activeAttempt: ProviderEvaluationActiveAttemptSchema.nullable(),
    attempts: z.array(ProviderEvaluationAttemptSchema),
    finalization: ProviderEvaluationFinalizationSchema.nullable(),
  })
  .superRefine((checkpoint, context) => {
    const attemptIds = checkpoint.attempts.map((attempt) => attempt.attemptId);
    if (new Set(attemptIds).size !== attemptIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['attempts'],
        message: 'Provider evaluation attempt history must be append-only and unique.',
      });
    }
    if (
      checkpoint.activeAttempt !== null &&
      attemptIds.includes(checkpoint.activeAttempt.attemptId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['activeAttempt'],
        message: 'An active attempt cannot already be terminal history.',
      });
    }
    if (checkpoint.finalization !== null) {
      if (checkpoint.finalization.run.runId !== checkpoint.runId) {
        context.addIssue({
          code: 'custom',
          path: ['finalization', 'run', 'runId'],
          message: 'Finalization data must belong to its provider evaluation run.',
        });
      }
      if (
        checkpoint.finalization.run.populationDigest !== checkpoint.populationDigest ||
        canonicalPopulation(checkpoint.finalization.run.selectedTrialPopulation) !==
          canonicalPopulation(checkpoint.selectedTrialPopulation)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['finalization'],
          message: 'Finalization data must close over the sealed provider evaluation population.',
        });
      }
      if (
        checkpoint.finalization.run.semanticPlanEvaluator?.protocolFingerprint !==
          checkpoint.semanticPlanEvaluator?.protocolFingerprint ||
        checkpoint.finalization.run.semanticPlanEvaluator?.route !==
          checkpoint.semanticPlanEvaluator?.route
      ) {
        context.addIssue({
          code: 'custom',
          path: ['finalization', 'run', 'semanticPlanEvaluator'],
          message: 'Finalization semantic evaluator identity must match its sealed checkpoint.',
        });
      }
    }
    const requiresActiveAttempt =
      checkpoint.status === 'running' || checkpoint.status === 'finalizing';
    if (requiresActiveAttempt !== (checkpoint.activeAttempt !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['activeAttempt'],
        message: 'Running and finalizing checkpoints require exactly one active attempt.',
      });
    }
    const requiresFinalization =
      checkpoint.status === 'finalizing' || checkpoint.status === 'completed';
    if (requiresFinalization && checkpoint.finalization === null) {
      context.addIssue({
        code: 'custom',
        path: ['finalization'],
        message: 'Finalizing and completed checkpoints require frozen finalization data.',
      });
    }
    if (checkpoint.status === 'completed' && checkpoint.failure !== null) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'A completed provider evaluation checkpoint cannot retain a failure.',
      });
    }
    if (
      (checkpoint.status === 'created' ||
        checkpoint.status === 'running' ||
        checkpoint.status === 'finalizing') &&
      checkpoint.failure !== null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'An active provider evaluation checkpoint cannot retain a terminal failure.',
      });
    }
    if (
      (checkpoint.status === 'failed' || checkpoint.status === 'cancelled') &&
      checkpoint.failure === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'A stopped provider evaluation checkpoint requires a failure envelope.',
      });
    }
    if (checkpoint.status === 'cancelled' && checkpoint.failure?.domain !== 'provider-cancelled') {
      context.addIssue({
        code: 'custom',
        path: ['failure', 'domain'],
        message: 'A cancelled provider evaluation checkpoint requires provider-cancelled domain.',
      });
    }
  });

function canonicalPopulation(population: readonly EvaluationTrialIdentity[]): string {
  return population
    .map((entry) => `${entry.caseId}\0${entry.variant}\0${entry.repetition}`)
    .join('\n');
}

function percentile(values: readonly number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1);
  return sorted[index] ?? null;
}

export type CorpusAnswerKey = z.infer<typeof CorpusAnswerKeySchema>;
export type DevelopmentCalibration = z.infer<typeof DevelopmentCalibrationSchema>;
export type FindingCoverageClass = z.infer<typeof FindingCoverageClassSchema>;
export type ReviewedPlanFixture = z.infer<typeof ReviewedPlanFixtureSchema>;
export type PlanEvaluationProfile = z.infer<typeof PlanEvaluationProfileSchema>;
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
export type ProviderEvaluationFailure = z.infer<typeof ProviderEvaluationFailureSchema>;
export type ProviderEvaluationFailureDomain = z.infer<typeof ProviderEvaluationFailureDomainSchema>;
export type ProviderEvaluationPublicationFailureReason = z.infer<
  typeof ProviderEvaluationPublicationFailureReasonSchema
>;
export type ProviderEvaluationAttempt = z.infer<typeof ProviderEvaluationAttemptSchema>;
export type ProviderEvaluationFinalization = z.infer<typeof ProviderEvaluationFinalizationSchema>;
export type ProviderEvaluationTerminalManifest = z.infer<
  typeof ProviderEvaluationTerminalManifestSchema
>;
export type CheckpointedEvaluationTrial = z.infer<typeof CheckpointedEvaluationTrialSchema>;
export type EvaluationGeneratedPlanCheckpoint = z.infer<
  typeof EvaluationGeneratedPlanCheckpointSchema
>;
export type ExpectedEvidenceTraceCheckpoint = z.infer<typeof ExpectedEvidenceTraceCheckpointSchema>;
export type ExpectedEvidenceTraceCheckpointBinding = z.infer<
  typeof ExpectedEvidenceTraceCheckpointBindingSchema
>;
export type EvaluationTrial = z.infer<typeof EvaluationTrialSchema>;
export type EvaluationTrialIdentity = z.infer<typeof EvaluationTrialIdentitySchema>;
export type FindingScore = z.infer<typeof FindingScoreSchema>;
export type EvidenceStageCoverage = z.infer<typeof EvidenceStageCoverageSchema>;
export type ExpectedEvidenceRoleTrace = z.infer<typeof ExpectedEvidenceRoleTraceSchema>;
export type TerminalFindingEvidenceMatch = z.infer<typeof TerminalFindingEvidenceMatchSchema>;
export type PathReachabilityScore = z.infer<typeof PathReachabilityScoreSchema>;
export type PlanSemanticMeasurement = z.infer<typeof PlanSemanticMeasurementSchema>;
export type RealWorldEvaluationRun = z.infer<typeof RealWorldEvaluationRunSchema>;
export type ReliabilitySummary = z.infer<typeof ReliabilitySummarySchema>;
