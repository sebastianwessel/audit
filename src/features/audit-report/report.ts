import type { AuditReport } from '../audit-execution/audit.schema.js';
import {
  redactArtifactText,
  redactEvidenceSnippet,
} from '../audit-execution/investigation/redaction.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';

function markdownEscape(value: string): string {
  return redactArtifactText(value)
    .replaceAll('|', '\\|')
    .replaceAll(/\r?\n|\r/gu, ' ');
}

/** Uses a deterministic safe label because paths and identifiers are rendered inside Markdown code spans. */
function markdownCode(value: string): string {
  return `\`${redactArtifactText(value).replaceAll('`', '´')}\``;
}

function evidenceRows(
  evidence: ReadonlyArray<AuditReport['findings'][number]['evidence'][number]>,
): string[] {
  return evidence.map(
    (item) =>
      `| ${markdownEscape(item.role ?? 'supporting')} | ${markdownCode(
        `${item.path}:${item.startLine}${item.endLine === undefined ? '' : `-${item.endLine}`}`,
      )} | ${markdownEscape(redactEvidenceSnippet(item.snippet))} |`,
  );
}

function costText(stage: ModelStageObservation): string {
  return stage.cost.estimatedCostUsd === null ? 'Unavailable' : `$${stage.cost.estimatedCostUsd}`;
}

function operationalRows(report: AuditReport): string[] {
  return report.coverage.flatMap((coverage) => {
    const stages = [
      ...(coverage.evidenceMapObservation === undefined ? [] : [coverage.evidenceMapObservation]),
      ...(coverage.sourcePostureObservation === undefined
        ? []
        : [coverage.sourcePostureObservation]),
      ...(coverage.modelObservation === undefined ? [] : [coverage.modelObservation]),
      ...(coverage.candidateGroundingObservation === undefined
        ? []
        : [coverage.candidateGroundingObservation]),
      ...(coverage.verificationObservations ?? []),
      ...(coverage.countercheckObservations ?? []),
    ];
    return stages.map(
      (stage) =>
        `| \`${coverage.vectorId}\` | ${stage.stage} | ${stage.route} | ${stage.status} | ${stage.usage.modelCallCount} | ${stage.usage.inputTokens} | ${stage.usage.cachedInputTokens} | ${stage.usage.outputTokens} | ${stage.usage.reasoningTokens} | ${stage.cost.totalTokens} | ${costText(stage)} | ${stage.durationMs} | ${stage.toolUsage.listFilesCallCount}/${stage.toolUsage.readFileCallCount}/${stage.toolUsage.grepFilesCallCount} | ${stage.toolUsage.successfulReadFileCallCount}/${stage.toolUsage.successfulGrepFilesCallCount} |`,
    );
  });
}

type OperationalStage = Readonly<{
  vectorId: string;
  stage: ModelStageObservation;
}>;

function operationalStages(report: AuditReport): readonly OperationalStage[] {
  return report.coverage.flatMap((coverage) =>
    [
      ...(coverage.evidenceMapObservation === undefined ? [] : [coverage.evidenceMapObservation]),
      ...(coverage.sourcePostureObservation === undefined
        ? []
        : [coverage.sourcePostureObservation]),
      ...(coverage.modelObservation === undefined ? [] : [coverage.modelObservation]),
      ...(coverage.candidateGroundingObservation === undefined
        ? []
        : [coverage.candidateGroundingObservation]),
      ...(coverage.verificationObservations ?? []),
      ...(coverage.countercheckObservations ?? []),
    ].map((stage) => ({ vectorId: coverage.vectorId, stage })),
  );
}

function operationalSummaryRows(report: AuditReport): string[] {
  const summaries = new Map<
    string,
    {
      route: ModelStageObservation['route'];
      invocations: number;
      calls: number;
      inputTokens: number;
      cachedInputTokens: number;
      outputTokens: number;
      reasoningTokens: number;
      totalTokens: number;
      durationMs: number;
      toolCalls: number;
      estimatedCostUsd: number | null;
    }
  >();
  for (const { stage } of operationalStages(report)) {
    const key = `${stage.stage}\0${stage.route}`;
    const summary = summaries.get(key) ?? {
      route: stage.route,
      invocations: 0,
      calls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      durationMs: 0,
      toolCalls: 0,
      estimatedCostUsd: 0,
    };
    summary.invocations += 1;
    summary.calls += stage.usage.modelCallCount;
    summary.inputTokens += stage.usage.inputTokens;
    summary.cachedInputTokens += stage.usage.cachedInputTokens;
    summary.outputTokens += stage.usage.outputTokens;
    summary.reasoningTokens += stage.usage.reasoningTokens;
    summary.totalTokens += stage.cost.totalTokens;
    summary.durationMs += stage.durationMs;
    summary.toolCalls += stage.toolUsage.toolCallCount;
    summary.estimatedCostUsd =
      summary.estimatedCostUsd === null || stage.cost.estimatedCostUsd === null
        ? null
        : summary.estimatedCostUsd + stage.cost.estimatedCostUsd;
    summaries.set(key, summary);
  }
  return [...summaries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, summary]) => {
      const [stage] = key.split('\0');
      return `| ${stage} | ${summary.route} | ${summary.invocations} | ${summary.calls} | ${summary.inputTokens} | ${summary.cachedInputTokens} | ${summary.outputTokens} | ${summary.reasoningTokens} | ${summary.totalTokens} | ${summary.estimatedCostUsd === null ? 'Unavailable' : `$${summary.estimatedCostUsd.toFixed(6)}`} | ${summary.durationMs} | ${summary.toolCalls} |`;
    });
}

function operationalHotspotRows(report: AuditReport): string[] {
  return [...operationalStages(report)]
    .sort((left, right) => {
      const leftCost = left.stage.cost.estimatedCostUsd ?? -1;
      const rightCost = right.stage.cost.estimatedCostUsd ?? -1;
      if (rightCost !== leftCost) return rightCost - leftCost;
      if (right.stage.cost.totalTokens !== left.stage.cost.totalTokens) {
        return right.stage.cost.totalTokens - left.stage.cost.totalTokens;
      }
      if (right.stage.durationMs !== left.stage.durationMs) {
        return right.stage.durationMs - left.stage.durationMs;
      }
      return `${left.vectorId}\0${left.stage.stage}`.localeCompare(
        `${right.vectorId}\0${right.stage.stage}`,
      );
    })
    .map(
      ({ vectorId, stage }) =>
        `| \`${vectorId}\` | ${stage.stage} | ${stage.route} | ${costText(stage)} | ${stage.cost.totalTokens} | ${stage.durationMs} | ${stage.usage.modelCallCount} | ${stage.toolUsage.toolCallCount} |`,
    );
}

function admissionRows(report: AuditReport): string[] {
  return report.coverage.flatMap((coverage) => {
    const funnel = coverage.admissionFunnel;
    if (funnel === undefined) return [];
    return [
      `| \`${coverage.vectorId}\` | ${funnel.modelCandidateCount} | ${funnel.integrityRejectedCount} | ${funnel.toolEvidenceRejectedCount} | ${funnel.verifierAcceptedCount}/${funnel.verifierRejectedCount}/${funnel.verifierIncompleteCount} | ${funnel.verifierToolEvidenceRejectedCount} | ${funnel.verifierEvidenceRejectedCount} | ${funnel.verifierReconciledCount} | ${funnel.postVerificationRejectedCount} | ${funnel.admittedFindingCount} |`,
    ];
  });
}

function verificationTerminalLaneRows(report: AuditReport): string[] {
  return report.coverage.flatMap((coverage) => {
    const lanes = coverage.admissionFunnel?.verificationTerminalLanes;
    if (lanes === undefined) return [];
    return [
      `| \`${coverage.vectorId}\` | ${lanes.accepted} | ${lanes.rejected} | ${lanes.modelIncomplete} | ${lanes.evidenceProjectionInvalid} | ${lanes.stageFailed} | ${lanes.inspectionMissing} | ${lanes.wrapperContractInvalid} |`,
    ];
  });
}

function closureRows(report: AuditReport): string[] {
  return report.coverage.flatMap((coverage) =>
    (coverage.obligationClosure ?? []).map(
      (row) =>
        `| \`${coverage.vectorId}\` | \`${row.obligationId}\` | ${row.mapState} (${row.evidenceMapFactCount}) | ${row.sourcePostureConclusion ?? 'not-reached'} | ${row.investigationState} | ${row.candidateCount} | ${row.admittedFindingCount} | ${row.terminalDisposition} | ${markdownEscape(row.notApplicableReason ?? '—')} |`,
    ),
  );
}

export function renderAuditReportMarkdown(report: AuditReport): string {
  const lines = [
    '# Security review report',
    '',
    `- Report: \`${report.reportId}\``,
    `- Plan: \`${report.planId}\``,
    `- Generated: ${report.generatedAt}`,
    '',
    '## Coverage',
    '',
    '| Vector | Outcome | Files | Candidates | Map facts | Unanswered plan items | Findings | Limitations |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.coverage.map(
      (coverage) =>
        `| \`${coverage.vectorId}\` | ${coverage.outcome} | ${coverage.matchedSourcePaths} | ${coverage.deterministicCandidateCount} | ${coverage.evidenceMapFactCount} | ${coverage.evidenceMapUnansweredObligationCount} | ${coverage.findingCount} | ${markdownEscape(coverage.limitations.join(' ')) || 'None'} |`,
    ),
    '',
    '## Findings',
    '',
  ];
  if (report.findings.length === 0) {
    lines.push('No source-backed findings were produced by this static run.');
  }
  const closures = closureRows(report);
  if (closures.length > 0) {
    lines.push(
      '## Review-obligation closure',
      '',
      'Each row is a source-free account of the planned review work. A no-source-backed-candidate result means the bounded review retained no candidate; it does not prove the target secure. A not-applicable result is neutral, not a passed check or finding. Incomplete and not-reached rows require follow-up.',
      '',
      '| Vector | Obligation | Map facts | Source posture | Investigation | Candidates | Findings admitted | Terminal disposition | Not-applicable reason |',
      '| --- | --- | --- | --- | --- | ---: | ---: | --- | --- |',
      ...closures,
      '',
    );
  }
  for (const finding of report.findings) {
    lines.push(
      `### Confirmed finding: ${markdownEscape(finding.statement)}`,
      '',
      'Evidence:',
      '',
      '| Role | Location | Redacted source evidence |',
      '| --- | --- | --- |',
      ...evidenceRows(finding.evidence),
      '',
      `Verification: ${finding.verification.status} — ${markdownEscape(finding.verification.reason)}`,
      '',
      `Limitations: ${markdownEscape(finding.limitations.join(' ')) || 'None recorded.'}`,
      '',
    );
  }
  if (report.reviewRequired.length > 0) {
    lines.push(
      '## Human review required',
      '',
      'These items have source-backed evidence, but independent static-review stages disagree. They are not confirmed findings and do not affect the CI finding gate.',
      '',
    );
    for (const finding of report.reviewRequired) {
      lines.push(
        `### REVIEW REQUIRED: ${markdownEscape(finding.statement)}`,
        '',
        'Evidence:',
        '',
        '| Role | Location | Redacted source evidence |',
        '| --- | --- | --- |',
        ...evidenceRows(finding.evidence),
        '',
        `Reason: ${markdownEscape(finding.verification.reason)}`,
        '',
        `Limitations: ${markdownEscape(finding.limitations.join(' ')) || 'None recorded.'}`,
        '',
      );
    }
  }
  if (report.errors.length > 0) {
    lines.push(
      '## Errors',
      '',
      ...report.errors.map((error) => `- ${error.code}: ${markdownEscape(error.message)}`),
      '',
    );
  }
  const funnels = admissionRows(report);
  if (funnels.length > 0) {
    lines.push(
      '## Finding admission ledger',
      '',
      'This numeric funnel explains how hypotheses reached a terminal result. It contains no source, prompt, tool output, or model text.',
      '',
      '| Vector | Model candidates | Integrity rejected | Tool evidence rejected | Verifier accepted/rejected/incomplete | Verifier tool evidence rejected | Verifier evidence rejected | Verifier reconciled | Post-verification rejected | Findings admitted |',
      '| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |',
      ...funnels,
      '',
    );
    lines.push(
      '### Candidate-aware terminal lanes',
      '',
      'These source-free operational counts distinguish a model-declared incomplete verdict from projection, stage, inspection, or wrapper failures.',
      '',
      '| Vector | Accepted | Rejected | Model incomplete | Evidence projection invalid | Stage failed | Inspection missing | Wrapper contract invalid |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...verificationTerminalLaneRows(report),
      '',
    );
  }
  const rows = operationalRows(report);
  if (rows.length > 0) {
    lines.push(
      '## Operational summary',
      '',
      'Use this source-free summary to identify stages with comparatively high token, cost, latency, or file-tool use before changing prompts, models, or budgets.',
      '',
      '| Stage | Route | Invocations | Calls | Input | Cached | Output | Reasoning | Tokens | Estimated cost | Total duration ms | File tools |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |',
      ...operationalSummaryRows(report),
      '',
      '### Cost and latency hotspots',
      '',
      'All stage invocations, ranked by known estimated cost; when cost is unavailable, token count then duration provides the stable fallback order.',
      '',
      '| Vector | Stage | Route | Estimated cost | Tokens | Duration ms | Model calls | File tools |',
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |',
      ...operationalHotspotRows(report),
      '',
      '## Operational ledger',
      '',
      'The ledger contains numeric model and tool aggregates only; it does not contain prompts, source, or tool output.',
      '',
      '| Vector | Stage | Route | Status | Calls | Input | Cached | Output | Reasoning | Tokens | Estimated cost | Duration ms | Tool attempts (list/read/search) | Successful source access (read/search) |',
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- |',
      ...rows,
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
