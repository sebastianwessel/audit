import { redactArtifactText } from '../audit-execution/investigation/redaction.js';

import { assertPlanIsSealed } from './plan.js';
import { type AttackPlan, AttackPlanSchema } from './plan.schema.js';

function text(value: string): string {
  return redactArtifactText(value)
    .replaceAll('|', '\\|')
    .replaceAll(/\r?\n|\r/gu, ' ');
}

function code(value: string): string {
  return `\`${redactArtifactText(value).replaceAll('`', '´')}\``;
}

/** Creates the deterministic, non-executable human projection of a sealed plan. */
export function renderAttackPlanMarkdown(plan: AttackPlan): string {
  const sealedPlan = AttackPlanSchema.parse(plan);
  assertPlanIsSealed(sealedPlan);
  const lines = [
    '# Security audit plan',
    '',
    '> This Markdown file is a read-only review projection. The audit engine accepts only its paired sealed JSON plan. To make a change, create an editable draft and reseal it into a new JSON/Markdown plan pair.',
    '',
    '## Plan identity',
    '',
    `- Plan: ${code(sealedPlan.planId)}`,
    `- Target snapshot: ${code(sealedPlan.targetFingerprint)}`,
    `- Context: ${code(sealedPlan.contextDigest)}`,
    `- Target label: ${text(sealedPlan.targetDisplayName)}`,
    `- Created: ${sealedPlan.createdAt}`,
    `- Inventoried files: ${sealedPlan.inventorySummary.fileCount}`,
    `- Inventoried bytes: ${sealedPlan.inventorySummary.totalBytes}`,
    '',
    '## Review vectors',
    '',
  ];

  for (const [index, vector] of sealedPlan.vectors.entries()) {
    lines.push(
      `### ${index + 1}. ${text(vector.title)}`,
      '',
      `- Vector: ${code(vector.vectorId)}`,
      `- Status: ${vector.enabled ? 'enabled' : 'disabled (neutral)'}`,
      `- Rationale: ${text(vector.rationale)}`,
      '- Scoped source paths:',
      ...vector.scopeGlobs.map((scopeGlob) => `  - ${code(scopeGlob)}`),
      '- Review obligations:',
    );
    for (const obligation of vector.reviewObligations) {
      lines.push(
        `  - ${code(obligation.obligationId)} — ${text(obligation.riskStatement)}`,
        `    - Required evidence: ${text(obligation.evidenceRequirement)}`,
      );
    }
    if (vector.limitations.length > 0) {
      lines.push(
        '- Limitations:',
        ...vector.limitations.map((limitation) => `  - ${text(limitation)}`),
      );
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
