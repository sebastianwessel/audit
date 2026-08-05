import { expect, test } from 'bun:test';

import { sha256 } from '../../../shared/contracts/core.js';
import type { NarratedProposedFinding } from '../narrative/contract.js';

import { canonicalizeProposedFindings, synthesizeFindings } from './findings.js';
import { createFindingFingerprint, createFindingId } from './identity.js';

test('retains only canonical source-minimal finding provenance', () => {
  const input: NarratedProposedFinding = {
    vectorId: 'vector-secrets-01',
    narrative: narrative(),
    claimEvidenceBundles: bundles("token = 'unredacted-value'"),
    planObligations: [{ obligationId: 'synthesis-obligation-01' }],
  };
  const finding = synthesizeFindings([input])[0];
  if (finding === undefined) throw new Error('Expected a synthesized finding.');
  expect(finding.status).toBe('accepted');
  expect(JSON.stringify(finding)).toContain(sha256("token = 'unredacted-value'"));
});

test('never persists source content in a synthesized finding', () => {
  const finding = synthesizeFindings([
    {
      vectorId: 'vector-safe-artifact-01',
      narrative: narrative(),
      claimEvidenceBundles: bundles('token = "not-for-artifacts";\u001b[2J'),
      planObligations: [{ obligationId: 'synthesis-obligation-01' }],
    },
  ])[0];

  expect(JSON.stringify(finding)).not.toContain('not-for-artifacts');
  expect(finding?.claimEvidenceBundles[0]?.evidence[0]?.contentDigest).toBe(
    sha256('token = "not-for-artifacts";\u001b[2J'),
  );
});

test('keeps separate source occurrences distinct while retaining a line-shift-stable fingerprint', () => {
  const first: NarratedProposedFinding = {
    vectorId: 'vector-identity-01',
    narrative: narrative(),
    claimEvidenceBundles: bundles('first occurrence'),
    planObligations: [{ obligationId: 'synthesis-obligation-01' }],
  };
  const second: NarratedProposedFinding = {
    ...first,
    claimEvidenceBundles: first.claimEvidenceBundles.map((bundle) => ({
      ...bundle,
      evidence: bundle.evidence.map((evidence) => ({ ...evidence, startLine: 2 })),
    })),
  };
  expect(createFindingId(first)).not.toBe(createFindingId(second));
  expect(createFindingFingerprint(first)).toBe(createFindingFingerprint(second));
  expect(canonicalizeProposedFindings([first, second]).findings).toHaveLength(2);
});

test('collapses exact canonical duplicates', () => {
  const first: NarratedProposedFinding = {
    vectorId: 'vector-identity-02',
    narrative: narrative(),
    claimEvidenceBundles: bundles('duplicate occurrence'),
    planObligations: [{ obligationId: 'synthesis-obligation-01' }],
  };
  const duplicate = { ...first };
  const collapsed = canonicalizeProposedFindings([first, duplicate]);
  expect(collapsed.duplicateCollapsedCount).toBe(1);
  expect(collapsed.findings).toEqual([first]);
});

test('rejects conflicting narratives for one source-minimal finding identity', () => {
  const first: NarratedProposedFinding = {
    vectorId: 'vector-identity-03',
    narrative: narrative(),
    claimEvidenceBundles: bundles('same occurrence'),
    planObligations: [{ obligationId: 'synthesis-obligation-01' }],
  };

  expect(() =>
    canonicalizeProposedFindings([
      first,
      {
        ...first,
        narrative: { ...first.narrative, statement: 'A conflicting claim description.' },
      },
    ]),
  ).toThrow('Conflicting validated narratives');
});

function bundles(snippet: string) {
  return [
    {
      role: 'operation' as const,
      evidence: [
        {
          path: 'src/settings.txt',
          startLine: 1,
          contentDigest: sha256(snippet),
          kind: 'source' as const,
          role: 'operation' as const,
        },
      ],
    },
    {
      role: 'unsafe-condition' as const,
      evidence: [
        {
          path: 'src/settings.txt',
          startLine: 1,
          contentDigest: sha256(snippet),
          kind: 'source' as const,
          role: 'unsafe-condition' as const,
        },
      ],
    },
  ];
}

function narrative() {
  return {
    statement: 'The reviewed operation may be reached with an unsafe condition.',
    roleExplanations: [
      { role: 'operation' as const, explanation: 'The operation evidence identifies the action.' },
      {
        role: 'unsafe-condition' as const,
        explanation: 'The condition evidence identifies the unsafe state.',
      },
    ],
    limitations: [],
  };
}
