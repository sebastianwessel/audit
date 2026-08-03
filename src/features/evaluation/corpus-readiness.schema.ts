import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  SchemaVersion,
} from '../../shared/contracts/core.js';
import { CorpusControlFamilySchema } from './corpus.schema.js';

export const CorpusReadinessLevelSchema = z.enum(['pilot', 'reliability-gate']);
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

/** Source-free real-world paired-project totals per evaluator-only control family. */
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
  schemaVersion: SchemaVersion,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  generatedAt: IsoDateTimeSchema,
  counts: CorpusReadinessCountsSchema,
  byEvidenceOrigin: z.array(CorpusReadinessDistributionSchema).max(16),
  byLanguage: z.array(CorpusReadinessDistributionSchema).max(128),
  byDataset: z.array(CorpusReadinessDistributionSchema).max(128),
  byControlFamily: z
    .array(CorpusControlFamilyReadinessSchema)
    .length(CorpusControlFamilySchema.options.length),
  criteria: z.array(CorpusReadinessCriterionSchema).min(1).max(32),
  pilotReady: z.boolean(),
  reliabilityGateReady: z.boolean(),
  limitations: z.array(BoundedTextSchema.min(1).max(500)).max(32),
});

export type CorpusReadinessCriterion = z.infer<typeof CorpusReadinessCriterionSchema>;
export type CorpusReadinessReport = z.infer<typeof CorpusReadinessReportSchema>;
