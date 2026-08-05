import { z } from 'zod';

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';

import { PlanEvaluationProfileSchema } from './corpus.schema.js';

export const EvaluationArtifactHeadlineStatusSchema = z.enum([
  'scoreable-completed',
  'incomplete',
  'failed',
  'cancelled',
  'orphaned-semantic-checkpoint',
  'protocol-mismatch',
  'no-current-scoreable-provider-result',
]);

export const EvaluationArtifactHeadlineSchema = z.strictObject({
  planProfile: PlanEvaluationProfileSchema,
  status: EvaluationArtifactHeadlineStatusSchema,
  runId: IdentifierSchema.nullable(),
  finishedAt: IsoDateTimeSchema.nullable(),
  benchmarkProtocolFingerprint: Sha256Schema.nullable(),
});

/** Source-free inspector output; it never exposes artifact paths or content. */
export const EvaluationArtifactInspectionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  expectedBenchmarkProtocolFingerprint: Sha256Schema,
  headlines: z.array(EvaluationArtifactHeadlineSchema).length(3),
});

export type EvaluationArtifactInspection = z.infer<typeof EvaluationArtifactInspectionSchema>;
export type EvaluationArtifactHeadlineStatus = z.infer<
  typeof EvaluationArtifactHeadlineStatusSchema
>;
