import { z } from 'zod';
import { StageIsolatedEvaluationStagePackSchema } from './stage-isolated.schema.js';
import {
  StageIsolatedExpectedOutcomeRubricSchema,
  StageIsolatedProductStageOutputSchema,
} from './stage-isolated-adjudication-agent.contract.js';

/**
 * Developer-only input for one isolated semantic review. It is read once into
 * memory and is never copied into a checkpoint, report, trace, telemetry
 * record, or log.
 */
/**
 * A prepared diagnostic binds an exact production-shaped input and source-free
 * rubric, but deliberately has no product result. It cannot be used to claim
 * that a model stage ran or that an evaluator measured one.
 */
export const StageIsolatedPreparedDiagnosticPackSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    pack: StageIsolatedEvaluationStagePackSchema,
    /** Same exact canonical production-input fingerprint as the sealed pack reference. */
    canonicalInputFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    rubric: StageIsolatedExpectedOutcomeRubricSchema,
  })
  .superRefine((value, context) => {
    if (
      value.canonicalInputFingerprint !== value.pack.productInput.fingerprint ||
      value.rubric.rubricId !== value.pack.expectedOutcome.privateReferenceId ||
      value.rubric.rubricFingerprint !== value.pack.expectedOutcome.fingerprint ||
      value.rubric.stage !== value.pack.stage ||
      value.rubric.expectedOutcomes.length !== value.pack.expectedOutcome.expectedOutcomeCount
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'The evaluator-private canonical input and rubric must bind the sealed stage pack exactly.',
      });
    }
  });

export type StageIsolatedPreparedDiagnosticPack = z.infer<
  typeof StageIsolatedPreparedDiagnosticPackSchema
>;

/** A closed product projection is required before the evaluator can be dispatched. */
export const StageSemanticEvaluatorPackSchema = StageIsolatedPreparedDiagnosticPackSchema.extend({
  productStageOutput: StageIsolatedProductStageOutputSchema,
}).superRefine((value, context) => {
  if (
    value.productStageOutput.stage !== value.pack.stage ||
    value.productStageOutput.stageResultId !== value.pack.productInput.referenceId
  ) {
    context.addIssue({
      code: 'custom',
      message: 'The source-free product projection must bind the sealed stage pack exactly.',
    });
  }
});

export type StageSemanticEvaluatorPack = z.infer<typeof StageSemanticEvaluatorPackSchema>;
