import { z } from 'zod';

import {
  readJsonArtifact,
  writeJsonArtifact,
  writeMarkdownArtifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { ensureSafeOutputRoot } from '../../platform/artifact-store/root-topology.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';

import { parseEvaluationOptionPairs } from './command-arguments.js';
import { RealWorldEvaluationRunSchema } from './corpus.schema.js';
import {
  PlanSemanticEvaluationSchema,
  type PlanSemanticRunEvaluation,
  PlanSemanticRunEvaluationSchema,
} from './plan-semantic-adjudication.schema.js';
import {
  readOptionalPlanSemanticEvaluation,
  summarizePlanSemanticRun,
} from './plan-semantic-run.js';

const ArgumentsSchema = z.strictObject({
  output: z.string().trim().min(1).max(1_024),
  'run-id': z.string().trim().min(1).max(64),
});

export function parsePlanSemanticSummaryArguments(argv: readonly string[]) {
  const parsed = ArgumentsSchema.safeParse(parseEvaluationOptionPairs(argv));
  if (!parsed.success) throw usage('Invalid plan semantic summary options.');
  return parsed.data;
}

/** Summarizes existing AI-assisted adjudications only; it never opens a target or calls a provider. */
export async function runPlanSemanticSummary(argv: readonly string[]): Promise<number> {
  const options = parsePlanSemanticSummaryArguments(argv);
  const outputRoot = await ensureSafeOutputRoot(options.output);
  const run = await readJsonArtifact(
    outputRoot,
    `${options['run-id']}/evaluation-run.json`,
    RealWorldEvaluationRunSchema,
  );
  if (run.runId !== options['run-id'])
    throw usage('Evaluation run artifact does not match --run-id.');
  const summary = await summarizePlanSemanticRun({
    run,
    read: (artifactPath) =>
      readOptionalPlanSemanticEvaluation({
        artifactPath,
        read: (path) => readJsonArtifact(outputRoot, path, PlanSemanticEvaluationSchema),
      }),
  });
  const jsonPath = `${run.runId}/plan-semantic-evaluation.json`;
  const markdownPath = `${run.runId}/plan-semantic-evaluation.md`;
  await writeJsonArtifact(outputRoot, jsonPath, PlanSemanticRunEvaluationSchema, summary);
  await writeMarkdownArtifact(outputRoot, markdownPath, renderPlanSemanticRunSummary(summary));
  process.stdout.write(`Plan semantic run summary: ${jsonPath}\nReport: ${markdownPath}\n`);
  return 0;
}

export function renderPlanSemanticRunSummary(summary: PlanSemanticRunEvaluation): string {
  return [
    '# Generated-plan semantic evaluation summary',
    '',
    `- Run: ${summary.runId}`,
    `- Pack: ${summary.packId}@${summary.packVersion}; split: ${summary.selectedSplit}`,
    '- Semantic evidence: single AI-assisted development review; diagnostic only, not a provider-quality claim',
    `- AI-assisted adjudication coverage: ${summary.adjudicatedTrialCount}/${summary.eligibleTrialCount} eligible plan trials (${summary.missingAdjudicationTrialCount} missing)`,
    '',
    '| Scenario recall | Relevant-vector precision | Covered scenarios | Relevant vectors | Unrelated vectors | Duplicate relevant vectors |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${formatMetric(summary.scenarioRecall)} | ${formatMetric(summary.relevantVectorPrecision)} | ${summary.coveredScenarioCount}/${summary.expectedScenarioCount} | ${summary.relevantVectorCount}/${summary.enabledVectorCount} | ${summary.unrelatedVectorCount} | ${summary.duplicateRelevantVectorCount} |`,
    '',
    'Only completed AI-assisted development adjudications contribute to the metrics. Missing adjudications remain unavailable rather than becoming a passed or failed plan score. This evidence is diagnostic only and never supports an external reliability or provider-selection claim.',
    '',
  ].join('\n');
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

function usage(message: string): SecurityReviewerError {
  return new SecurityReviewerError(
    'invalid-input',
    `${message} Usage: bun run eval:plan-semantic:summary -- --output <evaluation-output-root> --run-id <run-id>`,
  );
}

if (import.meta.main) {
  try {
    process.exitCode = await runPlanSemanticSummary(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected evaluation error.';
    process.stderr.write(`security-reviewer plan evaluation summary: ${message}\n`);
    process.exitCode = 2;
  }
}
