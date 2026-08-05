import {
  aggregateCandidateIntegrityRejectionLedgers,
  aggregateDiscoveryIntegrityRejectionLedgers,
  aggregateFindingAdmissionFunnels,
  aggregateHypothesisGroundingFunnels,
} from '../../src/features/audit-execution/admission/funnel.js';
import type { BaselineComparison } from './baseline.js';
import type { LoadedCorpusPack } from './corpus.js';
import type { RealWorldEvaluationRun } from './corpus.schema.js';
import { describeEvaluationEvidenceQualification } from './corpus-readiness.js';

export function renderRealWorldEvaluationReport(
  pack: LoadedCorpusPack,
  run: RealWorldEvaluationRun,
  baseline?: BaselineComparison,
): string {
  const caseById = new Map(pack.cases.map((entry) => [entry.case.caseId, entry.case]));
  const outcomeSummaries = summarizeCaseOutcomes(run);
  const pressure = findingPressure(outcomeSummaries);
  const lines = [
    '# Audit evaluation analysis',
    '',
    `- Pack: \`${run.packId}@${run.packVersion}\``,
    `- Mode: ${run.mode}`,
    `- Provider/model: ${run.provider} / ${run.model}`,
    `- Verification route: ${run.verificationMode}`,
    `- Split: ${run.selectedSplit}; repetitions: ${run.repetitions}`,
    `- Interpretation: ${repetitionInterpretation(run.repetitions)}`,
    `- Case selection: ${run.caseIdFilter === undefined ? 'all cases in split' : `\`${run.caseIdFilter}\``}`,
    `- Plan profile: ${run.planProfile}`,
    `- Vector concurrency: ${run.maxParallelVectors}`,
    `- Prompt protocol: ${run.promptProtocolFingerprint}`,
    `- Diagnostic gate: ${run.diagnosticGatePassed ? 'passed' : 'failed'}`,
    `- Trial states: ${formatTrialStates(run)}`,
    `- Finding-label coverage: ${formatFindingCoverage(run.findingCoverage)}`,
    `- Evidence qualification: ${run.evidenceQualification}`,
    `- Private-holdout attestation: ${formatHoldoutAttestation(run)}`,
    '',
    '## Evidence strength',
    '',
    'These dimensions state exactly what this run can and cannot establish. They do not change scores or product results.',
    '',
    '| Dimension | Status | Meaning |',
    '| --- | --- | --- |',
    ...formatEvidenceStrength(run),
    '',
    '## Evidence qualification',
    '',
    describeEvaluationEvidenceQualification(run.evidenceQualification),
    '',
    '## Generated-plan coverage',
    '',
    ...formatPlanCoverage(run),
    '',
    '## Audit-dispatch boundary',
    '',
    'Only enabled vectors are dispatched. An unpromoted observation cannot produce a finding, pass, or incomplete coverage result. Incomplete coverage always means one or more enabled-vector obligations did not close.',
    ...(run.planProfile === 'planning-generated'
      ? ['', 'This profile intentionally stops after planning; audit execution was not run.']
      : []),
    '',
    '## Diagnostic execution summary',
    '',
    `Finding-score scope: ${findingMetricScope(run)}`,
    '',
    '| Completion | Plan agreement | Finding agreement | All-role terminal-evidence recall minimum | All-role terminal-evidence recall median | Vulnerable false negatives | Patched matches | Adjudicated FP | Unadjudicated | All-terminal latency p95 | Completed-only latency p95 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${formatMetric(run.reliability.completionRate)} | ${formatMetric(run.reliability.planJaccard)} | ${formatMetric(run.reliability.findingJaccard)} | ${formatMetric(run.reliability.findingRecallMinimum)} | ${formatMetric(run.reliability.findingRecallMedian)} | ${pressure.vulnerableFalseNegatives} | ${pressure.patchedMatchingFindings} | ${pressure.adjudicatedFalsePositives} | ${pressure.unadjudicatedFindings} | ${formatDuration(run.reliability.allTerminalDurationMsP95)} | ${formatDuration(run.reliability.completedDurationMsP95)} |`,
    '',
    '## Review-required queue (non-gating)',
    '',
    'These counts measure source-backed items preserved for human adjudication. They do not change confirmed-finding precision, recall, or the release gate.',
    '',
    '| Expected vulnerable review-required matches | Non-vulnerable review-required items | Vulnerable unmatched review-required expectations |',
    '| ---: | ---: | ---: |',
    formatReviewRequiredSummary(run),
    '',
    '## Retained unscored outcomes',
    '',
    'When an audit reaches a non-completed terminal state after producing accepted or review-required output, those identities remain available for investigation but are excluded from every score and release gate.',
    '',
    '| Case | Variant | Repeat | Accepted observations | Review-required observations | Status |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...formatRetainedUnscoredOutcomes(run),
    '',
    '## Model usage',
    '',
    '| Calls | Input | Cached input | Output | Reasoning | Estimated cost | Cache routing |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    formatModelUsage(run),
    '',
    '### File-tool usage',
    '',
    '| Calls | List attempts | Read attempts | Search attempts | Successful reads | Successful searches | Rejected | Returned bytes |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    formatToolUsage(run),
    '',
    '### By workflow stage',
    '',
    '| Stage | Route | Model calls | Tool calls | Input | Output | Returned bytes | Rejected | Estimated cost | Completed | Failed |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...formatStageUsage(run),
    '',
    '### Cost and latency hotspots',
    '',
    'Source-free aggregate by case, variant, and workflow stage. Use this before changing prompts, tools, or budgets.',
    '',
    '| Case | Variant | Stage | Route | Calls | Input | Output | Tool calls | Duration | Estimated cost |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...formatOperationalHotspots(run),
    '',
    '### Provider requests',
    '',
    '| Stage | Route | Request | Duration | Input | Cached input | Output | Reasoning | Estimated cost |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...formatRequestUsage(run),
    '',
    '## Per-trial execution trace',
    '',
    'The adjacent `case-results.jsonl` artifact contains one complete, source-free trial record per line. Its ordered trace shows every model response and repository-tool operation, including operation kind, completion/rejection, duration, returned-byte count, stable error code, token usage, and cost. It intentionally excludes prompts, source, paths, tool arguments/results, secrets, and model output.',
    '',
    '| Case | Variant | Repeat | Status | Stages and ordered flow | Duration | Error |',
    '| --- | --- | ---: | --- | --- | ---: | --- |',
    ...formatTrialExecutionTrace(run),
    '',
    '### Expected-evidence stage coverage',
    '',
    'Evaluator-only provenance diagnostic for expected evidence. It separates first loss in an earlier stage from evidence selected by the exact terminal finding. It is not a security conclusion or model input.',
    '',
    '| Expected roles | Mapped locations | Grounded role evidence | Verifier output role evidence | First incomplete stage |',
    '| ---: | ---: | ---: | ---: | --- |',
    ...formatStageEvidenceCoverage(run),
    '',
    '### Expected-role first-loss trace',
    '',
    'Evaluator-only derived trace for each applicable expected evidence role. It contains no source locations, map facts, seeds, candidates, prompts, tool data, or model output. “Terminal finding” comes from the same canonical matching projection as finding recall, so a complete terminal match has every applicable role selected.',
    '',
    '| Case | Variant | Repeat | Expected finding | Role | Plan scope | Map | Posture | Discovery | Grounding | Verifier | Terminal finding | Terminal coverage | First loss |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...formatExpectedEvidenceRoleTraces(run),
    '',
    '### Completed-trial finding admission funnel',
    '',
    'Aggregate terminal hypothesis decisions from completed trials. It is diagnostic only and contains no source or model content.',
    '',
    '| Model candidates | Integrity rejected | Tool evidence rejected | Verifier accepted/rejected/incomplete | Verifier tool evidence rejected | Verifier evidence rejected | Reconciled | Post-verification rejected | Duplicates collapsed | Findings admitted |',
    '| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    formatAdmissionFunnel(run, 'completed'),
    '',
    '### Completed-trial candidate-aware terminal lanes',
    '',
    'These count-only lanes distinguish model-declared incompleteness from operational or projection failures. They contain no source, prompt, model explanation, or finding content.',
    '',
    '| Accepted | Rejected | Model incomplete | Stage failed | Inspection missing | Wrapper contract invalid |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    formatVerificationTerminalLanes(run, 'completed'),
    '',
    '### Completed-trial hypothesis grounding funnel',
    '',
    'Source-free accounting of where non-reportable discovery hypotheses did or did not become canonical candidates.',
    '',
    '| Discovered seeds | Discovery binding rejected | Grounding null | Grounding binding rejected | Submitted candidates |',
    '| ---: | ---: | ---: | ---: | ---: |',
    formatHypothesisGroundingFunnel(run, 'completed'),
    '',
    '### Completed-trial discovery binding rejection categories',
    '',
    'Counts explain discovery seed loss without retaining seed, source, or model content.',
    '',
    '| Invalid shape | Duplicate seed | Wrong vector | Invalid obligations | Invalid map refs | Invalid posture refs |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    formatDiscoveryIntegrityRejections(run, 'completed'),
    '',
    '### Completed-trial candidate integrity rejection categories',
    '',
    'Counts explain structural candidate loss without retaining candidate, source, or model content.',
    '',
    '| Invalid shape | Invalid obligations | Invalid map refs | Invalid posture refs | Insufficient claim evidence | Invalid or out-of-scope evidence |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    formatCandidateIntegrityRejections(run, 'completed'),
    '',
    '### Incomplete-trial finding admission funnel',
    '',
    'Incomplete-trial accounting is separate from completed results and is excluded from quality metrics and release gates.',
    '',
    '| Model candidates | Integrity rejected | Tool evidence rejected | Verifier accepted/rejected/incomplete | Verifier tool evidence rejected | Verifier evidence rejected | Reconciled | Post-verification rejected | Duplicates collapsed | Findings admitted |',
    '| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    formatAdmissionFunnel(run, 'incomplete'),
    '',
    '### Incomplete-trial candidate-aware terminal lanes',
    '',
    '| Accepted | Rejected | Model incomplete | Stage failed | Inspection missing | Wrapper contract invalid |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    formatVerificationTerminalLanes(run, 'incomplete'),
    '',
    '### Incomplete-trial hypothesis grounding funnel',
    '',
    '| Discovered seeds | Discovery binding rejected | Grounding null | Grounding binding rejected | Submitted candidates |',
    '| ---: | ---: | ---: | ---: | ---: |',
    formatHypothesisGroundingFunnel(run, 'incomplete'),
    '',
    '### Incomplete-trial discovery binding rejection categories',
    '',
    '| Invalid shape | Duplicate seed | Wrong vector | Invalid obligations | Invalid map refs | Invalid posture refs |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    formatDiscoveryIntegrityRejections(run, 'incomplete'),
    '',
    '### Incomplete-trial candidate integrity rejection categories',
    '',
    '| Invalid shape | Invalid obligations | Invalid map refs | Invalid posture refs | Insufficient claim evidence | Invalid or out-of-scope evidence |',
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    formatCandidateIntegrityRejections(run, 'incomplete'),
    '',
    '## Case outcomes',
    '',
    '| Case | Language | Difficulty | Variant | Completed | All-role terminal-evidence recall min/median | Complete terminal matches | Partial terminal matches | Adjudicated FP | Unadjudicated | Patched match | False negatives | Status |',
    '| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const summary of outcomeSummaries) {
    const entry = caseById.get(summary.caseId);
    lines.push(
      `| \`${summary.caseId}\` | ${entry?.language ?? 'unknown'} | ${entry?.difficulty ?? 'unknown'} | ${summary.variant} | ${summary.completedTrials}/${summary.totalTrials} | ${formatMetric(summary.minimumRecall)}/${formatMetric(summary.medianRecall)} | ${summary.matchedLocalizedCount} | ${summary.matchedMislocalizedCount} | ${summary.unmatchedAdjudicatedFalsePositiveCount} | ${summary.unmatchedUnadjudicatedCount} | ${summary.patchedMatchingFindingCount} | ${summary.falseNegatives} | ${formatCaseStatus(summary)} |`,
    );
  }
  lines.push('', '## Improvement signals', '');
  const signals = improvementSignals(run);
  lines.push(...(signals.length === 0 ? ['No critical regression signal was produced.'] : signals));
  if (baseline !== undefined) {
    lines.push('', '## Baseline comparison', '');
    lines.push(`- Result: ${baseline.passed ? 'passed' : 'failed'}`);
    lines.push(
      ...(baseline.violations.length === 0 ? [] : baseline.violations.map((item) => `- ${item}`)),
    );
  }
  return `${lines.join('\n')}\n`;
}

function repetitionInterpretation(repetitions: number): string {
  return repetitions === 1
    ? 'single-run diagnostic; not stability or reliability evidence'
    : repetitions < 5
      ? 'multi-run diagnostic; agreement and distribution are reported when defined'
      : 'repeated measurement; interpret reliability only with qualified corpus evidence';
}

function formatEvidenceStrength(run: RealWorldEvaluationRun): string[] {
  const totalTrials = run.trials.length;
  const completedTrials = run.reliability.completedTrials;
  const semanticPlan = semanticPlanMeasurement(run);
  return [
    `| Operational completion | ${run.measurementState.workflow} (${completedTrials}/${totalTrials} completed) | Completed trials show the workflow reached a terminal audit or planning result; they do not establish detection quality. |`,
    `| Semantic-plan measurement | ${run.measurementState.semanticPlan} (${semanticPlan.status}) | ${semanticPlan.meaning} |`,
    `| Finding measurement | ${run.measurementState.finding} | ${findingMeasurementMeaning(run)} |`,
    `| Precision availability | ${precisionAvailability(run)} | ${precisionMeaning(run)} |`,
    `| Corpus qualification | ${run.evidenceQualification} | ${describeEvaluationEvidenceQualification(run.evidenceQualification)} |`,
    `| Route independence | ${routeIndependence(run)} | ${routeIndependenceMeaning(run)} |`,
  ];
}

function semanticPlanMeasurement(run: RealWorldEvaluationRun): {
  status: string;
  meaning: string;
} {
  if (run.planProfile === 'audit-reviewed-plan') {
    return {
      status: 'not applicable',
      meaning:
        'This audit-only profile uses an evaluator-owned reviewed plan, so it does not measure generated-plan semantics.',
    };
  }
  const measurements = run.trials
    .map((trial) => trial.semanticPlanMeasurement)
    .filter((measurement) => measurement !== undefined);
  const completed = measurements.filter((measurement) => measurement.status === 'completed');
  if (completed.length > 0) {
    const expectedScenarioCount = completed.reduce(
      (total, measurement) => total + measurement.score.expectedScenarioCount,
      0,
    );
    const coveredScenarioCount = completed.reduce(
      (total, measurement) => total + measurement.score.coveredScenarioCount,
      0,
    );
    const enabledVectorCount = completed.reduce(
      (total, measurement) => total + measurement.score.enabledVectorCount,
      0,
    );
    const relevantVectorCount = completed.reduce(
      (total, measurement) => total + measurement.score.relevantVectorCount,
      0,
    );
    const additionalObservationCount = completed.reduce(
      (total, measurement) => total + measurement.score.additionalObservationCount,
      0,
    );
    const appropriateObservationCount = completed.reduce(
      (total, measurement) => total + measurement.score.appropriateObservationCount,
      0,
    );
    const misplacedObservationCount = completed.reduce(
      (total, measurement) => total + measurement.score.misplacedObservationCount,
      0,
    );
    const scenarioRecall =
      expectedScenarioCount === 0 ? null : coveredScenarioCount / expectedScenarioCount;
    const vectorPrecision =
      enabledVectorCount === 0 ? null : relevantVectorCount / enabledVectorCount;
    return {
      status: `${completed.length}/${run.trials.length} completed`,
      meaning: `AI-assisted diagnostic only: ${coveredScenarioCount}/${expectedScenarioCount} expected scenarios covered (${formatMetric(scenarioRecall)} recall); ${relevantVectorCount}/${enabledVectorCount} enabled vectors relevant (${formatMetric(vectorPrecision)} precision); ${appropriateObservationCount}/${additionalObservationCount} optional observations appropriately remained outside execution; ${misplacedObservationCount} observations misplaced known executable work. It is not a release or provider-selection gate.`,
    };
  }
  const statuses = new Set(measurements.map((measurement) => measurement.status));
  if (statuses.has('incomplete') || statuses.has('cancelled')) {
    return {
      status: 'incomplete',
      meaning:
        'The product result is retained, but its semantic plan measurement did not complete. No plan-quality score is available.',
    };
  }
  return {
    status: 'unavailable',
    meaning:
      'No semantic evaluator was configured or the product stage did not close. Path reachability is not semantic plan quality.',
  };
}

function findingMeasurementMeaning(run: RealWorldEvaluationRun): string {
  if (run.planProfile === 'planning-generated') {
    return 'This profile intentionally stops after planning and does not dispatch audit execution.';
  }
  return 'Finding metrics use completed trials only; incomplete, failed, and cancelled trials remain outside finding scores.';
}

function precisionAvailability(run: RealWorldEvaluationRun): string {
  if (run.findingCoverage === 'targeted') return 'unavailable';
  if (run.findingCoverage === 'exhaustive') return 'available within declared scope';
  return 'partitioned by answer-key coverage';
}

function precisionMeaning(run: RealWorldEvaluationRun): string {
  if (run.findingCoverage === 'targeted') {
    return 'Unexpected findings are unadjudicated, so targeted labels cannot establish general precision.';
  }
  if (run.findingCoverage === 'exhaustive') {
    return 'Precision applies only to completed trials and the declared exhaustive answer-key scope.';
  }
  return 'No single whole-run precision is available; only exhaustive-key partitions can report it.';
}

function routeIndependence(run: RealWorldEvaluationRun): string {
  return run.verificationMode === 'independent-route'
    ? 'independently routed verifier'
    : 'same route';
}

function routeIndependenceMeaning(run: RealWorldEvaluationRun): string {
  return run.verificationMode === 'independent-route'
    ? 'Verification uses the configured distinct evaluation-only route; this alone is not a provider-quality claim.'
    : 'Planning and verification share the configured route, so this run has no independent verifier evidence.';
}

function formatTrialExecutionTrace(run: RealWorldEvaluationRun): string[] {
  return run.trials.map((trial) => {
    const flow = (trial.modelObservation?.stages ?? [])
      .map((stage) => {
        const events = stage.trace.map((event) => {
          if (event.kind === 'model-response') return `model#${event.requestOrdinal}`;
          return `${event.tool}:${event.outcome}`;
        });
        return `${stage.stage}[${events.length === 0 ? 'no-trace' : events.join(' → ')}]`;
      })
      .join('; ');
    return `| \`${trial.caseId}\` | ${trial.variant} | ${trial.repetition} | ${trial.status} | ${flow || 'no model stage'} | ${trial.durationMs} ms | ${trial.errorCode ?? 'none'} |`;
  });
}

function formatStageEvidenceCoverage(run: RealWorldEvaluationRun): string[] {
  return run.trials.map((trial) => {
    const coverage = trial.stageEvidenceCoverage;
    return coverage === undefined
      ? '| unavailable | unavailable | unavailable | unavailable | unavailable |'
      : `| ${coverage.expectedRoleCount} | ${coverage.mappedLocationCount} | ${coverage.groundedRoleCount} | ${coverage.verifiedRoleCount} | ${coverage.firstIncompleteStage} |`;
  });
}

function formatExpectedEvidenceRoleTraces(run: RealWorldEvaluationRun): string[] {
  const rows = run.trials.flatMap((trial) =>
    (trial.stageEvidenceCoverage?.roleTraces ?? []).map(
      (trace) =>
        `| \`${trial.caseId}\` | ${trial.variant} | ${trial.repetition} | \`${trace.findingId}\` | ${trace.role} | ${yesNo(trace.planScoped)} | ${yesNo(trace.mapperSelected)} | ${yesNo(trace.postureReconciled)} | ${yesNo(trace.discoverySeeded)} | ${yesNo(trace.groundingSelected)} | ${yesNo(trace.verifierSelected)} | ${yesNo(trace.terminalVerifierSelected)} | ${yesNo(trace.terminalCompleted)} | ${trace.firstIncompleteStage} |`,
    ),
  );
  return rows.length === 0
    ? [
        '| unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |',
      ]
    : rows;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function formatHoldoutAttestation(run: RealWorldEvaluationRun): string {
  if (run.holdoutAttestation === undefined) return 'not recorded';
  const attestation = run.holdoutAttestation;
  return `\`${attestation.attestationId}\` issued ${attestation.issuedAt}; payload \`${attestation.payloadDigest}\`; key \`${attestation.publicKeyFingerprint}\``;
}

function formatFindingCoverage(coverage: RealWorldEvaluationRun['findingCoverage']): string {
  if (coverage === 'targeted') {
    return 'targeted; unmatched findings are unadjudicated and precision is unavailable';
  }
  if (coverage === 'exhaustive') {
    return 'exhaustive; unmatched findings are adjudicated false positives';
  }
  return 'mixed; metrics are partitioned by individual answer-key coverage';
}

function findingMetricScope(run: RealWorldEvaluationRun): string {
  if (run.planProfile === 'planning-generated') {
    return 'not applicable: this measurement intentionally stops after generated planning.';
  }
  const coverage = run.findingCoverage;
  if (coverage === 'targeted') {
    return 'terminal finding-match recall, all-role terminal-evidence recall, partial evidence recognition, and role localization; adjudicated-targeted precision unavailable.';
  }
  if (coverage === 'exhaustive') {
    return 'terminal finding-match recall, all-role terminal-evidence recall, partial evidence recognition, role localization, and adjudicated precision over the declared answer-key scope.';
  }
  return 'terminal finding-match recall, all-role terminal-evidence recall, and localization are aggregated; precision is available only for exhaustive-key partitions.';
}

function formatPlanCoverage(run: RealWorldEvaluationRun): string[] {
  if (run.planProfile === 'audit-reviewed-plan') {
    return ['Not applicable: this audit-only experiment used evaluator-owned reviewed plans.'];
  }
  const scores = run.trials.flatMap((trial) =>
    trial.pathReachability === null ? [] : [trial.pathReachability],
  );
  if (scores.length === 0) {
    return ['No generated plan reached a scoreable terminal state.'];
  }
  const fullyCovered = scores.filter(
    (score) =>
      score.pathReachableScenarioCount === score.eligibleScenarioCount &&
      score.relevantPathCoverage === 1,
  ).length;
  const scopedScenarios = scores.reduce(
    (total, score) => total + score.pathReachableScenarioCount,
    0,
  );
  const generatedVectors = scores.reduce((total, score) => total + score.enabledVectorCount, 0);
  const pathCoverage = scores
    .map((score) => score.relevantPathCoverage)
    .filter((coverage): coverage is number => coverage !== null);
  const averagePathCoverage =
    pathCoverage.length === 0
      ? null
      : pathCoverage.reduce((total, coverage) => total + coverage, 0) / pathCoverage.length;
  return [
    'This is scope coverage only: it records whether generated vectors cover evaluator-adjudicated paths. It makes no semantic claim that a plan correctly understood a scenario; the evaluator-only semantic review records that diagnostic separately.',
    '',
    '| Scoreable plans | All scenario paths scoped | Scenarios scoped | Mean relevant-path coverage | Generated vectors |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${scores.length} | ${fullyCovered}/${scores.length} | ${scopedScenarios} | ${formatMetric(averagePathCoverage)} | ${generatedVectors} |`,
  ];
}

function formatTrialStates(run: RealWorldEvaluationRun): string {
  const counts = { completed: 0, incomplete: 0, failed: 0, cancelled: 0 };
  for (const trial of run.trials) counts[trial.status] += 1;
  return `${counts.completed} completed; ${counts.incomplete} incomplete; ${counts.failed} failed; ${counts.cancelled} cancelled`;
}

function formatReviewRequiredSummary(run: RealWorldEvaluationRun): string {
  const totals = run.trials.reduce(
    (aggregate, trial) => ({
      truePositives: aggregate.truePositives + (trial.reviewRequiredScore?.truePositives ?? 0),
      falsePositives: aggregate.falsePositives + (trial.reviewRequiredScore?.falsePositives ?? 0),
      falseNegatives: aggregate.falseNegatives + (trial.reviewRequiredScore?.falseNegatives ?? 0),
    }),
    { truePositives: 0, falsePositives: 0, falseNegatives: 0 },
  );
  return `| ${totals.truePositives} | ${totals.falsePositives} | ${totals.falseNegatives} |`;
}

function formatRetainedUnscoredOutcomes(run: RealWorldEvaluationRun): string[] {
  const rows = run.trials.flatMap((trial) => {
    const retained = trial.retainedUnscored;
    return retained === undefined
      ? []
      : [
          `| \`${trial.caseId}\` | ${trial.variant} | ${trial.repetition} | ${retained.acceptedFindingKeys.length} | ${retained.reviewRequiredFindingKeys.length} | ${trial.status} |`,
        ];
  });
  return rows.length === 0 ? ['| n/a | n/a | n/a | 0 | 0 | none retained |'] : rows;
}

type FunnelTrialStatus = 'completed' | 'incomplete';

function trialsForFunnel(
  run: RealWorldEvaluationRun,
  status: FunnelTrialStatus,
): RealWorldEvaluationRun['trials'] {
  return run.trials.filter((trial) =>
    status === 'completed' ? trial.status === 'completed' : trial.status !== 'completed',
  );
}

function formatHypothesisGroundingFunnel(
  run: RealWorldEvaluationRun,
  status: FunnelTrialStatus,
): string {
  const funnels = trialsForFunnel(run, status).flatMap((trial) =>
    trial.hypothesisGroundingFunnel === undefined ? [] : [trial.hypothesisGroundingFunnel],
  );
  if (funnels.length === 0)
    return '| unavailable | unavailable | unavailable | unavailable | unavailable |';
  const funnel = aggregateHypothesisGroundingFunnels(funnels);
  return `| ${funnel.discoveredSeedCount} | ${funnel.discoveryBindingRejectedCount} | ${funnel.groundingNullCount} | ${funnel.groundingBindingRejectedCount} | ${funnel.submittedCandidateCount} |`;
}

function formatCandidateIntegrityRejections(
  run: RealWorldEvaluationRun,
  status: FunnelTrialStatus,
): string {
  const ledgers = trialsForFunnel(run, status).flatMap((trial) =>
    trial.candidateIntegrityRejections === undefined ? [] : [trial.candidateIntegrityRejections],
  );
  if (ledgers.length === 0)
    return '| unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |';
  const ledger = aggregateCandidateIntegrityRejectionLedgers(ledgers);
  return `| ${ledger['model-hypothesis-invalid']} | ${ledger['model-plan-obligation-invalid']} | ${ledger['model-evidence-map-reference-invalid']} | ${ledger['model-source-posture-reference-invalid']} | ${ledger['model-claim-evidence-insufficient']} | ${ledger['model-evidence-invalid-or-out-of-scope']} |`;
}

function formatDiscoveryIntegrityRejections(
  run: RealWorldEvaluationRun,
  status: FunnelTrialStatus,
): string {
  const ledgers = trialsForFunnel(run, status).flatMap((trial) =>
    trial.hypothesisGroundingFunnel === undefined
      ? []
      : [trial.hypothesisGroundingFunnel.discoveryIntegrityRejections],
  );
  if (ledgers.length === 0)
    return '| unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |';
  const ledger = aggregateDiscoveryIntegrityRejectionLedgers(ledgers);
  return `| ${ledger['model-hypothesis-invalid']} | ${ledger['model-seed-duplicate']} | ${ledger['model-vector-mismatch']} | ${ledger['model-plan-obligation-invalid']} | ${ledger['model-evidence-map-reference-invalid']} | ${ledger['model-source-posture-reference-invalid']} |`;
}

function formatAdmissionFunnel(run: RealWorldEvaluationRun, status: FunnelTrialStatus): string {
  const funnels = trialsForFunnel(run, status).flatMap((trial) =>
    trial.admissionFunnel === undefined ? [] : [trial.admissionFunnel],
  );
  if (funnels.length === 0)
    return '| unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |';
  const funnel = aggregateFindingAdmissionFunnels(funnels);
  return `| ${funnel.modelCandidateCount} | ${funnel.integrityRejectedCount} | ${funnel.toolEvidenceRejectedCount} | ${funnel.verifierAcceptedCount}/${funnel.verifierRejectedCount}/${funnel.verifierIncompleteCount} | ${funnel.verifierToolEvidenceRejectedCount} | ${funnel.verifierEvidenceRejectedCount} | ${funnel.verifierReconciledCount} | ${funnel.postVerificationRejectedCount} | ${funnel.duplicateCollapsedCount} | ${funnel.admittedFindingCount} |`;
}

function formatVerificationTerminalLanes(
  run: RealWorldEvaluationRun,
  status: FunnelTrialStatus,
): string {
  const funnels = trialsForFunnel(run, status).flatMap((trial) =>
    trial.admissionFunnel === undefined ? [] : [trial.admissionFunnel],
  );
  if (funnels.length === 0)
    return '| unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |';
  const lanes = aggregateFindingAdmissionFunnels(funnels).verificationTerminalLanes;
  return `| ${lanes.accepted} | ${lanes.rejected} | ${lanes.modelIncomplete} | ${lanes.stageFailed} | ${lanes.inspectionMissing} | ${lanes.wrapperContractInvalid} |`;
}

function formatOperationalHotspots(run: RealWorldEvaluationRun): string[] {
  const grouped = new Map<
    string,
    {
      caseId: string;
      variant: string;
      stage: string;
      route: string;
      calls: number;
      input: number;
      output: number;
      toolCalls: number;
      durationMs: number;
      cost: number | null;
    }
  >();
  for (const trial of run.trials) {
    for (const stage of trial.modelObservation?.stages ?? []) {
      const key = `${trial.caseId}\0${trial.variant}\0${stage.stage}\0${stage.route}`;
      const value = grouped.get(key) ?? {
        caseId: trial.caseId,
        variant: trial.variant,
        stage: stage.stage,
        route: stage.route,
        calls: 0,
        input: 0,
        output: 0,
        toolCalls: 0,
        durationMs: 0,
        cost: 0,
      };
      value.calls += stage.usage.modelCallCount;
      value.input += stage.usage.inputTokens;
      value.output += stage.usage.outputTokens;
      value.toolCalls += stage.toolUsage.toolCallCount;
      value.durationMs += stage.durationMs;
      value.cost =
        value.cost === null || stage.cost.estimatedCostUsd === null
          ? null
          : value.cost + stage.cost.estimatedCostUsd;
      grouped.set(key, value);
    }
  }
  if (grouped.size === 0) {
    return ['| n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | unavailable |'];
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        (right.cost ?? -1) - (left.cost ?? -1) ||
        right.durationMs - left.durationMs ||
        left.caseId.localeCompare(right.caseId),
    )
    .map(
      (value) =>
        `| \`${value.caseId}\` | ${value.variant} | ${value.stage} | ${value.route} | ${value.calls} | ${value.input} | ${value.output} | ${value.toolCalls} | ${value.durationMs} ms | ${value.cost === null ? 'unavailable' : `$${value.cost.toFixed(6)}`} |`,
    );
}

function formatRequestUsage(run: RealWorldEvaluationRun): string[] {
  const rows = (run.reliability.modelObservation?.stages ?? []).flatMap((stage) =>
    stage.requests.map(
      (request) =>
        `| ${stage.stage} | ${stage.route} | ${request.ordinal} | ${request.durationMs} ms | ${request.usage.inputTokens} | ${request.usage.cachedInputTokens} | ${request.usage.outputTokens} | ${request.usage.reasoningTokens} | ${request.cost.estimatedCostUsd === null ? 'unavailable' : `$${request.cost.estimatedCostUsd.toFixed(6)}`} |`,
    ),
  );
  return rows.length === 0
    ? ['| n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | unavailable |']
    : rows;
}

function formatToolUsage(run: RealWorldEvaluationRun): string {
  const observation = run.reliability.modelObservation;
  if (observation === undefined || observation === null) {
    return '| n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |';
  }
  const usage = observation.toolUsage;
  return `| ${usage.toolCallCount} | ${usage.listFilesCallCount} | ${usage.readFileCallCount} | ${usage.grepFilesCallCount} | ${usage.successfulReadFileCallCount} | ${usage.successfulGrepFilesCallCount} | ${usage.rejectedCallCount} | ${usage.returnedBytes} |`;
}

function formatModelUsage(run: RealWorldEvaluationRun): string {
  const observation = run.reliability.modelObservation;
  if (observation === undefined || observation === null) {
    return '| n/a | n/a | n/a | n/a | n/a | unavailable | n/a |';
  }
  return `| ${observation.usage.modelCallCount} | ${observation.usage.inputTokens} | ${observation.usage.cachedInputTokens} | ${observation.usage.outputTokens} | ${observation.usage.reasoningTokens} | ${observation.cost.estimatedCostUsd === null ? 'unavailable' : `$${observation.cost.estimatedCostUsd.toFixed(6)}`} | ${observation.cacheRoutingEnabled ? 'enabled' : 'disabled'} |`;
}

function formatStageUsage(run: RealWorldEvaluationRun): string[] {
  const grouped = new Map<
    string,
    {
      calls: number;
      route: string;
      input: number;
      cachedInput: number;
      output: number;
      toolCalls: number;
      returnedBytes: number;
      rejectedToolCalls: number;
      cost: number | null;
      completed: number;
      failed: number;
    }
  >();
  for (const stage of run.reliability.modelObservation?.stages ?? []) {
    const key = `${stage.stage}\0${stage.route}`;
    const value = grouped.get(key) ?? {
      calls: 0,
      route: stage.route,
      input: 0,
      cachedInput: 0,
      output: 0,
      toolCalls: 0,
      returnedBytes: 0,
      rejectedToolCalls: 0,
      cost: 0,
      completed: 0,
      failed: 0,
    };
    value.calls += stage.usage.modelCallCount;
    value.input += stage.usage.inputTokens;
    value.cachedInput += stage.usage.cachedInputTokens;
    value.output += stage.usage.outputTokens;
    value.toolCalls += stage.toolUsage.toolCallCount;
    value.returnedBytes += stage.toolUsage.returnedBytes;
    value.rejectedToolCalls += stage.toolUsage.rejectedCallCount;
    value.cost =
      value.cost === null || stage.cost.estimatedCostUsd === null
        ? null
        : value.cost + stage.cost.estimatedCostUsd;
    if (stage.status === 'completed') value.completed += 1;
    else value.failed += 1;
    grouped.set(key, value);
  }
  if (grouped.size === 0) {
    return ['| n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | unavailable | n/a | n/a |'];
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      const [stage] = key.split('\0');
      return `| ${stage} | ${value.route} | ${value.calls} | ${value.toolCalls} | ${value.input} | ${value.output} | ${value.returnedBytes} | ${value.rejectedToolCalls} | ${value.cost === null ? 'unavailable' : `$${value.cost.toFixed(6)}`} | ${value.completed} | ${value.failed} |`;
    });
}

type CaseOutcomeSummary = Readonly<{
  caseId: string;
  variant: string;
  totalTrials: number;
  completedTrials: number;
  failedTrials: number;
  incompleteTrials: number;
  cancelledTrials: number;
  truePositives: number;
  falseNegatives: number;
  matchedLocalizedCount: number;
  matchedMislocalizedCount: number;
  unmatchedAdjudicatedFalsePositiveCount: number;
  unmatchedUnadjudicatedCount: number;
  patchedMatchingFindingCount: number;
  minimumRecall: number | null;
  medianRecall: number | null;
}>;

function summarizeCaseOutcomes(run: RealWorldEvaluationRun): readonly CaseOutcomeSummary[] {
  const summaries = new Map<
    string,
    {
      caseId: string;
      variant: string;
      totalTrials: number;
      completedTrials: number;
      failedTrials: number;
      incompleteTrials: number;
      cancelledTrials: number;
      truePositives: number;
      falseNegatives: number;
      matchedLocalizedCount: number;
      matchedMislocalizedCount: number;
      unmatchedAdjudicatedFalsePositiveCount: number;
      unmatchedUnadjudicatedCount: number;
      patchedMatchingFindingCount: number;
      recalls: number[];
    }
  >();
  for (const trial of run.trials) {
    const key = `${trial.caseId}\0${trial.variant}`;
    const summary = summaries.get(key) ?? {
      caseId: trial.caseId,
      variant: trial.variant,
      totalTrials: 0,
      completedTrials: 0,
      failedTrials: 0,
      incompleteTrials: 0,
      cancelledTrials: 0,
      truePositives: 0,
      falseNegatives: 0,
      matchedLocalizedCount: 0,
      matchedMislocalizedCount: 0,
      unmatchedAdjudicatedFalsePositiveCount: 0,
      unmatchedUnadjudicatedCount: 0,
      patchedMatchingFindingCount: 0,
      recalls: [],
    };
    summary.totalTrials += 1;
    if (trial.status === 'failed') {
      summary.failedTrials += 1;
    } else if (trial.status === 'cancelled') {
      summary.cancelledTrials += 1;
    } else if (trial.status === 'incomplete') {
      summary.incompleteTrials += 1;
    } else {
      summary.completedTrials += 1;
      summary.truePositives += trial.findingScore?.truePositives ?? 0;
      summary.falseNegatives += trial.findingScore?.falseNegatives ?? 0;
      summary.matchedLocalizedCount += trial.findingScore?.matchedLocalizedCount ?? 0;
      summary.matchedMislocalizedCount += trial.findingScore?.matchedMislocalizedCount ?? 0;
      summary.unmatchedAdjudicatedFalsePositiveCount +=
        trial.findingScore?.unmatchedAdjudicatedFalsePositiveCount ?? 0;
      summary.unmatchedUnadjudicatedCount += trial.findingScore?.unmatchedUnadjudicatedCount ?? 0;
      summary.patchedMatchingFindingCount += trial.findingScore?.patchedMatchingFindingCount ?? 0;
      const recall = trial.findingScore?.findingRecall;
      if (recall !== null && recall !== undefined) summary.recalls.push(recall);
    }
    summaries.set(key, summary);
  }
  return [...summaries.values()]
    .map((summary) => ({
      caseId: summary.caseId,
      variant: summary.variant,
      totalTrials: summary.totalTrials,
      completedTrials: summary.completedTrials,
      failedTrials: summary.failedTrials,
      incompleteTrials: summary.incompleteTrials,
      cancelledTrials: summary.cancelledTrials,
      truePositives: summary.truePositives,
      falseNegatives: summary.falseNegatives,
      matchedLocalizedCount: summary.matchedLocalizedCount,
      matchedMislocalizedCount: summary.matchedMislocalizedCount,
      unmatchedAdjudicatedFalsePositiveCount: summary.unmatchedAdjudicatedFalsePositiveCount,
      unmatchedUnadjudicatedCount: summary.unmatchedUnadjudicatedCount,
      patchedMatchingFindingCount: summary.patchedMatchingFindingCount,
      minimumRecall: summary.recalls.length === 0 ? null : Math.min(...summary.recalls),
      medianRecall: percentile(summary.recalls, 0.5),
    }))
    .sort(
      (left, right) =>
        left.caseId.localeCompare(right.caseId) || left.variant.localeCompare(right.variant),
    );
}

function findingPressure(summaries: readonly CaseOutcomeSummary[]): Readonly<{
  vulnerableFalseNegatives: number;
  patchedMatchingFindings: number;
  adjudicatedFalsePositives: number;
  unadjudicatedFindings: number;
}> {
  return summaries.reduce(
    (pressure, summary) => ({
      vulnerableFalseNegatives:
        pressure.vulnerableFalseNegatives +
        (summary.variant === 'vulnerable' ? summary.falseNegatives : 0),
      patchedMatchingFindings:
        pressure.patchedMatchingFindings + summary.patchedMatchingFindingCount,
      adjudicatedFalsePositives:
        pressure.adjudicatedFalsePositives + summary.unmatchedAdjudicatedFalsePositiveCount,
      unadjudicatedFindings: pressure.unadjudicatedFindings + summary.unmatchedUnadjudicatedCount,
    }),
    {
      vulnerableFalseNegatives: 0,
      patchedMatchingFindings: 0,
      adjudicatedFalsePositives: 0,
      unadjudicatedFindings: 0,
    },
  );
}

function formatCaseStatus(summary: CaseOutcomeSummary): string {
  const states = [
    summary.incompleteTrials === 0 ? null : `${summary.incompleteTrials} incomplete`,
    summary.failedTrials === 0 ? null : `${summary.failedTrials} failed`,
    summary.cancelledTrials === 0 ? null : `${summary.cancelledTrials} cancelled`,
  ].filter((state): state is string => state !== null);
  return states.length === 0 ? 'completed' : states.join(', ');
}

function improvementSignals(run: RealWorldEvaluationRun): string[] {
  const signals: string[] = [];
  for (const summary of summarizeCaseOutcomes(run)) {
    if (summary.incompleteTrials > 0) {
      signals.push(
        `- **Incomplete coverage:** ${summary.caseId} (${summary.variant}) had ${summary.incompleteTrials}/${summary.totalTrials} incomplete attempts; no finding score was assigned to those attempts.`,
      );
    }
    if (summary.failedTrials > 0) {
      signals.push(
        `- **Failed trials:** ${summary.caseId} (${summary.variant}) had ${summary.failedTrials}/${summary.totalTrials} failed attempts.`,
      );
    }
    if (summary.variant === 'vulnerable' && summary.falseNegatives > 0) {
      signals.push(
        `- **Missing complete terminal findings:** ${summary.caseId} missed ${summary.falseNegatives}/${summary.completedTrials} completed vulnerable trials; inspect plan scope and source evidence.`,
      );
    }
    if (
      summary.variant !== 'vulnerable' &&
      (summary.patchedMatchingFindingCount > 0 ||
        summary.unmatchedAdjudicatedFalsePositiveCount > 0)
    ) {
      signals.push(
        `- **Non-vulnerable adjudicated findings:** ${summary.caseId} produced ${summary.patchedMatchingFindingCount} patched matches and ${summary.unmatchedAdjudicatedFalsePositiveCount} unmatched adjudicated outputs across ${summary.completedTrials} completed ${summary.variant} trials; inspect persistence and evidence grounding.`,
      );
    }
  }
  return signals;
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

function formatDuration(value: number | null): string {
  return value === null ? 'n/a' : `${value} ms`;
}

function percentile(values: readonly number[], percent: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percent) - 1);
  return sorted[index] ?? null;
}
