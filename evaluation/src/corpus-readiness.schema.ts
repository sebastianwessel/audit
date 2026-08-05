import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
} from '../../src/shared/contracts/core.js';
import { CorpusControlFamilySchema } from './corpus.schema.js';

/**
 * `development-calibration` is availability of bounded internal evidence, not
 * a pilot or reliability readiness gate.
 */
export const CorpusReadinessLevelSchema = z.enum([
  'development-calibration',
  'pilot',
  'reliability-gate',
]);
export const CorpusReadinessUnitSchema = z.enum([
  'repository-disjoint-pairs',
  'control-families',
  'language-families',
]);

/** Content-free count keyed by a closed evaluator classification. */
export const CorpusReadinessDistributionSchema = z.strictObject({
  key: z.string().trim().min(1).max(64),
  caseCount: z.int().nonnegative(),
  projectCount: z.int().nonnegative(),
});

/** Source-free real-world paired-project totals; dual-reviewed means two human reviews. */
export const CorpusControlFamilyReadinessSchema = z.strictObject({
  family: CorpusControlFamilySchema,
  realWorldPairedProjectCount: z.int().nonnegative(),
  dualReviewedRealWorldPairedProjectCount: z.int().nonnegative(),
});

export const CorpusReadinessCriterionSchema = z.strictObject({
  criterionId: IdentifierSchema,
  level: CorpusReadinessLevelSchema,
  unit: CorpusReadinessUnitSchema,
  observedCount: z.int().nonnegative(),
  minimumCount: z.int().positive(),
  met: z.boolean(),
  detail: BoundedTextSchema.min(1).max(500),
});

export const CorpusReadinessCountsSchema = z.strictObject({
  caseCount: z.int().nonnegative(),
  realWorldCaseCount: z.int().nonnegative(),
  pairedCaseCount: z.int().nonnegative(),
  realWorldPairedProjectCount: z.int().nonnegative(),
  realWorldDualReviewedPairedProjectCount: z.int().nonnegative(),
  dualReviewedPatchedNegativeProjectCount: z.int().nonnegative(),
  developmentRealWorldPairedProjectCount: z.int().nonnegative(),
  developmentDualReviewedRealWorldPairedProjectCount: z.int().nonnegative(),
  developmentCalibrationDeclaredProjectCount: z.int().nonnegative(),
  developmentCalibrationEligibleProjectCount: z.int().nonnegative(),
  developmentCalibrationHighUncertaintyProjectCount: z.int().nonnegative(),
  developmentCalibrationOpenConflictProjectCount: z.int().nonnegative(),
  developmentCalibrationCausalPatchUnconfirmedProjectCount: z.int().nonnegative(),
  privateHoldoutRealWorldPairedProjectCount: z.int().nonnegative(),
  dualReviewedPrivateHoldoutRealWorldPairedProjectCount: z.int().nonnegative(),
  realWorldLanguageFamilyCount: z.int().nonnegative(),
  dualReviewedRealWorldLanguageFamilyCount: z.int().nonnegative(),
  coveredRequiredControlFamilyCount: z.int().nonnegative(),
});

/**
 * Evaluator-only readiness evidence. It contains counts and labels, never
 * source text, answer-key locations, prompts, or provider output.
 */
export const CorpusReadinessReportSchema = z.strictObject({
  schemaVersion: z.literal(2),
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  generatedAt: IsoDateTimeSchema,
  counts: CorpusReadinessCountsSchema,
  byEvidenceOrigin: z.array(CorpusReadinessDistributionSchema),
  byLanguage: z.array(CorpusReadinessDistributionSchema),
  byDataset: z.array(CorpusReadinessDistributionSchema),
  byControlFamily: z
    .array(CorpusControlFamilyReadinessSchema)
    .length(CorpusControlFamilySchema.options.length),
  criteria: z.array(CorpusReadinessCriterionSchema).min(1),
  /** Internal evaluator evidence availability; never a release or reliability gate. */
  developmentCalibrationAvailable: z.boolean(),
  pilotReady: z.boolean(),
  reliabilityGateReady: z.boolean(),
  limitations: z.array(BoundedTextSchema.min(1).max(500)),
});

export type CorpusReadinessCriterion = z.infer<typeof CorpusReadinessCriterionSchema>;
export type CorpusReadinessReport = z.infer<typeof CorpusReadinessReportSchema>;
