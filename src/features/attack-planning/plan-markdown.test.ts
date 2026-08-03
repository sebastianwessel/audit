import { expect, test } from 'bun:test';

import { createPlan } from './plan.js';
import { renderAttackPlanMarkdown } from './plan-markdown.js';

test('renders a deterministic non-executable review projection', () => {
  const plan = createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    inventorySummary: { fileCount: 1, totalBytes: 4, languageHints: [] },
    createdAt: '2026-08-03T12:00:00.000Z',
    vectors: [
      {
        title: 'Review data exposure',
        rationale: 'Sensitive data must not be exposed across trust boundaries.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'data-exposure-01',
            riskStatement: 'Sensitive data may reach an untrusted party.',
            evidenceRequirement: 'Source evidence identifies the disclosure boundary.',
          },
        ],
        limitations: ['No runtime probing is performed.'],
      },
    ],
    additionalObservations: [
      {
        observationId: 'additional-review-01',
        title: 'Review inherited authentication boundary',
        rationale: 'A human may choose to extend the audit beyond the approved vectors.',
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'additional-review-obligation-01',
            riskStatement: 'An inherited boundary may not enforce the expected caller identity.',
            evidenceRequirement:
              'Source evidence identifies the inheritance and enforcement boundary.',
          },
        ],
        limitations: [],
      },
    ],
  });

  const markdown = renderAttackPlanMarkdown(plan);
  expect(markdown).toContain('# Security audit plan');
  expect(markdown).toContain('read-only review projection');
  expect(markdown).toContain('Review data exposure');
  expect(markdown).toContain('data-exposure-01');
  expect(markdown).toContain('No runtime probing is performed.');
  expect(markdown).toContain('Additional observations for human review');
  expect(markdown).toContain('not part of this executable audit plan');
});

test('rejects an unsealed plan before rendering review material', () => {
  const plan = createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    inventorySummary: { fileCount: 1, totalBytes: 4, languageHints: [] },
    createdAt: '2026-08-03T12:00:00.000Z',
    vectors: [
      {
        title: 'Review data exposure',
        rationale: 'Sensitive data must not be exposed across trust boundaries.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'data-exposure-01',
            riskStatement: 'Sensitive data may reach an untrusted party.',
            evidenceRequirement: 'Source evidence identifies the disclosure boundary.',
          },
        ],
        limitations: [],
      },
    ],
  });
  const vector = plan.vectors[0];
  if (vector === undefined) throw new Error('Fixture requires one vector.');

  expect(() =>
    renderAttackPlanMarkdown({ ...plan, vectors: [{ ...vector, scopeGlobs: ['private/**'] }] }),
  ).toThrow('edited without being resealed');
});
