import { expect, test } from 'bun:test';

import { AttackVectorSchema } from '../../attack-planning/plan.schema.js';

import { EvidenceMapSchema, UnverifiedEvidenceMapSchema } from './contract.js';
import { verifyEvidenceMap } from './verify.js';

const vector = AttackVectorSchema.parse({
  vectorId: 'vector-boundary-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Review bounded source',
  rationale: 'Review the approved source without making a language-specific assumption.',
  enabled: true,
  scopeGlobs: ['reviewed.unknown'],
  reviewObligations: [
    {
      obligationId: 'test-obligation-01',
      riskStatement: 'A bounded source risk may be present.',
      evidenceRequirement: 'Every retained fact is source-backed and within approved scope.',
    },
  ],
  limitations: [],
});

test('retains only map facts with valid source locations and approved plan bindings', () => {
  const result = verifyEvidenceMap(
    vector,
    UnverifiedEvidenceMapSchema.parse({
      facts: [
        {
          factId: 'fact-valid-01',
          role: 'operation',
          statement: 'The reviewed source contains the selected operation.',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
            },
          ],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
        {
          factId: 'fact-outside-01',
          role: 'input',
          statement: 'An unavailable source contains an input.',
          evidence: [
            {
              path: 'other.unknown',
              startLine: 1,
            },
          ],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
        {
          factId: 'fact-unbound-01',
          role: 'output',
          statement: 'The reviewed source contains an output.',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
            },
          ],
          planObligations: [{ obligationId: 'unknown-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [
        { obligationId: 'test-obligation-01' },
        { obligationId: 'unknown-obligation-01' },
      ],
      limitations: ['The mapper recorded a neutral limitation.'],
    }),
    [{ path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null }],
  );

  expect(result.rejectedFactCount).toBe(2);
  expect(result.evidenceMap.facts).toMatchObject([
    {
      factId: 'fact-valid-01',
      evidence: [{ path: 'reviewed.unknown', snippet: 'value = request.input;' }],
    },
  ]);
  expect(result.evidenceMap.unansweredPlanObligations).toEqual([]);
});

test('retains a complete long source line without a product snippet cap', () => {
  const longLine = `value = ${'x'.repeat(20_000)};`;
  const result = verifyEvidenceMap(
    vector,
    {
      facts: [
        {
          factId: 'fact-long-line-01',
          role: 'operation',
          statement: 'The approved source contains the reviewed operation.',
          evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [],
      limitations: [],
    },
    [{ path: 'reviewed.unknown', content: longLine, languageHint: null }],
  );
  expect(result.evidenceMap.facts[0]?.evidence[0]?.snippet).toHaveLength(longLine.length);
});

test('projects the requested line from CR-only source text', () => {
  const result = verifyEvidenceMap(
    vector,
    {
      facts: [
        {
          factId: 'fact-cr-only-01',
          role: 'operation',
          statement: 'The reviewed operation is on the second physical line.',
          evidence: [{ path: 'reviewed.unknown', startLine: 2 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [],
      limitations: [],
    },
    [{ path: 'reviewed.unknown', content: 'first\roperation\rthird', languageHint: null }],
  );
  expect(result.evidenceMap.facts[0]?.evidence[0]?.snippet).toBe('operation');
});

test('projects source snippets through the safe artifact redactor', () => {
  const result = verifyEvidenceMap(
    vector,
    {
      facts: [
        {
          factId: 'fact-safe-artifact-01',
          role: 'operation',
          statement: 'The approved source contains a selected operation.',
          evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [],
      limitations: [],
    },
    [
      {
        path: 'reviewed.unknown',
        content: 'password = "not-for-artifacts";\u001b[2J',
        languageHint: null,
      },
    ],
  );

  expect(result.evidenceMap.facts[0]?.evidence[0]?.snippet).toBe('password = "[REDACTED]";[2J');
});

test('rejects duplicate map fact identifiers at the strict contract boundary', () => {
  const fact = {
    factId: 'fact-duplicate-01',
    role: 'operation' as const,
    statement: 'The reviewed source contains the selected operation.',
    evidence: [
      { path: 'reviewed.unknown', startLine: 1, snippet: 'source', kind: 'source' as const },
    ],
    planObligations: [{ obligationId: 'test-obligation-01' }],
  };
  expect(() =>
    EvidenceMapSchema.parse({
      facts: [fact, fact],
      unansweredPlanObligations: [],
      limitations: [],
    }),
  ).toThrow('identifiers must be unique');
});

test('rejects canonical map states that make one obligation both mapped and unanswered', () => {
  expect(() =>
    EvidenceMapSchema.parse({
      facts: [
        {
          factId: 'fact-overlap-01',
          role: 'operation',
          statement: 'The reviewed source contains a neutral operation.',
          evidence: [{ path: 'reviewed.unknown', startLine: 1, snippet: 'source', kind: 'source' }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      unansweredPlanObligations: [{ obligationId: 'test-obligation-01' }],
      limitations: [],
    }),
  ).toThrow('cannot also be unanswered');
});

test('normalizes only known model enum casing at the map boundary', () => {
  const parsed = EvidenceMapSchema.parse({
    facts: [
      {
        factId: 'fact-normalized-01',
        role: ' Operation ',
        statement: 'The reviewed source contains the selected operation.',
        evidence: [{ path: 'reviewed.unknown', startLine: 1, snippet: 'source', kind: ' SOURCE ' }],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  expect(parsed.facts[0]).toMatchObject({ role: 'operation', evidence: [{ kind: 'source' }] });
});

test('turns a structurally incomplete model map fact into a counted rejection', () => {
  const candidate = UnverifiedEvidenceMapSchema.parse({
    facts: [
      {
        factId: 'fact-incomplete-01',
        role: 'control',
        statement: 'A candidate fact needs source and plan validation.',
        evidence: [],
        planObligations: [],
      },
    ],
    controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
    unansweredPlanObligations: [],
    limitations: [],
  });
  const result = verifyEvidenceMap(vector, candidate, [
    { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
  ]);
  expect(result).toMatchObject({ rejectedFactCount: 1, evidenceMap: { facts: [] } });
});

test('quarantines invalid model facts without discarding independent canonical facts', () => {
  const result = verifyEvidenceMap(
    vector,
    UnverifiedEvidenceMapSchema.parse({
      facts: [
        {
          factId: 'fact-retained-01',
          role: 'operation',
          statement: 'The operation is retained after canonical source projection.',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
            },
          ],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
        {
          factId: 'fact-invalid-obligation-01',
          role: 'operation',
          statement: 'An out-of-plan reference must not reach the canonical map.',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
            },
          ],
          planObligations: [{ obligationId: 'unknown-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [],
      limitations: [],
    }),
    [{ path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null }],
  );

  expect(result.rejectedFactCount).toBe(1);
  expect(result.evidenceMap.facts).toMatchObject([
    {
      factId: 'fact-retained-01',
      evidence: [{ snippet: 'value = request.input;' }],
    },
  ]);
  expect(result.evidenceMap.facts[0]?.evidence[0]?.role).toBeUndefined();
});

test('rejects an invalid neutral role at the model boundary', () => {
  expect(() =>
    UnverifiedEvidenceMapSchema.parse({
      facts: [
        {
          factId: 'fact-invalid-role-01',
          role: 'unrecognized-model-role',
          statement: 'The role is not part of the neutral map vocabulary.',
          evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [],
      limitations: [],
    }),
  ).toThrow();
});

test('marks a map incomplete when an approved obligation is neither mapped nor unanswered', () => {
  const multiObligationVector = AttackVectorSchema.parse({
    ...vector,
    reviewObligations: [
      {
        obligationId: 'first-obligation-01',
        riskStatement: 'The first bounded risk may be present.',
        evidenceRequirement: 'First source proof.',
      },
      {
        obligationId: 'second-obligation-01',
        riskStatement: 'The second bounded risk may be present.',
        evidenceRequirement: 'Second source proof.',
      },
    ],
  });
  const result = verifyEvidenceMap(
    multiObligationVector,
    UnverifiedEvidenceMapSchema.parse({
      facts: [
        {
          factId: 'fact-first-01',
          role: 'operation',
          statement: 'A mapped neutral fact.',
          evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
          planObligations: [{ obligationId: 'first-obligation-01' }],
        },
      ],
      controlCoverage: [
        { obligationId: 'first-obligation-01', controlFactIds: [] },
        { obligationId: 'second-obligation-01', controlFactIds: [] },
      ],
      unansweredPlanObligations: [],
      limitations: [],
    }),
    [{ path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null }],
  );
  expect(result.complete).toBe(false);
});

test('fails map completeness when a mapped control is omitted from the mapper control inventory', () => {
  const result = verifyEvidenceMap(
    vector,
    UnverifiedEvidenceMapSchema.parse({
      facts: [
        {
          factId: 'fact-control-omitted-01',
          role: 'control',
          statement: 'A source-visible control is mapped neutrally.',
          evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
      controlCoverage: [{ obligationId: 'test-obligation-01', controlFactIds: [] }],
      unansweredPlanObligations: [],
      limitations: [],
    }),
    [{ path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null }],
  );

  expect(result.complete).toBe(false);
});
