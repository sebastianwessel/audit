import type { ClaimEvidenceRole } from '../attack-planning/plan.schema.js';
import { classifyAuditTerminal } from '../audit-execution/terminal-classification.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';
import type { PublicAuditReport } from './public-contract.js';

function markdownEscape(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n|\r/gu, ' ');
}

/** Uses a deterministic safe label because paths and identifiers are rendered inside Markdown code spans. */
function markdownCode(value: string): string {
  return `\`${value.replaceAll('`', '´')}\``;
}

function evidenceRows(finding: PublicAuditReport['findings'][number]): string[] {
  return finding.claimEvidenceBundles.flatMap((bundle) =>
    bundle.evidence.map(
      (item) =>
        `| ${bundle.role} | ${markdownCode(
          `${item.path}:${item.startLine}${item.endLine === undefined ? '' : `-${item.endLine}`}`,
        )} | ${markdownCode(`sha256:${item.contentDigest}`)} |`,
    ),
  );
}

function findingNarrativeLines(finding: PublicAuditReport['findings'][number]): string[] {
  const roleExplanation = (role: ClaimEvidenceRole) =>
    finding.narrative.roleExplanations.find((item) => item.role === role)?.explanation ??
    'No explanation was retained.';
  return [
    'Claim:',
    '',
    markdownEscape(finding.narrative.statement),
    '',
    'Why these locations matter:',
    '',
    `- Operation: ${markdownEscape(roleExplanation('operation'))}`,
    `- Unsafe condition: ${markdownEscape(roleExplanation('unsafe-condition'))}`,
    '',
    ...(finding.narrative.limitations.length === 0
      ? []
      : [
          'Limitations:',
          '',
          ...finding.narrative.limitations.map((item) => `- ${markdownEscape(item)}`),
          '',
        ]),
  ];
}

function costText(stage: ModelStageObservation): string {
  return stage.cost.estimatedCostUsd === null ? 'Unavailable' : `$${stage.cost.estimatedCostUsd}`;
}

function operationalRows(report: PublicAuditReport): string[] {
  return report.coverage.flatMap((coverage) => {
    const stages = [
      ...(coverage.evidenceMapObservation === undefined ? [] : [coverage.evidenceMapObservation]),
      ...(coverage.evidenceMapRepairObservations ?? []),
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

function operationalStages(report: PublicAuditReport): readonly OperationalStage[] {
  return report.coverage.flatMap((coverage) =>
    [
      ...(coverage.evidenceMapObservation === undefined ? [] : [coverage.evidenceMapObservation]),
      ...(coverage.evidenceMapRepairObservations ?? []),
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

function operationalSummaryRows(report: PublicAuditReport): string[] {
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

function operationalHotspotRows(report: PublicAuditReport): string[] {
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

function admissionRows(report: PublicAuditReport): string[] {
  return report.coverage.flatMap((coverage) => {
    const funnel = coverage.admissionFunnel;
    if (funnel === undefined) return [];
    return [
      `| \`${coverage.vectorId}\` | ${funnel.modelCandidateCount} | ${funnel.integrityRejectedCount} | ${funnel.toolEvidenceRejectedCount} | ${funnel.verifierAcceptedCount}/${funnel.verifierRejectedCount}/${funnel.verifierIncompleteCount} | ${funnel.verifierToolEvidenceRejectedCount} | ${funnel.verifierEvidenceRejectedCount} | ${funnel.verifierReconciledCount} | ${funnel.postVerificationRejectedCount} | ${funnel.duplicateCollapsedCount} | ${funnel.admittedFindingCount} |`,
    ];
  });
}

function verificationTerminalLaneRows(report: PublicAuditReport): string[] {
  return report.coverage.flatMap((coverage) => {
    const lanes = coverage.admissionFunnel?.verificationTerminalLanes;
    if (lanes === undefined) return [];
    return [
      `| \`${coverage.vectorId}\` | ${lanes.accepted} | ${lanes.rejected} | ${lanes.modelIncomplete} | ${lanes.evidenceProjectionInvalid} | ${lanes.stageFailed} | ${lanes.inspectionMissing} | ${lanes.wrapperContractInvalid} |`,
    ];
  });
}

function closureRows(report: PublicAuditReport): string[] {
  return report.coverage.flatMap((coverage) =>
    (coverage.obligationClosure ?? []).map(
      (row) =>
        `| \`${coverage.vectorId}\` | \`${row.obligationId}\` | ${markdownEscape(reviewObligationRiskStatement(report, coverage.vectorId, row.obligationId))} | ${row.mapState} (${row.evidenceMapFactCount}) | ${row.sourcePostureConclusion ?? 'not-reached'} | ${row.investigationState} | ${row.candidateCount} | ${row.admittedFindingCount} | ${row.terminalDisposition} |`,
    ),
  );
}

function reviewObligationContext(
  report: PublicAuditReport,
  vectorId: string,
  obligationId: string,
) {
  return report.reviewContext.vectors
    .find((vector) => vector.vectorId === vectorId)
    ?.reviewObligations.find((obligation) => obligation.obligationId === obligationId);
}

function reviewObligationRiskStatement(
  report: PublicAuditReport,
  vectorId: string,
  obligationId: string,
): string {
  return reviewObligationContext(report, vectorId, obligationId)?.riskStatement ?? 'Unavailable';
}

function applicabilityReasonText(
  reason: 'no-relevant-operation-in-scope' | 'external-component-not-represented-in-scope',
): string {
  switch (reason) {
    case 'no-relevant-operation-in-scope':
      return 'The reviewed scope contains no operation relevant to this obligation.';
    case 'external-component-not-represented-in-scope':
      return 'The reviewed source shows this obligation belongs to a component not represented in this scope.';
  }
}

function applicabilityRows(report: PublicAuditReport): string[] {
  return report.coverage.flatMap((coverage) =>
    (coverage.obligationClosure ?? []).flatMap((closure) => {
      if (
        closure.terminalDisposition !== 'not-applicable' ||
        closure.notApplicableReason === undefined ||
        closure.notApplicableReason === null ||
        closure.notApplicableEvidence === undefined
      ) {
        return [];
      }
      const evidence = closure.notApplicableEvidence
        .map((item) =>
          markdownCode(
            `${item.path}:${item.startLine}${item.endLine === undefined ? '' : `-${item.endLine}`}`,
          ),
        )
        .join(', ');
      return [
        `| ${markdownCode(coverage.vectorId)} | ${markdownCode(closure.obligationId)} | ${markdownEscape(reviewObligationRiskStatement(report, coverage.vectorId, closure.obligationId))} | ${markdownEscape(applicabilityReasonText(closure.notApplicableReason))} | ${evidence} |`,
      ];
    }),
  );
}

function outcomeText(report: PublicAuditReport): string {
  const terminal = classifyAuditTerminal(report);
  if (terminal.outcome !== 'completed') {
    return 'This run has incomplete, failed, or cancelled review work. Resume or investigate that work before treating the scope as covered.';
  }
  if (report.findings.length > 0) {
    return `${report.findings.length} accepted source-backed finding${report.findings.length === 1 ? '' : 's'} require human triage and remediation planning.`;
  }
  if (report.reviewRequired.length > 0) {
    return 'No accepted finding was produced, but source-backed items require human review because independent static-review stages disagreed.';
  }
  return 'No accepted source-backed finding was produced by this completed bounded static run. This is not proof that the target is secure.';
}

/**
 * Human follow-up is intentionally a terminal-state projection. It must not
 * reinterpret source evidence, limitations, or a model claim as a security conclusion.
 */
export function auditVectorNextAction(
  coverage: Pick<PublicAuditReport['coverage'][number], 'outcome' | 'errorCode'>,
): string {
  const error =
    coverage.errorCode === null ? '' : ` Recorded terminal code: ${coverage.errorCode}.`;
  switch (coverage.outcome) {
    case 'completed':
      return 'Audit execution is complete for this vector. Continue with normal report review.';
    case 'not-applicable':
      return 'Keep this as a neutral not-applicable outcome; do not treat it as a passed check.';
    case 'skipped':
      return 'This vector did not execute. Review the plan configuration if coverage is required.';
    case 'incomplete':
      return `Investigate the recorded terminal state, then explicitly resume the same run before treating this vector as covered.${error}`;
    case 'failed':
      return `Investigate the recorded terminal state and explicitly resume the same run only after it is resolved.${error}`;
    case 'cancelled':
      return `Explicitly resume the same run if this vector still requires review; it is not covered.${error}`;
  }
}

function developerNextSteps(
  report: PublicAuditReport,
  finding: PublicAuditReport['findings'][number],
): string {
  const locations = finding.claimEvidenceBundles.flatMap((bundle) =>
    bundle.evidence.map((evidence) => `${evidence.path}:${evidence.startLine}`),
  );
  const obligations = finding.planObligations.map((obligation) => obligation.obligationId);
  const reviewQuestions = finding.planObligations
    .map((obligation) =>
      reviewObligationRiskStatement(report, finding.vectorId, obligation.obligationId),
    )
    .join(' ');
  return `Review the cited source at ${locations.join(', ')}, validate the claim against plan obligation${obligations.length === 1 ? '' : 's'} ${obligations.join(', ')} (${reviewQuestions}), then implement and test an appropriate fix in the target's product context.`;
}

export function renderAuditReportMarkdown(report: PublicAuditReport): string {
  const lines = [
    '# Audit report',
    '',
    `- Report: \`${report.reportId}\``,
    `- Plan: \`${report.planId}\``,
    `- Generated: ${report.generatedAt}`,
    '',
    '## Outcome',
    '',
    outcomeText(report),
    '',
    '## Actionable findings',
    '',
  ];
  if (report.findings.length === 0) {
    lines.push(
      'No accepted source-backed findings were produced. Read the outcome and coverage sections before drawing any conclusion.',
      '',
    );
  }
  for (const finding of report.findings) {
    lines.push(
      `### Accepted source-backed finding ${markdownCode(finding.findingId)}`,
      '',
      'Human triage is required. This is static-review evidence, not proof that an exploit works in production.',
      '',
      ...findingNarrativeLines(finding),
      'Evidence:',
      '',
      '| Role | Location | Content digest |',
      '| --- | --- | --- |',
      ...evidenceRows(finding),
      '',
      `Verification: ${finding.verification.status}. The verifier independently re-established this claim from local source and the sealed plan.`,
      '',
      'Developer next step:',
      '',
      markdownEscape(developerNextSteps(report, finding)),
      '',
    );
  }
  lines.push(
    '## Coverage and review state',
    '',
    '| Vector | Outcome | Files | Map facts | Unanswered plan items | Findings | Limitations |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
    ...report.coverage.map(
      (coverage) =>
        `| \`${coverage.vectorId}\` | ${coverage.outcome} | ${coverage.matchedSourcePaths} | ${coverage.evidenceMapFactCount} | ${coverage.evidenceMapUnansweredObligationCount} | ${coverage.findingCount} | ${coverage.limitations.length === 0 ? 'None' : coverage.limitations.join(', ')} |`,
    ),
    '',
  );
  lines.push(
    '## What to do next',
    '',
    'Each action is derived only from the vector terminal state and its retained error code. It is not a security conclusion.',
    '',
    '| Vector | Terminal state | Next action |',
    '| --- | --- | --- |',
    ...report.coverage.map(
      (coverage) =>
        `| ${markdownCode(coverage.vectorId)} | ${coverage.outcome} | ${markdownEscape(auditVectorNextAction(coverage))} |`,
    ),
    '',
  );
  if (report.reviewRequired.length > 0) {
    lines.push(
      '## Human review required',
      '',
      'These items have source-backed evidence, but independent static-review stages disagree. They are not confirmed findings and do not affect the CI finding gate.',
      '',
    );
    for (const finding of report.reviewRequired) {
      lines.push(
        `### REVIEW REQUIRED ${markdownCode(finding.findingId)}`,
        '',
        ...findingNarrativeLines(finding),
        'Evidence:',
        '',
        '| Role | Location | Content digest |',
        '| --- | --- | --- |',
        ...evidenceRows(finding),
        '',
        'The static-review stages disagree. Re-inspect the listed locations against the private plan before making a security decision.',
        '',
      );
    }
  }
  const notApplicable = applicabilityRows(report);
  if (notApplicable.length > 0) {
    lines.push(
      '## Not applicable (neutral)',
      '',
      'These obligations were completed with source-backed evidence that the stated review does not apply in this approved scope. They are neither passed checks nor findings.',
      '',
      '| Vector | Obligation | Review question | Reason | Selected evidence |',
      '| --- | --- | --- | --- | --- |',
      ...notApplicable,
      '',
    );
  }
  if (report.errors.length > 0) {
    lines.push(
      '## Errors',
      '',
      ...report.errors.map(
        (error) => `- ${error.stage}: ${error.code} (retryable: ${error.retryable})`,
      ),
      '',
    );
  }
  const closures = closureRows(report);
  if (closures.length > 0) {
    lines.push(
      '## Technical appendix',
      '',
      '### Review-obligation closure',
      '',
      'Each row is a source-minimal account of planned review work. A no-source-backed-candidate result means the bounded review retained no candidate; it does not prove the target secure. A not-applicable result is neutral, not a passed check or finding. Inspect the private plan for the local rationale. Incomplete and not-reached rows require follow-up.',
      '',
      '| Vector | Obligation | Review question | Map facts | Source posture | Investigation | Candidates | Findings admitted | Terminal disposition |',
      '| --- | --- | --- | --- | --- | --- | ---: | ---: | --- |',
      ...closures,
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
      '| Vector | Model candidates | Integrity rejected | Tool evidence rejected | Verifier accepted/rejected/incomplete | Verifier tool evidence rejected | Verifier evidence rejected | Verifier reconciled | Post-verification rejected | Duplicates collapsed | Findings admitted |',
      '| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
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
