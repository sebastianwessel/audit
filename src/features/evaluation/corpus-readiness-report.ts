import type { CorpusReadinessReport } from './corpus-readiness.schema.js';

/** Renders a human-readable evaluator-only data-sufficiency artifact. */
export function renderCorpusReadinessReport(report: CorpusReadinessReport): string {
  const lines = [
    '# Evaluation corpus readiness',
    '',
    `- Pack: \`${report.packId}@${report.packVersion}\``,
    `- Pilot ready: **${report.pilotReady ? 'yes' : 'no'}**`,
    `- Provider reliability gate ready: **${report.reliabilityGateReady ? 'yes' : 'no'}**`,
    '- This is data-sufficiency evidence, not a model-quality score.',
    '',
    '## Evidence counts',
    '',
    '| Cases | Real-world cases | Paired cases | Real-world pairs | Dual-reviewed pairs | Dual-reviewed patched negatives | Dual-reviewed holdout pairs | Dual-reviewed language families |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${report.counts.caseCount} | ${report.counts.realWorldCaseCount} | ${report.counts.pairedCaseCount} | ${report.counts.realWorldPairedProjectCount} | ${report.counts.realWorldDualReviewedPairedProjectCount} | ${report.counts.dualReviewedPatchedNegativeProjectCount} | ${report.counts.dualReviewedPrivateHoldoutRealWorldPairedProjectCount} | ${report.counts.dualReviewedRealWorldLanguageFamilyCount} |`,
    '',
    '## Development control-family coverage',
    '',
    '| Control family | Real-world paired projects | Dual-reviewed paired projects |',
    '| --- | ---: | ---: |',
    ...report.byControlFamily.map(
      (entry) =>
        `| ${entry.family} | ${entry.realWorldPairedProjectCount} | ${entry.dualReviewedRealWorldPairedProjectCount} |`,
    ),
    '',
    '## Admission criteria',
    '',
    '| Level | Criterion | Observed | Minimum | Status |',
    '| --- | --- | ---: | ---: | --- |',
    ...report.criteria.map(
      (criterion) =>
        `| ${criterion.level} | ${criterion.criterionId} | ${criterion.observedCount} | ${criterion.minimumCount} | ${criterion.met ? 'met' : 'unmet'} |`,
    ),
  ];
  if (report.limitations.length > 0) {
    lines.push('', '## Remaining data gaps', '', ...report.limitations.map((item) => `- ${item}`));
  }
  return `${lines.join('\n')}\n`;
}
