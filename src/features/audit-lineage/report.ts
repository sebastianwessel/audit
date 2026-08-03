import type { AuditReportLineage } from './contract.js';

/** Renders only opaque identifiers and source-free status metadata for human review. */
export function renderAuditReportLineageMarkdown(lineage: AuditReportLineage): string {
  const lines = [
    '# Security review lineage',
    '',
    `- Lineage: \`${lineage.lineageId}\``,
    `- Previous report: \`${lineage.previous.reportId}\``,
    `- Current report: \`${lineage.current.reportId}\``,
    `- Generated: ${lineage.generatedAt}`,
    '',
    '## Summary',
    '',
    '| New | Persisting | Resolved | Unknown |',
    '| ---: | ---: | ---: | ---: |',
    `| ${lineage.counts.new} | ${lineage.counts.persisting} | ${lineage.counts.resolved} | ${lineage.counts.unknown} |`,
    '',
    'A new, resolved, or persisting state is emitted only when the corresponding vector completed in both reports. Unknown means the comparison cannot support a lifecycle conclusion.',
    '',
    '## Entries',
    '',
    '| Identity | Previous finding | Current finding | Status | Reason |',
    '| --- | --- | --- | --- | --- |',
    ...lineage.entries.map(
      (entry) =>
        `| \`${entry.findingIdentity}\` | ${entry.previousFindingId === null ? '—' : `\`${entry.previousFindingId}\``} | ${entry.currentFindingId === null ? '—' : `\`${entry.currentFindingId}\``} | ${entry.status} | ${entry.reason} |`,
    ),
    '',
  ];
  return lines.join('\n');
}
