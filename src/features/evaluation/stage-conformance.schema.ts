import { z } from 'zod';

import { SchemaVersion } from '../../shared/contracts/core.js';
import { ToolUsageSchema } from '../model-operations/model-operations.schema.js';

export const SourceDecidingModelStageSchema = z.enum([
  'planning',
  'evidence-mapping',
  'source-posture',
  'investigation',
  'candidate-grounding',
  'verification',
  'countercheck',
]);

export const StageConformanceOutcomeSchema = z.enum(['inspected', 'retry-safe']);

/** Source-free result of a deterministic protocol conformance check, never a quality score. */
export const StageConformanceResultSchema = z.strictObject({
  stage: SourceDecidingModelStageSchema,
  outcome: StageConformanceOutcomeSchema,
  scopePreserved: z.literal(true),
  toolUsage: ToolUsageSchema,
});

export const StageConformanceRunSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  mode: z.literal('deterministic-stage-conformance'),
  provider: z.literal('in-process-scripted-fixture'),
  stages: z
    .array(StageConformanceResultSchema)
    .length(7)
    .superRefine((stages, context) => {
      const identities = stages.map((stage) => stage.stage);
      if (new Set(identities).size !== identities.length) {
        context.addIssue({
          code: 'custom',
          message: 'Each source-deciding stage is reported once.',
        });
      }
    }),
});

export type SourceDecidingModelStage = z.infer<typeof SourceDecidingModelStageSchema>;
export type StageConformanceResult = z.infer<typeof StageConformanceResultSchema>;
export type StageConformanceRun = z.infer<typeof StageConformanceRunSchema>;
