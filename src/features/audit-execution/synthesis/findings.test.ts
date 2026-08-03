import { expect, test } from 'bun:test';

import type { ProposedFinding } from '../../attack-planning/plan.schema.js';

import { synthesizeFindings } from './findings.js';

test('redacts model-controlled finding text before it becomes a persisted finding', () => {
  const input: ProposedFinding = {
    vectorId: 'vector-secrets-01',
    statement: 'Credential exposure',
    evidence: [
      {
        path: 'src/settings.txt',
        startLine: 1,
        snippet: "token = 'unredacted-value'",
        kind: 'source',
      },
    ],
    planObligations: [{ obligationId: 'synthesis-obligation-01' }],
    limitations: ['Contact alice@example.test to validate the remediation.'],
  };
  const finding = synthesizeFindings([input])[0];
  if (finding === undefined) throw new Error('Expected a synthesized finding.');
  expect(finding.status).toBe('accepted');
  expect(JSON.stringify(finding)).not.toContain('unredacted-value');
  expect(JSON.stringify(finding)).not.toContain('alice@example.test');
});

test('removes control characters from persisted finding evidence', () => {
  const finding = synthesizeFindings([
    {
      vectorId: 'vector-safe-artifact-01',
      statement: 'A source-backed issue may be present.',
      evidence: [
        {
          path: 'src/settings.txt',
          startLine: 1,
          snippet: 'token = "not-for-artifacts";\u001b[2J',
          kind: 'source',
        },
      ],
      planObligations: [{ obligationId: 'synthesis-obligation-01' }],
      limitations: [],
    },
  ])[0];

  expect(finding?.evidence[0]?.snippet).toBe('token = "[REDACTED]";[2J');
});
