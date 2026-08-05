import { redactArtifactText } from '../../shared/contracts/artifact-text.js';

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
    ...(sealedPlan.resealedFromPlanId === undefined
      ? []
      : [
          `- Resealed from: ${code(sealedPlan.resealedFromPlanId)}`,
          `- Resealed: ${sealedPlan.resealedAt}`,
        ]),
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

  lines.push('## Additional observations for human review', '');
  if (sealedPlan.additionalObservations.length === 0) {
    lines.push('None. These suggestions are optional and do not affect this audit run.');
  }
  for (const observation of sealedPlan.additionalObservations) {
    lines.push(
      `### ${text(observation.title)}`,
      '',
      `- Observation: ${code(observation.observationId)}`,
      '- Status: human review recommended; not part of this executable audit plan',
      '- Execution: not dispatched; cannot produce a finding, pass, or incomplete coverage result',
      `- Rationale: ${text(observation.rationale)}`,
      '- Suggested scope:',
      ...observation.scopeGlobs.map((scopeGlob) => `  - ${code(scopeGlob)}`),
      '- Suggested review obligations:',
      ...observation.reviewObligations.flatMap((obligation) => [
        `  - ${code(obligation.obligationId)} — ${text(obligation.riskStatement)}`,
        `    - Required evidence: ${text(obligation.evidenceRequirement)}`,
      ]),
      ...(observation.limitations.length === 0
        ? []
        : [
            '- Limitations:',
            ...observation.limitations.map((limitation) => `  - ${text(limitation)}`),
          ]),
      '',
    );
  }

  return `${lines.join('\n')}\n`;
}
