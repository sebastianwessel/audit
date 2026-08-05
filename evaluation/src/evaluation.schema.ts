import { z } from 'zod';
import { SourceDocumentSchema } from '../../src/features/audit-execution/audit.schema.js';
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  RelativePathSchema,
  SchemaVersion,
} from '../../src/shared/contracts/core.js';

export const FixtureVariantSchema = z.enum(['vulnerable', 'fixed', 'benign']);
/** Canonical paired-corpus variant token, shared by corpus and semantic evaluation contracts. */
export const CorpusVariantSchema = z.enum(['vulnerable', 'patched', 'benign']);
export const FixtureDifficultySchema = z.enum(['easy', 'medium', 'hard']);
export const LanguageTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9+._-]*$/iu)
  .transform((value) => value.toLowerCase());

export const ExpectedFindingSchema = z.strictObject({
  path: RelativePathSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  locationTolerance: z.number().int().nonnegative(),
});

export const EvaluationFixtureSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  caseId: IdentifierSchema,
  variant: FixtureVariantSchema,
  language: LanguageTagSchema,
  difficulty: FixtureDifficultySchema,
  sources: z.array(SourceDocumentSchema).min(1),
  expectedFindings: z.array(ExpectedFindingSchema),
  adjudicationNotes: z.string().trim().min(1).max(1_000),
});

export const EvaluationPackSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  cases: z.array(EvaluationFixtureSchema).min(1),
});

export const MetricsSchema = z.strictObject({
  truePositives: z.number().int().nonnegative(),
  falsePositives: z.number().int().nonnegative(),
  falseNegatives: z.number().int().nonnegative(),
  precision: z.number().min(0).max(1).nullable(),
  recall: z.number().min(0).max(1).nullable(),
  f1: z.number().min(0).max(1).nullable(),
  locationAccuracy: z.number().min(0).max(1).nullable(),
  duplicateRate: z.number().min(0).max(1).nullable(),
  falsePositiveRate: z.number().min(0).max(1).nullable(),
});

export const CaseOutcomeSchema = z.strictObject({
  caseId: IdentifierSchema,
  variant: FixtureVariantSchema,
  expectedCount: z.number().int().nonnegative(),
  reportedCount: z.number().int().nonnegative(),
  metrics: MetricsSchema,
});

export const EvaluationRunSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  runId: IdentifierSchema,
  packId: IdentifierSchema,
  packVersion: z.string().trim().min(1).max(32),
  mode: z.literal('fixture'),
  provider: z.literal('no-provider-contract-runner'),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  caseOutcomes: z.array(CaseOutcomeSchema).min(1),
  micro: MetricsSchema,
  macro: MetricsSchema,
  gatePassed: z.boolean(),
  safetyViolations: z.number().int().nonnegative(),
});

export type EvaluationFixture = z.infer<typeof EvaluationFixtureSchema>;
export type EvaluationPack = z.infer<typeof EvaluationPackSchema>;
export type ExpectedFinding = z.infer<typeof ExpectedFindingSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type CaseOutcome = z.infer<typeof CaseOutcomeSchema>;
export type EvaluationRun = z.infer<typeof EvaluationRunSchema>;
