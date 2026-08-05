import { expect, test } from 'bun:test';

import {
  DeveloperGuidanceModelInputSchema,
  DeveloperGuidanceModelOutputSchema,
} from './contract.js';

test('keeps developer guidance closed to one accepted finding and its exact vector scope', () => {
  const input = {
    guidanceId: 'guidance-001',
    finding: {
      findingId: 'finding-001',
      vectorId: 'vector-001',
      narrative: {
        statement: 'The reviewed operation may be reached with an unsafe condition.',
        roleExplanations: [
          {
            role: 'operation',
            explanation: 'The operation evidence identifies the reviewed action.',
          },
          {
            role: 'unsafe-condition',
            explanation: 'The condition evidence identifies the unsafe state.',
          },
        ],
        limitations: [],
      },
      claimEvidenceBundles: [
        {
          role: 'operation',
          evidence: [
            {
              path: 'src/app.unknown',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'operation',
            },
          ],
        },
        {
          role: 'unsafe-condition',
          evidence: [
            {
              path: 'src/app.unknown',
              startLine: 2,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
              role: 'unsafe-condition',
            },
          ],
        },
      ],
      planObligations: [{ obligationId: 'obligation-001' }],
      status: 'accepted',
      verification: { status: 'verified', checks: ['scope'] },
    },
    vector: {
      vectorId: 'vector-001',
      vectorDigest: 'a'.repeat(64),
      title: 'Reviewed data boundary',
      rationale: 'Review the approved data boundary.',
      enabled: true,
      scopeGlobs: ['src/**'],
      reviewObligations: [
        {
          obligationId: 'obligation-001',
          riskStatement: 'Untrusted input must not reach the operation unsafely.',
          evidenceRequirement: 'Inspect the operation and relevant controls.',
        },
      ],
      limitations: [],
    },
    availableSourcePaths: ['src/app.unknown'],
    context: [],
    inspectionRequirement: { required: true, allowedToolIds: ['repo_read', 'repo_grep'] },
    retryGuidance: { kind: 'initial' },
  };
  expect(DeveloperGuidanceModelInputSchema.parse(input).guidanceId).toBe('guidance-001');
  expect(() =>
    DeveloperGuidanceModelInputSchema.parse({
      ...input,
      finding: { ...input.finding, status: 'needs-review' },
    }),
  ).toThrow();
  expect(() =>
    DeveloperGuidanceModelInputSchema.parse({ ...input, answerKey: 'forbidden' }),
  ).toThrow();
});

test('accepts only the persisted advisory priority', () => {
  const output = { recommendedPriority: 'high' };
  expect(DeveloperGuidanceModelOutputSchema.parse(output).recommendedPriority).toBe('high');
  expect(() =>
    DeveloperGuidanceModelOutputSchema.parse({ ...output, remediation: 'forbidden' }),
  ).toThrow();
});
