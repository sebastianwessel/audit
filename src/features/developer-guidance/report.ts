import type { DeveloperGuidanceReport } from './guidance.schema.js';

/** Human projection of optional advice; it is intentionally not an audit-report rewrite. */
export function renderDeveloperGuidanceMarkdown(report: DeveloperGuidanceReport): string {
  const lines = [
    '# Developer guidance',
    '',
    `- Guidance: \`${report.guidanceId}\``,
    `- Audit report: \`${report.reportId}\``,
    `- Plan: \`${report.planId}\``,
    '',
    'This is advisory guidance for already accepted static-review findings. It does not change the audit result or prove exploitability.',
    '',
  ];
  for (const item of report.items) {
    lines.push(`## Finding \`${item.findingId}\``, '');
    if (item.status === 'incomplete') {
      lines.push(`Guidance remains incomplete: \`${item.reasonCode}\`.`, '');
      continue;
    }
    if (item.status === 'cancelled') {
      lines.push(
        'Guidance was cancelled by the provider and requires explicit unfinished recovery.',
        '',
      );
      continue;
    }
    lines.push(
      `Recommended priority (advisory): **${item.recommendedPriority}**`,
      '',
      'Review the accepted finding evidence and the plan-owned obligations with the owning engineering team. Choose, implement, and validate the product-appropriate mitigation in the normal change-management workflow.',
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
