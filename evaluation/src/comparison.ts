import { lstat, readFile } from 'node:fs/promises';
import { z } from 'zod';
import type {
  ModelRoute,
  ModelStage,
  ModelStageObservation,
} from '../../src/features/model-operations/model-operations.schema.js';
import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';
import {
  type EvaluationComparisonKind,
  type EvaluationRunComparison,
  EvaluationRunComparisonSchema,
} from './comparison.schema.js';
import { type RealWorldEvaluationRun, RealWorldEvaluationRunSchema } from './corpus.schema.js';
import { summarizeSemanticPlanMeasurements } from './plan-semantic-summary.js';

/** Reads only a validated, regular local evaluation artifact; target source is never opened. */
export async function loadEvaluationRunForComparison(
  path: string,
): Promise<RealWorldEvaluationRun> {
  const status = await lstat(path).catch(() => undefined);
  if (status === undefined || !status.isFile() || status.isSymbolicLink() || status.size === 0) {
    throw new Error('Evaluation comparison input must be a non-empty regular artifact file.');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Evaluation comparison input is unreadable or invalid JSON.');
  }
  const parsedJson = z.json().safeParse(raw);
  if (!parsedJson.success) throw new Error('Evaluation comparison input is invalid JSON.');
  return RealWorldEvaluationRunSchema.parse(parsedJson.data);
}

/** Compares source-free run summaries; incompatible runs remain visible but are not comparable. */
export function compareEvaluationRuns(
  baselineRun: RealWorldEvaluationRun,
  candidateRun: RealWorldEvaluationRun,
  kind: EvaluationComparisonKind = 'same-route-regression',
): EvaluationRunComparison {
  const baseline = identityFor(baselineRun);
  const candidate = identityFor(candidateRun);
  const incompatibilities = incompatibilitiesFor(baseline, candidate, kind);
  const comparable = incompatibilities.length === 0;
  const baselineFindingTotals = findingTotals(baselineRun);
  const candidateFindingTotals = findingTotals(candidateRun);
  const baselineSemantic = summarizeSemanticPlanMeasurements(
    baselineRun.planProfile,
    baselineRun.trials,
  );
  const candidateSemantic = summarizeSemanticPlanMeasurements(
    candidateRun.planProfile,
    candidateRun.trials,
  );
  const baselineObservation = baselineRun.reliability.modelObservation;
  const candidateObservation = candidateRun.reliability.modelObservation;
  const stageKeys = new Set<string>([
    ...(baselineObservation?.stages.map((stage) => `${stage.stage}\0${stage.route}`) ?? []),
    ...(candidateObservation?.stages.map((stage) => `${stage.stage}\0${stage.route}`) ?? []),
  ]);
  return EvaluationRunComparisonSchema.parse({
    schemaVersion: 2,
    kind,
    baseline,
    candidate,
    comparable,
    incompatibilities,
    metrics: comparable
      ? {
          completionRate: metric(
            baselineRun.reliability.completionRate,
            candidateRun.reliability.completionRate,
          ),
          semanticEvaluatorCompletionRate: metric(
            baselineSemantic?.completionRate ?? null,
            candidateSemantic?.completionRate ?? null,
          ),
          semanticScenarioRecall: metric(
            baselineSemantic?.scenarioRecall ?? null,
            candidateSemantic?.scenarioRecall ?? null,
          ),
          semanticRelevantVectorPrecision: metric(
            baselineSemantic?.relevantVectorPrecision ?? null,
            candidateSemantic?.relevantVectorPrecision ?? null,
          ),
          semanticUnrelatedVectorCount: metric(
            baselineSemantic?.unrelatedVectorCount ?? null,
            candidateSemantic?.unrelatedVectorCount ?? null,
          ),
          findingJaccard: metric(
            baselineRun.reliability.findingJaccard,
            candidateRun.reliability.findingJaccard,
          ),
          findingRecallMedian: metric(
            baselineRun.reliability.findingRecallMedian,
            candidateRun.reliability.findingRecallMedian,
          ),
          allTerminalDurationMsP95: metric(
            baselineRun.reliability.allTerminalDurationMsP95,
            candidateRun.reliability.allTerminalDurationMsP95,
          ),
          truePositives: metric(
            baselineFindingTotals.truePositives,
            candidateFindingTotals.truePositives,
          ),
          adjudicatedFalsePositives: metric(
            baselineFindingTotals.adjudicatedFalsePositives,
            candidateFindingTotals.adjudicatedFalsePositives,
          ),
          unadjudicatedFindings: metric(
            baselineFindingTotals.unadjudicatedFindings,
            candidateFindingTotals.unadjudicatedFindings,
          ),
          falseNegatives: metric(
            baselineFindingTotals.falseNegatives,
            candidateFindingTotals.falseNegatives,
          ),
          modelCalls: metric(
            baselineObservation?.usage.modelCallCount ?? null,
            candidateObservation?.usage.modelCallCount ?? null,
          ),
          inputTokens: metric(
            baselineObservation?.usage.inputTokens ?? null,
            candidateObservation?.usage.inputTokens ?? null,
          ),
          cachedInputTokens: metric(
            baselineObservation?.usage.cachedInputTokens ?? null,
            candidateObservation?.usage.cachedInputTokens ?? null,
          ),
          outputTokens: metric(
            baselineObservation?.usage.outputTokens ?? null,
            candidateObservation?.usage.outputTokens ?? null,
          ),
          reasoningTokens: metric(
            baselineObservation?.usage.reasoningTokens ?? null,
            candidateObservation?.usage.reasoningTokens ?? null,
          ),
          toolCalls: metric(
            baselineObservation?.toolUsage.toolCallCount ?? null,
            candidateObservation?.toolUsage.toolCallCount ?? null,
          ),
          returnedBytes: metric(
            baselineObservation?.toolUsage.returnedBytes ?? null,
            candidateObservation?.toolUsage.returnedBytes ?? null,
          ),
          estimatedCostUsd: metric(
            baselineObservation?.cost.estimatedCostUsd ?? null,
            candidateObservation?.cost.estimatedCostUsd ?? null,
          ),
        }
      : null,
    stages: comparable
      ? [...stageKeys]
          .sort((left, right) => left.localeCompare(right))
          .map((key) => {
            const [stage, route] = key.split('\0') as [ModelStage, ModelRoute];
            return stageComparison(
              stage,
              route,
              baselineObservation?.stages ?? [],
              candidateObservation?.stages ?? [],
            );
          })
      : [],
  });
}

export function renderEvaluationRunComparison(comparison: EvaluationRunComparison): string {
  const lines = [
    '# Audit evaluation comparison',
    '',
    `- Baseline: \`${comparison.baseline.runId}\``,
    `- Candidate: \`${comparison.candidate.runId}\``,
    `- Kind: ${comparison.kind}`,
    `- Comparable: ${comparison.comparable ? 'yes' : 'no'}`,
    '',
  ];
  if (!comparison.comparable) {
    lines.push(
      '## Incompatibilities',
      '',
      ...comparison.incompatibilities.map((item) => `- ${item}`),
      '',
    );
  }
  if (!comparison.comparable || comparison.metrics === null) {
    lines.push(
      'No score, cost, latency, or stage deltas are shown because these artifacts are not comparable.',
      '',
    );
    return lines.join('\n');
  }
  lines.push(
    '## Aggregate deltas',
    '',
    '| Metric | Baseline | Candidate | Delta |',
    '| --- | ---: | ---: | ---: |',
    ...Object.entries(comparison.metrics).map(([name, value]) =>
      metricRow(
        name,
        value.baseline,
        value.candidate,
        value.delta,
        comparison.baseline.planProfile === 'audit-reviewed-plan' && name.startsWith('semantic'),
      ),
    ),
    '',
    '## Per-stage deltas',
    '',
    '| Stage | Route | Calls | Input | Output | Tool calls | Duration | Cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...comparison.stages.map(
      (stage) =>
        `| ${stage.stage} | ${stage.route} | ${formatDelta(stage.modelCalls.delta)} | ${formatDelta(stage.inputTokens.delta)} | ${formatDelta(stage.outputTokens.delta)} | ${formatDelta(stage.toolCalls.delta)} | ${formatDelta(stage.durationMs.delta)} | ${formatCostDelta(stage.estimatedCostUsd.delta)} |`,
    ),
    '',
    'All values are source-free aggregate telemetry. A non-comparable result is diagnostic only and must not support a quality or cost conclusion.',
    '',
  );
  return lines.join('\n');
}

function identityFor(run: RealWorldEvaluationRun) {
  return {
    runId: run.runId,
    packId: run.packId,
    packVersion: run.packVersion,
    corpusManifestDigest: run.corpusManifestDigest,
    populationDigest: run.populationDigest,
    benchmarkProtocolFingerprint: run.benchmarkProtocolFingerprint,
    /** Model-route-independent frozen setup used only for primary-model experiments. */
    primaryModelExperimentFingerprint: sha256(
      canonicalJson({
        packId: run.packId,
        packVersion: run.packVersion,
        corpusManifestDigest: run.corpusManifestDigest,
        populationDigest: run.populationDigest,
        mode: run.mode,
        selectedSplit: run.selectedSplit,
        caseIdFilter: run.caseIdFilter ?? null,
        findingCoverage: run.findingCoverage,
        repetitions: run.repetitions,
        planProfile: run.planProfile,
        executionBudget: run.executionBudget,
        maxParallelVectors: run.maxParallelVectors,
        promptProtocolFingerprint: run.promptProtocolFingerprint,
        semanticPlanEvaluator: run.semanticPlanEvaluator,
        holdoutAttestationFingerprint:
          run.holdoutAttestation === undefined
            ? null
            : sha256(canonicalJson(run.holdoutAttestation)),
        costSource: run.reliability.modelObservation?.cost.source ?? null,
      }),
    ),
    mode: run.mode,
    provider: run.provider,
    model: run.model,
    verificationMode: run.verificationMode,
    verificationRouteFingerprint: run.verificationRouteFingerprint,
    selectedSplit: run.selectedSplit,
    caseIdFilter: run.caseIdFilter ?? null,
    findingCoverage: run.findingCoverage,
    repetitions: run.repetitions,
    planProfile: run.planProfile,
    semanticPlanEvaluator: run.semanticPlanEvaluator,
    executionBudgetFingerprint: sha256(JSON.stringify(run.executionBudget)),
    maxParallelVectors: run.maxParallelVectors,
    promptProtocolFingerprint: run.promptProtocolFingerprint,
    holdoutAttestationFingerprint:
      run.holdoutAttestation === undefined ? null : sha256(canonicalJson(run.holdoutAttestation)),
    costSource: run.reliability.modelObservation?.cost.source ?? null,
  };
}

function incompatibilitiesFor(
  baseline: ReturnType<typeof identityFor>,
  candidate: ReturnType<typeof identityFor>,
  kind: EvaluationComparisonKind,
): string[] {
  const fields: ReadonlyArray<readonly [keyof typeof baseline, string]> = [
    ['packId', 'pack id'],
    ['packVersion', 'pack version'],
    ['corpusManifestDigest', 'corpus manifest'],
    ['populationDigest', 'selected corpus population'],
    ['benchmarkProtocolFingerprint', 'benchmark protocol'],
    ['mode', 'mode'],
    ['verificationMode', 'verification mode'],
    ['selectedSplit', 'split'],
    ['caseIdFilter', 'case selector'],
    ['findingCoverage', 'finding-label coverage'],
    ['repetitions', 'repeat count'],
    ['planProfile', 'plan profile'],
    ['executionBudgetFingerprint', 'execution budget'],
    ['holdoutAttestationFingerprint', 'private-holdout attestation'],
    ['costSource', 'cost source'],
  ];
  const result = fields
    .filter(
      ([field]) => kind !== 'primary-model-experiment' || field !== 'benchmarkProtocolFingerprint',
    )
    .flatMap(([field, label]) =>
      baseline[field] === candidate[field] ? [] : [`Different ${label}.`],
    );
  if (kind === 'same-route-regression') {
    const routeFields: ReadonlyArray<
      readonly ['provider' | 'model' | 'verificationRouteFingerprint', string]
    > = [
      ['provider', 'provider'],
      ['model', 'model'],
      ['verificationRouteFingerprint', 'verification route'],
    ];
    result.push(
      ...routeFields.flatMap(([field, label]) =>
        baseline[field] === candidate[field] ? [] : [`Different ${label}.`],
      ),
    );
  } else if (
    baseline.verificationMode !== 'same-route' ||
    candidate.verificationMode !== 'same-route'
  ) {
    result.push('Primary-model experiments require same-route verification.');
  }
  if (
    kind === 'primary-model-experiment' &&
    baseline.primaryModelExperimentFingerprint !== candidate.primaryModelExperimentFingerprint
  ) {
    result.push('Different primary-model experiment setup.');
  }
  if (baseline.promptProtocolFingerprint !== candidate.promptProtocolFingerprint) {
    result.push('Different prompt protocol.');
  }
  if (baseline.maxParallelVectors !== candidate.maxParallelVectors) {
    result.push('Different vector concurrency.');
  }
  if (
    canonicalJson(baseline.semanticPlanEvaluator) !== canonicalJson(candidate.semanticPlanEvaluator)
  ) {
    result.push('Different semantic evaluator identity.');
  }
  return result;
}

function findingTotals(run: RealWorldEvaluationRun) {
  return run.trials.reduce(
    (total, trial) => ({
      truePositives: total.truePositives + (trial.findingScore?.truePositives ?? 0),
      adjudicatedFalsePositives:
        total.adjudicatedFalsePositives + (trial.findingScore?.falsePositives ?? 0),
      unadjudicatedFindings:
        total.unadjudicatedFindings + (trial.findingScore?.unmatchedUnadjudicatedCount ?? 0),
      falseNegatives: total.falseNegatives + (trial.findingScore?.falseNegatives ?? 0),
    }),
    { truePositives: 0, adjudicatedFalsePositives: 0, unadjudicatedFindings: 0, falseNegatives: 0 },
  );
}

function metric(baseline: number | null, candidate: number | null) {
  return {
    baseline,
    candidate,
    delta: baseline === null || candidate === null ? null : candidate - baseline,
  };
}

function stageComparison(
  stage: ModelStage,
  route: ModelRoute,
  baselineStages: readonly ModelStageObservation[],
  candidateStages: readonly ModelStageObservation[],
) {
  const baseline = summarizeStage(stage, route, baselineStages);
  const candidate = summarizeStage(stage, route, candidateStages);
  return {
    stage,
    route,
    modelCalls: metric(baseline?.modelCalls ?? null, candidate?.modelCalls ?? null),
    inputTokens: metric(baseline?.inputTokens ?? null, candidate?.inputTokens ?? null),
    outputTokens: metric(baseline?.outputTokens ?? null, candidate?.outputTokens ?? null),
    toolCalls: metric(baseline?.toolCalls ?? null, candidate?.toolCalls ?? null),
    durationMs: metric(baseline?.durationMs ?? null, candidate?.durationMs ?? null),
    estimatedCostUsd: metric(baseline?.cost ?? null, candidate?.cost ?? null),
  };
}

function summarizeStage(
  stage: ModelStage,
  route: ModelRoute,
  observations: readonly ModelStageObservation[],
) {
  const selected = observations.filter(
    (observation) => observation.stage === stage && observation.route === route,
  );
  if (selected.length === 0) return undefined;
  return selected.reduce(
    (total, observation) => ({
      modelCalls: total.modelCalls + observation.usage.modelCallCount,
      inputTokens: total.inputTokens + observation.usage.inputTokens,
      outputTokens: total.outputTokens + observation.usage.outputTokens,
      toolCalls: total.toolCalls + observation.toolUsage.toolCallCount,
      durationMs: total.durationMs + observation.durationMs,
      cost:
        total.cost === null || observation.cost.estimatedCostUsd === null
          ? null
          : total.cost + observation.cost.estimatedCostUsd,
    }),
    {
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      durationMs: 0,
      cost: 0 as number | null,
    },
  );
}

function metricRow(
  name: string,
  baseline: number | null,
  candidate: number | null,
  delta: number | null,
  notApplicable: boolean,
) {
  if (notApplicable) return `| ${name} | not applicable | not applicable | not applicable |`;
  const formatter = name === 'estimatedCostUsd' ? formatCost : formatNumber;
  return `| ${name} | ${formatter(baseline)} | ${formatter(candidate)} | ${formatter(delta)} |`;
}

function formatNumber(value: number | null): string {
  return value === null ? 'unavailable' : value.toFixed(3);
}

function formatCost(value: number | null): string {
  return value === null ? 'unavailable' : `$${value.toFixed(6)}`;
}

function formatDelta(value: number | null): string {
  return value === null ? 'unavailable' : `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
}

function formatCostDelta(value: number | null): string {
  return value === null ? 'unavailable' : `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(6)}`;
}
