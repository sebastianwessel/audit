import type { StageIsolatedEvaluationStagePublicResult } from './stage-isolated.schema.js';
import {
  type StageIsolatedComparisonKind,
  type StageIsolatedComparisonMismatchToken,
  type StageIsolatedEvaluationComparison,
  type StageIsolatedEvaluationComparisonDeltas,
  StageIsolatedEvaluationComparisonInputSchema,
  StageIsolatedEvaluationComparisonSchema,
} from './stage-isolated-comparison.schema.js';

/**
 * Compares two source-free stage artifacts. It never accepts normal evaluation
 * runs, never exposes artifact identifiers, and withholds all deltas unless
 * every sealed non-experiment identity dimension matches exactly.
 */
export function compareStageIsolatedEvaluations(input: {
  comparisonKind: StageIsolatedComparisonKind;
  baseline: StageIsolatedEvaluationStagePublicResult;
  candidate: StageIsolatedEvaluationStagePublicResult;
}): StageIsolatedEvaluationComparison {
  const parsed = StageIsolatedEvaluationComparisonInputSchema.parse(input);
  const mismatchTokens = mismatchTokensFor(parsed);
  return StageIsolatedEvaluationComparisonSchema.parse({
    schemaVersion: 1,
    comparable: mismatchTokens.length === 0,
    mismatchTokens,
    deltas: mismatchTokens.length === 0 ? deltasFor(parsed.baseline, parsed.candidate) : null,
  });
}

function mismatchTokensFor(input: {
  comparisonKind: StageIsolatedComparisonKind;
  baseline: StageIsolatedEvaluationStagePublicResult;
  candidate: StageIsolatedEvaluationStagePublicResult;
}): StageIsolatedComparisonMismatchToken[] {
  const { baseline, candidate } = input;
  const baselinePack = baseline.pack;
  const candidatePack = candidate.pack;
  const tokens: StageIsolatedComparisonMismatchToken[] = [];
  const compare = (token: StageIsolatedComparisonMismatchToken, matches: boolean): void => {
    if (!matches) tokens.push(token);
  };

  compare('stage', baselinePack.stage === candidatePack.stage);
  compare('plan-profile', baselinePack.planProfile === candidatePack.planProfile);
  compare('corpus-pack-id', baselinePack.corpusPackId === candidatePack.corpusPackId);
  compare(
    'corpus-pack-version',
    baselinePack.corpusPackVersion === candidatePack.corpusPackVersion,
  );
  compare(
    'corpus-manifest-fingerprint',
    baselinePack.corpusManifestFingerprint === candidatePack.corpusManifestFingerprint,
  );
  compare(
    'corpus-source-digest',
    baselinePack.corpusSourceDigest === candidatePack.corpusSourceDigest,
  );
  compare('target-fingerprint', baselinePack.targetFingerprint === candidatePack.targetFingerprint);
  compare('context-digest', baselinePack.contextDigest === candidatePack.contextDigest);
  compare(
    'selected-trial',
    baselinePack.caseId === candidatePack.caseId &&
      baselinePack.variant === candidatePack.variant &&
      baselinePack.repetition === candidatePack.repetition,
  );
  compare(
    'workflow-protocol-fingerprint',
    baselinePack.workflowProtocolFingerprint === candidatePack.workflowProtocolFingerprint,
  );
  compare(
    'stage-protocol-fingerprint',
    baselinePack.stageProtocolFingerprint === candidatePack.stageProtocolFingerprint,
  );
  compare(
    'evaluator-protocol-fingerprint',
    baselinePack.evaluatorProtocolFingerprint === candidatePack.evaluatorProtocolFingerprint,
  );
  compare('evaluator-provider', baselinePack.evaluatorProvider === candidatePack.evaluatorProvider);
  compare('evaluator-model', baselinePack.evaluatorModel === candidatePack.evaluatorModel);
  compare('evaluator-route', baselinePack.evaluatorRoute === candidatePack.evaluatorRoute);
  compare(
    'expected-outcome-denominator',
    baselinePack.expectedOutcomeCount === candidatePack.expectedOutcomeCount,
  );
  compare('route', baselinePack.route === candidatePack.route);

  if (input.comparisonKind === 'same-stage-regression') {
    compare('primary-provider', baselinePack.provider === candidatePack.provider);
    compare('primary-model', baselinePack.model === candidatePack.model);
  } else {
    compare(
      'primary-route-required',
      baselinePack.route === 'primary' && candidatePack.route === 'primary',
    );
  }
  return tokens;
}

function deltasFor(
  baseline: StageIsolatedEvaluationStagePublicResult,
  candidate: StageIsolatedEvaluationStagePublicResult,
): StageIsolatedEvaluationComparisonDeltas {
  const baselineToolUsage = baseline.toolInspection.usage;
  const candidateToolUsage = candidate.toolInspection.usage;
  return {
    completion: {
      completed: countMetric(
        baseline.completion.status === 'completed',
        candidate.completion.status === 'completed',
      ),
      incomplete: countMetric(
        baseline.completion.status === 'incomplete',
        candidate.completion.status === 'incomplete',
      ),
      failed: countMetric(
        baseline.completion.status === 'failed',
        candidate.completion.status === 'failed',
      ),
      cancelled: countMetric(
        baseline.completion.status === 'cancelled',
        candidate.completion.status === 'cancelled',
      ),
    },
    validation: {
      inputErrorCodeCount: countMetric(
        baseline.validation.input.errorCodes.length,
        candidate.validation.input.errorCodes.length,
      ),
      outputErrorCodeCount: countMetric(
        baseline.validation.output.errorCodes.length,
        candidate.validation.output.errorCodes.length,
      ),
    },
    semanticOutcome: {
      expectedOutcomeCount: countMetric(
        baseline.pack.expectedOutcomeCount,
        candidate.pack.expectedOutcomeCount,
      ),
      matchedExpectedOutcomeCount: countMetric(
        baseline.semanticOutcome.matchedExpectedOutcomeCount,
        candidate.semanticOutcome.matchedExpectedOutcomeCount,
      ),
      missingExpectedOutcomeCount: countMetric(
        baseline.semanticOutcome.missingExpectedOutcomeCount,
        candidate.semanticOutcome.missingExpectedOutcomeCount,
      ),
      notApplicableExpectedOutcomeCount: countMetric(
        baseline.semanticOutcome.notApplicableExpectedOutcomeCount,
        candidate.semanticOutcome.notApplicableExpectedOutcomeCount,
      ),
      unexpectedOutcomeCount: countMetric(
        baseline.semanticOutcome.unexpectedOutcomeCount,
        candidate.semanticOutcome.unexpectedOutcomeCount,
      ),
    },
    localization: {
      matchedExpectedOutcomeWithRoleBundleCount: countMetric(
        baseline.localization.matchedExpectedOutcomeWithRoleBundleCount,
        candidate.localization.matchedExpectedOutcomeWithRoleBundleCount,
      ),
      roleBundleCount: countMetric(
        baseline.localization.roleBundleCount,
        candidate.localization.roleBundleCount,
      ),
      roleCount: countMetric(baseline.localization.roleCount, candidate.localization.roleCount),
      locationCount: countMetric(
        baseline.localization.locationCount,
        candidate.localization.locationCount,
      ),
    },
    toolInspection: {
      scopedManifestEntryCount: countMetric(
        baseline.toolInspection.scopedManifestEntryCount,
        candidate.toolInspection.scopedManifestEntryCount,
      ),
      toolCallCount: countMetric(baselineToolUsage.toolCallCount, candidateToolUsage.toolCallCount),
      listFilesCallCount: countMetric(
        baselineToolUsage.listFilesCallCount,
        candidateToolUsage.listFilesCallCount,
      ),
      readFileCallCount: countMetric(
        baselineToolUsage.readFileCallCount,
        candidateToolUsage.readFileCallCount,
      ),
      grepFilesCallCount: countMetric(
        baselineToolUsage.grepFilesCallCount,
        candidateToolUsage.grepFilesCallCount,
      ),
      successfulReadFileCallCount: countMetric(
        baselineToolUsage.successfulReadFileCallCount,
        candidateToolUsage.successfulReadFileCallCount,
      ),
      successfulGrepFilesCallCount: countMetric(
        baselineToolUsage.successfulGrepFilesCallCount,
        candidateToolUsage.successfulGrepFilesCallCount,
      ),
      rejectedCallCount: countMetric(
        baselineToolUsage.rejectedCallCount,
        candidateToolUsage.rejectedCallCount,
      ),
      returnedBytes: countMetric(baselineToolUsage.returnedBytes, candidateToolUsage.returnedBytes),
    },
    telemetry: {
      latencyMs: countMetric(baseline.telemetry.latencyMs, candidate.telemetry.latencyMs),
      modelCallCount: countMetric(
        baseline.telemetry.usage.modelCallCount,
        candidate.telemetry.usage.modelCallCount,
      ),
      inputTokens: countMetric(
        baseline.telemetry.usage.inputTokens,
        candidate.telemetry.usage.inputTokens,
      ),
      cachedInputTokens: countMetric(
        baseline.telemetry.usage.cachedInputTokens,
        candidate.telemetry.usage.cachedInputTokens,
      ),
      outputTokens: countMetric(
        baseline.telemetry.usage.outputTokens,
        candidate.telemetry.usage.outputTokens,
      ),
      reasoningTokens: countMetric(
        baseline.telemetry.usage.reasoningTokens,
        candidate.telemetry.usage.reasoningTokens,
      ),
      totalTokens: countMetric(
        baseline.telemetry.cost.totalTokens,
        candidate.telemetry.cost.totalTokens,
      ),
      estimatedCostUsd: metric(
        baseline.telemetry.cost.estimatedCostUsd,
        candidate.telemetry.cost.estimatedCostUsd,
      ),
    },
  };
}

function countMetric(
  baseline: number | boolean,
  candidate: number | boolean,
): Readonly<{ baseline: number; candidate: number; delta: number }> {
  const normalizedBaseline = Number(baseline);
  const normalizedCandidate = Number(candidate);
  return {
    baseline: normalizedBaseline,
    candidate: normalizedCandidate,
    delta: normalizedCandidate - normalizedBaseline,
  };
}

function metric(baseline: number | null, candidate: number | null) {
  return {
    baseline,
    candidate,
    delta: baseline === null || candidate === null ? null : candidate - baseline,
  };
}
