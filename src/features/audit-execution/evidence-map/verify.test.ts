import { expect, test } from 'bun:test';
import { sha256 } from '../../../shared/contracts/core.js';
import { AttackVectorSchema } from '../../attack-planning/index.js';
import { createSourceSnapshot } from '../../target-inventory/source-snapshot.js';
import { createSourceEvidenceResolver } from '../source-evidence-resolver.js';

import {
  EvidenceMapInsufficienciesSchema,
  EvidenceMapSchema,
  UnverifiedEvidenceMapRepairSchema,
  UnverifiedEvidenceMapSchema,
} from './contract.js';
import {
  applyEvidenceMapRepair,
  evidenceMapInsufficiencySignature,
  verifyEvidenceMapInsufficiencies,
} from './repair.js';
import { verifyEvidenceMap, verifyEvidenceMapFragment } from './verify.js';

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

function sourceEvidenceFor(
  sources: readonly { path: string; content: string; languageHint: string | null }[],
) {
  return createSourceEvidenceResolver({
    sourceSnapshot: createSourceSnapshot(sources),
    sourcePaths: sources.map((source) => source.path),
  });
}

test('retains only map facts with valid source locations and approved plan bindings', async () => {
  const result = await verifyEvidenceMap(
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
    sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
    ]),
  );

  expect(result.rejectedFactCount).toBe(2);
  expect(result.evidenceMap.facts).toMatchObject([
    {
      factId: 'fact-valid-01',
      evidence: [{ path: 'reviewed.unknown' }],
    },
  ]);
  expect(result.evidenceMap.unansweredPlanObligations).toEqual([]);
  expect(result.evidenceMap.facts[0]?.summary).toBe(
    'The reviewed source contains the selected operation.',
  );
  expect(result.evidenceMap.limitations).toEqual(['model-declared-limitation']);
});

test('accepts an empty recovery fragment while the complete-vector verifier remains incomplete', async () => {
  const fragment = await verifyEvidenceMapFragment(
    vector,
    {
      facts: [],
      controlCoverage: [],
      unansweredPlanObligations: [],
      limitations: ['This exact recovery child had no relevant source fact.'],
    },
    sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
    ]),
  );
  expect(fragment).toMatchObject({ rejectedFactCount: 0, evidenceMap: { facts: [] } });
  expect(
    (
      await verifyEvidenceMap(
        vector,
        {
          facts: [],
          controlCoverage: [],
          unansweredPlanObligations: [],
          limitations: [],
        },
        sourceEvidenceFor([
          { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
        ]),
      )
    ).complete,
  ).toBe(false);
});

test('binds a complete long source line without persisting it', async () => {
  const longLine = `value = ${'x'.repeat(20_000)};`;
  const result = await verifyEvidenceMap(
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
    sourceEvidenceFor([{ path: 'reviewed.unknown', content: longLine, languageHint: null }]),
  );
  expect(result.evidenceMap.facts[0]?.evidence[0]?.contentDigest).toBe(sha256(longLine));
});

test('projects the requested line from CR-only source text', async () => {
  const result = await verifyEvidenceMap(
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
    sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'first\roperation\rthird', languageHint: null },
    ]),
  );
  expect(result.evidenceMap.facts[0]?.evidence[0]?.contentDigest).toBe(sha256('operation'));
});

test('does not persist a sensitive selected source line', async () => {
  const result = await verifyEvidenceMap(
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
    sourceEvidenceFor([
      {
        path: 'reviewed.unknown',
        content: 'password = "not-for-artifacts";\u001b[2J',
        languageHint: null,
      },
    ]),
  );

  expect(JSON.stringify(result.evidenceMap)).not.toContain('not-for-artifacts');
  expect(result.evidenceMap.facts[0]?.evidence[0]?.contentDigest).toBe(
    sha256('password = "not-for-artifacts";\u001b[2J'),
  );
});

test('rejects duplicate map fact identifiers at the strict contract boundary', () => {
  const fact = {
    factId: 'fact-duplicate-01',
    role: 'operation' as const,
    evidence: [
      {
        path: 'reviewed.unknown',
        startLine: 1,
        contentDigest: 'a'.repeat(64),
        kind: 'source' as const,
      },
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

test('retains only the named validated summary field in a canonical evidence map', () => {
  const fact = {
    factId: 'fact-prose-01',
    role: 'operation',
    summary: 'MODEL_STATEMENT_SENTINEL',
    evidence: [
      {
        path: 'reviewed.unknown',
        startLine: 1,
        contentDigest: 'a'.repeat(64),
        kind: 'source',
      },
    ],
    planObligations: [{ obligationId: 'test-obligation-01' }],
  };
  expect(
    EvidenceMapSchema.parse({ facts: [fact], unansweredPlanObligations: [], limitations: [] }),
  ).toMatchObject({ facts: [{ summary: 'MODEL_STATEMENT_SENTINEL' }] });
  expect(() =>
    EvidenceMapSchema.parse({
      facts: [{ ...fact, statement: 'A forbidden raw-output field.' }],
      unansweredPlanObligations: [],
      limitations: [],
    }),
  ).toThrow();
});

test('rejects canonical map states that make one obligation both mapped and unanswered', () => {
  expect(() =>
    EvidenceMapSchema.parse({
      facts: [
        {
          factId: 'fact-overlap-01',
          role: 'operation',
          evidence: [
            {
              path: 'reviewed.unknown',
              startLine: 1,
              contentDigest: 'a'.repeat(64),
              kind: 'source',
            },
          ],
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
        evidence: [
          {
            path: 'reviewed.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: ' SOURCE ',
          },
        ],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  expect(parsed.facts[0]).toMatchObject({ role: 'operation', evidence: [{ kind: 'source' }] });
});

test('turns a structurally incomplete model map fact into a counted rejection', async () => {
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
  const result = await verifyEvidenceMap(
    vector,
    candidate,
    sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
    ]),
  );
  expect(result).toMatchObject({ rejectedFactCount: 1, evidenceMap: { facts: [] } });
});

test('accepts only generic approved-obligation evidence-map repair signals', () => {
  const insufficiencies = EvidenceMapInsufficienciesSchema.parse([
    {
      obligationIds: ['test-obligation-01'],
      needs: ['operation-evidence-missing', 'source-relation-unresolved'],
    },
  ]);
  expect(verifyEvidenceMapInsufficiencies(vector, insufficiencies)).toEqual(insufficiencies);
  expect(evidenceMapInsufficiencySignature(insufficiencies)).toBe(
    '[{"obligationIds":["test-obligation-01"],"needs":["operation-evidence-missing","source-relation-unresolved"]}]',
  );
  expect(() =>
    EvidenceMapInsufficienciesSchema.parse([
      {
        obligationIds: ['test-obligation-01'],
        needs: ['operation-evidence-missing'],
        expectedLocation: 'reviewed.unknown:1',
      },
    ]),
  ).toThrow();
  expect(() =>
    verifyEvidenceMapInsufficiencies(vector, [
      { obligationIds: ['unapproved-obligation-01'], needs: ['control-coverage-missing'] },
    ]),
  ).toThrow('outside the approved vector');
});

test('appends validated neutral repair facts without replacing or weakening the existing map', async () => {
  const original = EvidenceMapSchema.parse({
    facts: [
      {
        factId: 'fact-existing-01',
        role: 'input',
        evidence: [
          {
            path: 'reviewed.unknown',
            startLine: 1,
            contentDigest: 'a'.repeat(64),
            kind: 'source',
          },
        ],
        planObligations: [{ obligationId: 'test-obligation-01' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: ['model-declared-limitation'],
  });
  const repaired = await applyEvidenceMapRepair({
    vector,
    evidenceMap: original,
    repair: UnverifiedEvidenceMapRepairSchema.parse({
      facts: [
        {
          factId: 'fact-operation-01',
          role: 'operation',
          statement: 'The reviewed source performs the selected operation.',
          evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
          planObligations: [{ obligationId: 'test-obligation-01' }],
        },
      ],
    }),
    sourceEvidence: sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
    ]),
  });
  expect(repaired).toMatchObject({
    appendedFactCount: 1,
    evidenceMap: {
      facts: [{ factId: 'fact-existing-01' }, { factId: 'fact-operation-01' }],
      limitations: ['model-declared-limitation'],
    },
  });
  await expect(
    applyEvidenceMapRepair({
      vector,
      evidenceMap: original,
      repair: {
        facts: [
          {
            factId: 'fact-existing-01',
            role: 'operation',
            statement: 'Replacement is forbidden.',
            evidence: [{ path: 'reviewed.unknown', startLine: 1 }],
            planObligations: [{ obligationId: 'test-obligation-01' }],
          },
        ],
      },
      sourceEvidence: sourceEvidenceFor([
        { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
      ]),
    }),
  ).rejects.toThrow('replace an existing neutral fact');
});

test('quarantines invalid model facts without discarding independent canonical facts', async () => {
  const result = await verifyEvidenceMap(
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
    sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
    ]),
  );

  expect(result.rejectedFactCount).toBe(1);
  expect(result.evidenceMap.facts).toMatchObject([
    {
      factId: 'fact-retained-01',
      evidence: [{}],
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

test('marks a map incomplete when an approved obligation is neither mapped nor unanswered', async () => {
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
  const result = await verifyEvidenceMap(
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
    sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
    ]),
  );
  expect(result.complete).toBe(false);
});

test('fails map completeness when a mapped control is omitted from the mapper control inventory', async () => {
  const result = await verifyEvidenceMap(
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
    sourceEvidenceFor([
      { path: 'reviewed.unknown', content: 'value = request.input;\n', languageHint: null },
    ]),
  );

  expect(result.complete).toBe(false);
});
