import { expect, test } from 'bun:test';

import { AttackVectorSchema, ProposedFindingSchema } from '../../attack-planning/index.js';
import { EvidenceMapSchema } from '../evidence-map/contract.js';
import { SourcePostureSchema } from '../source-posture/contract.js';
import type { UnverifiedAuditCandidate } from './contract.js';

import { verifyModelFindings } from './verify.js';

const vector = AttackVectorSchema.parse({
  vectorId: 'vector-injection-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Review injection',
  rationale: 'Input may reach a query.',
  enabled: true,
  scopeGlobs: ['src/**'],
  reviewObligations: [
    {
      obligationId: 'test-obligation-01',
      riskStatement: 'Input could reach a query operation.',
      evidenceRequirement: 'Inspect scoped source evidence for query construction.',
    },
  ],
  limitations: [],
});

function finding(vectorId: string, path: string, startLine: number): UnverifiedAuditCandidate {
  return {
    vectorId,
    statement: 'Candidate query issue',
    claimEvidenceBundles: [
      {
        role: 'operation',
        explanation: 'The selected source operation is under review.',
        evidence: [
          { path, startLine, contentDigest: 'a'.repeat(64), kind: 'source', role: 'operation' },
        ],
      },
      {
        role: 'unsafe-condition',
        explanation: 'The selected source condition is under review.',
        evidence: [
          {
            path,
            startLine,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
            role: 'unsafe-condition',
          },
        ],
      },
    ],
    planObligations: [{ obligationId: 'test-obligation-01' }],
    evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
    claimEvidenceSelections: [
      { role: 'operation', selections: [{ factId: 'fact-query-01', evidenceIndex: 0 }] },
      {
        role: 'unsafe-condition',
        selections: [{ factId: 'fact-input-01', evidenceIndex: 0 }],
      },
    ],
    sourcePostureAssessmentIds: ['posture-question-01'],
    limitations: [],
  };
}

function evidenceMap(
  originRole: 'input' | 'asset' | 'boundary' | 'control' = 'input',
  operationObligation = { obligationId: 'test-obligation-01' },
) {
  return EvidenceMapSchema.parse({
    facts: [
      {
        factId: 'fact-input-01',
        role: originRole,
        evidence: [
          {
            path: 'src/query.txt',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
          },
        ],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
      {
        factId: 'fact-query-01',
        role: 'operation',
        evidence: [
          {
            path: 'src/query.txt',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
            role: 'operation',
          },
        ],
        planObligations: [operationObligation],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
}

test('rejects vector mismatches and evidence outside the bounded source package', () => {
  const result = verifyModelFindings(
    vector,
    [finding('vector-other-01', 'src/query.txt', 1), finding(vector.vectorId, 'private/x.txt', 1)],
    [{ path: 'src/query.txt', content: `SELECT \${input}`, languageHint: null }],
  );
  expect(result.verified).toHaveLength(0);
  expect(result.rejectedCount).toBe(2);
  expect(result.rejectionReasons).toEqual([
    'model-evidence-invalid-or-out-of-scope',
    'model-vector-mismatch',
  ]);
});

test('validates exact source evidence without inferring source semantics', () => {
  const sources = [
    {
      path: 'src/query.txt',
      content: `const value = input;\nSELECT \${value}`,
      languageHint: null,
    },
  ];
  const accepted = verifyModelFindings(
    vector,
    [finding(vector.vectorId, 'src/query.txt', 2)],
    sources,
  );
  expect(accepted.verified).toHaveLength(1);
  const alsoGrounded = verifyModelFindings(
    vector,
    [finding(vector.vectorId, 'src/query.txt', 1)],
    sources,
  );
  expect(alsoGrounded.verified).toHaveLength(1);
});

test('does not require deterministic candidate evidence', () => {
  const sources = [
    { path: 'src/settings.txt', content: 'api_key = "abcdefghijk"', languageHint: null },
  ];
  const accepted = verifyModelFindings(
    vector,
    [finding(vector.vectorId, 'src/settings.txt', 1)],
    sources,
  );
  expect(accepted.verified).toHaveLength(1);
});

test('requires every selected map fact to bind the approved plan obligation without interpreting roles', () => {
  const sources = [{ path: 'src/query.txt', content: `SELECT \${input}`, languageHint: null }];
  const candidate = finding(vector.vectorId, 'src/query.txt', 1);
  expect(verifyModelFindings(vector, [candidate], sources, evidenceMap()).verified).toHaveLength(1);

  const roleNeutral = verifyModelFindings(vector, [candidate], sources, evidenceMap('control'));
  expect(roleNeutral.verified).toHaveLength(1);

  const invalidMapFact = verifyModelFindings(
    vector,
    [{ ...candidate, evidenceMapFactIds: ['fact-missing-01'] }],
    sources,
    evidenceMap(),
  );
  expect(invalidMapFact.rejectionReasons).toEqual(['model-evidence-map-reference-invalid']);

  const mismatchedObligation = verifyModelFindings(
    vector,
    [candidate],
    sources,
    evidenceMap('input', { obligationId: 'missing-obligation-01' }),
  );
  expect(mismatchedObligation.rejectionReasons).toEqual(['model-evidence-map-reference-invalid']);
});

test('rejects a missing map fact even when selected valid facts cover the candidate obligation', () => {
  const sources = [{ path: 'src/query.txt', content: `SELECT \${input}`, languageHint: null }];
  const map = EvidenceMapSchema.parse({
    facts: [
      {
        factId: 'fact-entrypoint-01',
        role: 'entrypoint',
        evidence: [
          { path: 'src/query.txt', startLine: 1, contentDigest: 'a'.repeat(64), kind: 'source' },
        ],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
      ...evidenceMap().facts,
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  const candidate = {
    ...finding(vector.vectorId, 'src/query.txt', 1),
    evidenceMapFactIds: ['fact-entrypoint-01', 'fact-input-01', 'fact-query-01'],
  };
  expect(verifyModelFindings(vector, [candidate], sources, map).verified).toHaveLength(1);

  const invalid = { ...candidate, evidenceMapFactIds: ['fact-entrypoint-01', 'fact-missing-01'] };
  expect(verifyModelFindings(vector, [invalid], sources, map).rejectionReasons).toEqual([
    'model-evidence-map-reference-invalid',
  ]);
});

test('requires candidate evidence locations to come from its selected map facts', () => {
  const sources = [
    {
      path: 'src/query.txt',
      content: `SELECT \${input}\nSELECT \${otherInput}`,
      languageHint: null,
    },
  ];
  const candidate = {
    ...finding(vector.vectorId, 'src/query.txt', 2),
    claimEvidenceBundles: [
      {
        role: 'operation' as const,
        explanation: 'The selected operation is outside the map basis.',
        evidence: [
          {
            path: 'src/query.txt',
            startLine: 2,
            contentDigest: 'a'.repeat(64),
            kind: 'source' as const,
            role: 'operation' as const,
          },
        ],
      },
      {
        role: 'unsafe-condition' as const,
        explanation: 'The selected condition is outside the map basis.',
        evidence: [
          {
            path: 'src/query.txt',
            startLine: 2,
            contentDigest: 'a'.repeat(64),
            kind: 'source' as const,
            role: 'unsafe-condition' as const,
          },
        ],
      },
    ],
  };
  expect(verifyModelFindings(vector, [candidate], sources, evidenceMap()).rejectionReasons).toEqual(
    ['model-evidence-map-reference-invalid'],
  );
});

test('keeps source-posture conclusions as evidence context rather than a semantic admission veto', () => {
  const sources = [{ path: 'src/query.txt', content: `SELECT \${input}`, languageHint: null }];
  const posture = SourcePostureSchema.parse({
    assessments: [
      {
        assessmentId: 'posture-question-01',
        obligationId: 'test-obligation-01',
        conclusion: 'risk-contradicted',
        evidenceMapFactIds: ['fact-input-01', 'fact-query-01'],
        limitations: [],
      },
    ],
    limitations: [],
  });
  const result = verifyModelFindings(
    vector,
    [finding(vector.vectorId, 'src/query.txt', 1)],
    sources,
    evidenceMap(),
    posture,
  );
  expect(result.verified).toHaveLength(1);
});

test('rejects an absent or out-of-range approved-plan obligation reference', () => {
  const source = [{ path: 'src/query.txt', content: `SELECT \${input}`, languageHint: null }];
  const valid = finding(vector.vectorId, 'src/query.txt', 1);
  const { planObligations: _planObligations, ...withoutReference } = valid;
  expect(ProposedFindingSchema.safeParse(withoutReference).success).toBe(false);
  expect(
    verifyModelFindings(
      vector,
      [{ ...valid, planObligations: [{ obligationId: 'missing-obligation-01' }] }],
      source,
    ).rejectionReasons,
  ).toEqual(['model-plan-obligation-invalid']);
});

test('preserves model evidence order after replacing snippets from source', () => {
  const sources = [
    {
      path: 'src/settings.txt',
      content: 'description only\napi_key = "abcdefghijk"',
      languageHint: null,
    },
  ];
  const result = verifyModelFindings(
    vector,
    [
      {
        ...finding(vector.vectorId, 'src/settings.txt', 1),
        claimEvidenceBundles: [
          {
            role: 'operation',
            explanation: 'The operation spans both selected source locations.',
            evidence: [
              {
                path: 'src/settings.txt',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
                role: 'operation',
              },
              {
                path: 'src/settings.txt',
                startLine: 2,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
                role: 'operation',
              },
            ],
          },
          {
            role: 'unsafe-condition',
            explanation: 'The unsafe condition is selected independently.',
            evidence: [
              {
                path: 'src/settings.txt',
                startLine: 1,
                contentDigest: 'a'.repeat(64),
                kind: 'source',
                role: 'unsafe-condition',
              },
            ],
          },
        ],
      },
    ],
    sources,
  );
  expect(result.verified[0]?.claimEvidenceBundles[0]?.evidence[0]).toMatchObject({
    role: 'operation',
    startLine: 1,
  });
});

test('retains a complete long source line and recognizes CR-only line locations', () => {
  const longLine = `operation = ${'x'.repeat(20_000)};`;
  const result = verifyModelFindings(
    vector,
    [finding(vector.vectorId, 'src/query.txt', 2)],
    [{ path: 'src/query.txt', content: `first\r${longLine}\rthird`, languageHint: null }],
  );
  expect(result.verified[0]?.claimEvidenceBundles).toMatchObject([
    { role: 'operation', evidence: [{ startLine: 2 }] },
    { role: 'unsafe-condition', evidence: [{ startLine: 2 }] },
  ]);
});
