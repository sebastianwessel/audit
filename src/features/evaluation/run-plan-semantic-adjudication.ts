import { z } from 'zod';

import {
  readJsonArtifact,
  writeJsonArtifact,
  writeMarkdownArtifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { ensureSafeOutputRoot } from '../../platform/artifact-store/root-topology.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';

import { parseEvaluationOptionPairs } from './command-arguments.js';
import { loadCorpusPack } from './corpus.js';
import {
  CorpusVariantSchema,
  EvaluationGeneratedPlanCheckpointSchema,
  RealWorldEvaluationRunSchema,
} from './corpus.schema.js';
import {
  createPlanSemanticAdjudicationTemplate,
  createPlanSemanticEvaluation,
  type PlanSemanticAdjudicationBinding,
} from './plan-semantic-adjudication.js';
import {
  PlanSemanticAdjudicationSchema,
  PlanSemanticAdjudicationTemplateSchema,
  type PlanSemanticEvaluation,
  PlanSemanticEvaluationSchema,
} from './plan-semantic-adjudication.schema.js';
import { evaluationTrialId } from './real-world-runner.js';

const ArgumentsSchema = z
  .strictObject({
    corpus: z.string().trim().min(1).max(1_024),
    output: z.string().trim().min(1).max(1_024),
    'run-id': z.string().trim().min(1).max(64),
    'case-id': z.string().trim().min(1).max(64),
    variant: CorpusVariantSchema,
    repetition: z.coerce.number().int().positive(),
    adjudication: z.string().trim().min(1).max(1_024).optional(),
    template: z.string().trim().min(1).max(1_024).optional(),
  })
  .superRefine((value, context) => {
    if ((value.adjudication === undefined) === (value.template === undefined)) {
      context.addIssue({
        code: 'custom',
        message: 'Provide exactly one of --adjudication or --template.',
      });
    }
  });

export type PlanSemanticAdjudicationCommand = z.output<typeof ArgumentsSchema>;

export function parsePlanSemanticAdjudicationArguments(
  argv: readonly string[],
): PlanSemanticAdjudicationCommand {
  const parsed = ArgumentsSchema.safeParse(parseEvaluationOptionPairs(argv));
  if (!parsed.success) throw usage('Invalid plan semantic adjudication options.');
  return parsed.data;
}

/**
 * Validates an externally authored human mapping and writes only its derived,
 * source-free semantic score. This command never dispatches a model or opens a
 * target snapshot.
 */
export async function runPlanSemanticAdjudication(argv: readonly string[]): Promise<number> {
  const options = parsePlanSemanticAdjudicationArguments(argv);
  const loaded = await loadPlanSemanticAdjudicationContext(options);
  if (options.template !== undefined) {
    const template = createPlanSemanticAdjudicationTemplate({
      binding: loaded.binding,
      plan: loaded.plan,
      answerKey: loaded.answerKey,
    });
    await writeJsonArtifact(
      loaded.outputRoot,
      options.template,
      PlanSemanticAdjudicationTemplateSchema,
      template,
    );
    process.stdout.write(
      `Incomplete plan semantic adjudication template: ${options.template}\n` +
        'Fill its null review fields and replace each null outcome with the required final value before scoring.\n',
    );
    return 0;
  }
  const adjudicationPath = options.adjudication;
  if (adjudicationPath === undefined) throw usage('A final adjudication path is required.');
  const adjudication = await readJsonArtifact(
    loaded.outputRoot,
    adjudicationPath,
    PlanSemanticAdjudicationSchema,
  );
  const evaluation = createPlanSemanticEvaluation({
    adjudication,
    binding: loaded.binding,
    plan: loaded.plan,
    answerKey: loaded.answerKey,
  });
  const resultPath = `${loaded.run.runId}/plan-semantic-evaluations/${loaded.trialId}.json`;
  const reportPath = `${loaded.run.runId}/plan-semantic-evaluations/${loaded.trialId}.md`;
  await writeJsonArtifact(loaded.outputRoot, resultPath, PlanSemanticEvaluationSchema, evaluation);
  await writeMarkdownArtifact(
    loaded.outputRoot,
    reportPath,
    renderPlanSemanticEvaluation(evaluation),
  );
  process.stdout.write(`Plan semantic evaluation: ${resultPath}\nReport: ${reportPath}\n`);
  return 0;
}

async function loadPlanSemanticAdjudicationContext(options: PlanSemanticAdjudicationCommand) {
  const outputRoot = await ensureSafeOutputRoot(options.output);
  const run = await readJsonArtifact(
    outputRoot,
    `${options['run-id']}/evaluation-run.json`,
    RealWorldEvaluationRunSchema,
  );
  if (run.runId !== options['run-id'])
    throw usage('Evaluation run artifact does not match --run-id.');
  if (run.planProfile !== 'generated-plan') {
    throw usage('Semantic plan adjudication requires a generated-plan evaluation run.');
  }
  const trial = run.trials.find(
    (entry) =>
      entry.caseId === options['case-id'] &&
      entry.variant === options.variant &&
      entry.repetition === options.repetition,
  );
  if (trial === undefined)
    throw usage('Selected case, variant, and repetition are not in this run.');
  const trialId = evaluationTrialId({
    runId: run.runId,
    caseId: trial.caseId,
    variant: trial.variant,
    repetition: trial.repetition,
  });
  const planCheckpoint = await readJsonArtifact(
    outputRoot,
    `${run.runId}/.work/plans/${trialId}.json`,
    EvaluationGeneratedPlanCheckpointSchema,
  );
  if (planCheckpoint.trialId !== trialId) {
    throw usage('Generated-plan checkpoint does not match the selected evaluation trial.');
  }
  const pack = await loadCorpusPack(options.corpus);
  if (
    pack.manifest.packId !== run.packId ||
    pack.manifest.packVersion !== run.packVersion ||
    !pack.cases.some((entry) => entry.case.caseId === trial.caseId)
  ) {
    throw usage('Corpus pack does not match the selected evaluation run.');
  }
  const corpusCase = pack.cases.find((entry) => entry.case.caseId === trial.caseId);
  if (corpusCase === undefined) throw usage('Selected case is unavailable in the corpus pack.');
  const binding: PlanSemanticAdjudicationBinding = {
    runId: run.runId,
    trialId,
    packId: run.packId,
    packVersion: run.packVersion,
    caseId: trial.caseId,
    variant: trial.variant,
    repetition: trial.repetition,
  };
  return {
    outputRoot,
    run,
    trialId,
    binding,
    plan: planCheckpoint.plan,
    answerKey: corpusCase.answerKey,
  };
}

export function renderPlanSemanticEvaluation(evaluation: PlanSemanticEvaluation): string {
  const { adjudication, score } = evaluation;
  return [
    '# Generated-plan semantic evaluation',
    '',
    `- Run/trial: ${adjudication.runId} / ${adjudication.trialId}`,
    `- Case: ${adjudication.caseId} (${adjudication.variant}, repeat ${adjudication.repetition})`,
    `- Reviewer: ${adjudication.reviewer}`,
    `- Reviewed at: ${adjudication.reviewedAt}`,
    `- Plan: ${adjudication.planId} (${adjudication.planDigest})`,
    '',
    '| Scenario recall | Relevant-vector precision | Covered scenarios | Relevant vectors | Unrelated vectors | Duplicate relevant vectors |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${formatMetric(score.scenarioRecall)} | ${formatMetric(score.relevantVectorPrecision)} | ${score.coveredScenarioCount}/${score.expectedScenarioCount} | ${score.relevantVectorCount}/${score.enabledVectorCount} | ${score.unrelatedVectorCount} | ${score.duplicateRelevantVectorCount} |`,
    '',
    'These metrics come only from the bound human adjudication. They do not change product admission, workflow gates, or provider-quality claims.',
    '',
  ].join('\n');
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

function usage(message: string): SecurityReviewerError {
  return new SecurityReviewerError(
    'invalid-input',
    `${message} Usage: bun run eval:plan-semantic -- --corpus <corpus-root> --output <evaluation-output-root> --run-id <run-id> --case-id <case-id> --variant <vulnerable|patched|benign> --repetition <n> (--template <output-relative-json-path> | --adjudication <output-relative-json-path>)`,
  );
}

if (import.meta.main) {
  try {
    process.exitCode = await runPlanSemanticAdjudication(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected evaluation error.';
    process.stderr.write(`security-reviewer plan evaluation: ${message}\n`);
    process.exitCode = 2;
  }
}
