import type { AttackPlan } from '../../src/features/attack-planning/plan.schema.js';
import type { ModelCostCeiling } from '../../src/features/model-operations/model-operations.js';
import {
  readOptionalJsonArtifact,
  writeJsonArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import type { CorpusAnswerKey } from './corpus.schema.js';
import {
  answerKeyScenarioDigest,
  createPlanSemanticEvaluation,
} from './plan-semantic-adjudication.js';
import {
  type PlanSemanticAdjudicationBinding,
  PlanSemanticAdjudicationBindingSchema,
  type PlanSemanticAdjudicationCheckpoint,
  PlanSemanticAdjudicationCheckpointSchema,
  type PlanSemanticEvaluation,
  type PlanSemanticEvaluatorOperation,
  PlanSemanticEvaluatorOperationSchema,
} from './plan-semantic-adjudication.schema.js';

/**
 * Runs or reuses one exact evaluator-only semantic plan adjudication. The
 * invoker is deliberately lazy: it is not called until checkpoint reuse and
 * retry gates have closed, so it may safely construct the evaluator provider.
 */
export async function runPlanSemanticEvaluationOperation(input: {
  outputRoot: string;
  checkpointPath: string;
  binding: PlanSemanticAdjudicationBinding;
  plan: AttackPlan;
  answerKey: CorpusAnswerKey;
  retry: boolean;
  now: () => string;
  /** Registers an exact recovered evaluator observation before later dispatch. */
  modelCostCeiling?: ModelCostCeiling;
  invokeEvaluator: () => Promise<PlanSemanticEvaluatorOperation>;
}): Promise<PlanSemanticEvaluatorOperation> {
  const binding = PlanSemanticAdjudicationBindingSchema.parse(input.binding);
  assertInputBinding(binding, input.plan, input.answerKey);

  const checkpoint = await readOptionalJsonArtifact(
    input.outputRoot,
    input.checkpointPath,
    PlanSemanticAdjudicationCheckpointSchema,
  );
  if (checkpoint !== undefined) {
    assertCheckpointBinding(checkpoint, binding);
    if (checkpoint.status === 'completed') {
      input.modelCostCeiling?.recordPriorStages([checkpoint.evaluation.modelObservation]);
      return {
        status: 'completed',
        evaluation: validateEvaluation(checkpoint.evaluation, binding, input.plan, input.answerKey),
      };
    }
    if (!input.retry) {
      throw new AuditRuntimeError(
        'invalid-input',
        'A prior semantic evaluator attempt is unfinished; retry must be explicitly enabled.',
      );
    }
  }

  const startedAt = input.now();
  await writeJsonArtifact(
    input.outputRoot,
    input.checkpointPath,
    PlanSemanticAdjudicationCheckpointSchema,
    {
      schemaVersion: 4,
      ...binding,
      status: 'running',
      startedAt,
    },
  );

  const operation = PlanSemanticEvaluatorOperationSchema.parse(await input.invokeEvaluator());
  if (operation.status === 'completed') {
    const evaluation = validateEvaluation(
      operation.evaluation,
      binding,
      input.plan,
      input.answerKey,
    );
    await writeJsonArtifact(
      input.outputRoot,
      input.checkpointPath,
      PlanSemanticAdjudicationCheckpointSchema,
      {
        schemaVersion: 4,
        ...binding,
        status: 'completed',
        startedAt,
        completedAt: input.now(),
        evaluation,
      },
    );
    return { status: 'completed', evaluation };
  }

  await writeJsonArtifact(
    input.outputRoot,
    input.checkpointPath,
    PlanSemanticAdjudicationCheckpointSchema,
    operation.status === 'cancelled'
      ? {
          schemaVersion: 4,
          ...binding,
          status: 'cancelled',
          startedAt,
          stoppedAt: input.now(),
          errorCode: operation.errorCode,
          modelObservation: operation.modelObservation,
        }
      : {
          schemaVersion: 4,
          ...binding,
          status: 'incomplete',
          startedAt,
          stoppedAt: input.now(),
          errorCode: operation.errorCode,
          modelObservation: operation.modelObservation,
        },
  );
  return operation;
}

function assertInputBinding(
  binding: PlanSemanticAdjudicationBinding,
  plan: AttackPlan,
  answerKey: CorpusAnswerKey,
): void {
  if (
    binding.planId !== plan.planId ||
    binding.planDigest !== plan.planDigest ||
    binding.targetFingerprint !== plan.targetFingerprint ||
    binding.contextDigest !== plan.contextDigest ||
    binding.answerKeyScenarioDigest !== answerKeyScenarioDigest(answerKey)
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The semantic evaluator binding does not match its sealed plan and scenario rubric.',
    );
  }
}

function validateEvaluation(
  evaluation: PlanSemanticEvaluation,
  binding: PlanSemanticAdjudicationBinding,
  plan: AttackPlan,
  answerKey: CorpusAnswerKey,
): PlanSemanticEvaluation {
  const parsed = createPlanSemanticEvaluation({
    adjudication: evaluation.adjudication,
    binding,
    plan,
    answerKey,
    modelObservation: evaluation.modelObservation,
  });
  if (JSON.stringify(parsed.score) !== JSON.stringify(evaluation.score)) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The semantic evaluator score does not match its validated adjudication.',
    );
  }
  return parsed;
}

function assertCheckpointBinding(
  checkpoint: PlanSemanticAdjudicationCheckpoint,
  binding: PlanSemanticAdjudicationBinding,
): void {
  const fields = Object.keys(PlanSemanticAdjudicationBindingSchema.shape) as Array<
    keyof PlanSemanticAdjudicationBinding
  >;
  if (fields.some((field) => checkpoint[field] !== binding[field])) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'Semantic evaluator checkpoint does not match the requested trial and protocol.',
    );
  }
}
