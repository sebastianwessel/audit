import { z } from 'zod';

import { IsoDateTimeSchema, Sha256Schema } from '../../src/shared/contracts/core.js';

import {
  StageIsolatedEvaluationStageForensicResultSchema,
  StageIsolatedEvaluationStagePackSchema,
} from './stage-isolated.schema.js';

const StageIsolatedCheckpointBaseSchema = z.strictObject({
  schemaVersion: z.literal(2),
  pack: StageIsolatedEvaluationStagePackSchema,
  canonicalInputFingerprint: Sha256Schema,
  productProjectionFingerprint: Sha256Schema.nullable(),
  rubricFingerprint: Sha256Schema,
  startedAt: IsoDateTimeSchema,
});

/** Private evaluator-work lifecycle; no canonical input payload is persisted. */
export const StageIsolatedEvaluationCheckpointSchema = z
  .discriminatedUnion('status', [
    StageIsolatedCheckpointBaseSchema.extend({ status: z.literal('running') }),
    StageIsolatedCheckpointBaseSchema.extend({
      status: z.literal('completed'),
      completedAt: IsoDateTimeSchema,
      result: StageIsolatedEvaluationStageForensicResultSchema,
    }),
    StageIsolatedCheckpointBaseSchema.extend({
      status: z.literal('incomplete'),
      completedAt: IsoDateTimeSchema,
      result: StageIsolatedEvaluationStageForensicResultSchema,
    }),
    StageIsolatedCheckpointBaseSchema.extend({
      status: z.literal('failed'),
      completedAt: IsoDateTimeSchema,
      result: StageIsolatedEvaluationStageForensicResultSchema,
    }),
    StageIsolatedCheckpointBaseSchema.extend({
      status: z.literal('cancelled'),
      completedAt: IsoDateTimeSchema,
      result: StageIsolatedEvaluationStageForensicResultSchema,
    }),
  ])
  .superRefine((checkpoint, context) => {
    if (checkpoint.status === 'running') return;
    if (JSON.stringify(checkpoint.pack) !== JSON.stringify(checkpoint.result.pack)) {
      context.addIssue({
        code: 'custom',
        path: ['result', 'pack'],
        message: 'A terminal stage checkpoint result must retain its exact pack.',
      });
    }
    const evaluatorStatus = checkpoint.result.evaluatorObservation?.status;
    const expectedStatus =
      checkpoint.result.semanticOutcome.status === 'inconclusive'
        ? evaluatorStatus === 'failed'
          ? 'failed'
          : 'incomplete'
        : 'completed';
    if (expectedStatus !== checkpoint.status) {
      context.addIssue({
        code: 'custom',
        path: ['result', 'semanticOutcome', 'status'],
        message: 'A terminal checkpoint must reflect its semantic evaluator lifecycle.',
      });
    }
  });

export type StageIsolatedEvaluationCheckpoint = z.infer<
  typeof StageIsolatedEvaluationCheckpointSchema
>;
