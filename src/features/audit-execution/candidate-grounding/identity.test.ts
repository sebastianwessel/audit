import { expect, test } from 'bun:test';
import { createSourceSnapshot } from '../../target-inventory/source-snapshot.js';
import type { EvidenceMap } from '../evidence-map/contract.js';
import { type HypothesisSeed, HypothesisSeedSchema } from '../investigation/contract.js';
import { createSourceEvidenceResolver } from '../source-evidence-resolver.js';
import {
  type CandidateGroundingModelCandidate,
  CandidateGroundingOutputSchema,
} from './contract.js';
import {
  canonicalizeCandidateGroundingOutput,
  selectCanonicalSeedBoundGroundings,
  selectSeedBoundGroundings,
} from './identity.js';

const seed: HypothesisSeed = {
  seedId: 'seed-grounding-01',
  vectorId: 'vector-grounding-01',
  hypothesis: 'Request-controlled input may reach an unsafe operation.',
  planObligations: [{ obligationId: 'grounding-obligation-01' }],
  evidenceMapFactIds: ['fact-origin-01', 'fact-operation-01'],
  sourcePostureAssessmentIds: ['posture-grounding-01'],
  limitations: [],
};

const evidenceMap: EvidenceMap = {
  facts: [
    {
      factId: 'fact-origin-01',
      role: 'input',
      evidence: [
        {
          path: 'src/source.unknown',
          startLine: 1,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: seed.planObligations,
    },
    {
      factId: 'fact-operation-01',
      role: 'operation',
      evidence: [
        {
          path: 'src/source.unknown',
          startLine: 2,
          contentDigest: 'a'.repeat(64),
          kind: 'source',
        },
      ],
      planObligations: seed.planObligations,
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
};

const candidate: CandidateGroundingModelCandidate = {
  statement: 'Request-controlled operation',
  claimEvidenceBundles: [
    {
      role: 'operation',
      explanation: 'The selected operation fact supports this role.',
      selections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
    },
    {
      role: 'unsafe-condition',
      explanation: 'The selected input fact supports this role.',
      selections: [{ factId: 'fact-origin-01', evidenceIndex: 0 }],
    },
  ],
};

function candidateBundle(role: 'operation' | 'unsafe-condition') {
  const bundle = candidate.claimEvidenceBundles.find((item) => item.role === role);
  if (bundle === undefined) throw new Error(`Missing ${role} test bundle.`);
  return bundle;
}

function sourceEvidenceFor(
  sources: readonly { path: string; content: string; languageHint: string | null }[],
) {
  return createSourceEvidenceResolver({
    sourceSnapshot: createSourceSnapshot(sources),
    sourcePaths: sources.map((source) => source.path),
  });
}

test('projects candidate locations from selected evidence-map facts', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    { groundings: [{ seedId: seed.seedId, candidate, nullReason: null }] },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 1, nullCount: 0, rejectedCount: 0 });
  expect(selected.candidates[0]?.claimEvidenceBundles).toMatchObject([
    {
      role: 'operation',
      evidence: [{ startLine: 2, role: 'operation' }],
    },
    {
      role: 'unsafe-condition',
      evidence: [{ startLine: 1, role: 'unsafe-condition' }],
    },
  ]);
});

test('derives discovery references and rejects model selections outside the approved map basis', () => {
  for (const factId of ['fact-extra-01', 'fact-unrelated-01']) {
    const selected = selectSeedBoundGroundings(
      [seed],
      {
        groundings: [
          {
            seedId: seed.seedId,
            candidate: {
              ...candidate,
              claimEvidenceBundles: [
                {
                  ...candidateBundle('operation'),
                  selections: [{ factId, evidenceIndex: 0 }],
                },
                candidateBundle('unsafe-condition'),
              ],
            },
            nullReason: null,
          },
        ],
      },
      evidenceMap,
    );
    expect(selected).toMatchObject({ submittedCount: 0, nullCount: 0, rejectedCount: 1 });
  }
});

test('allows grounding to add a validated same-obligation map fact to complete a role', () => {
  const mapWithConditionFact: EvidenceMap = {
    ...evidenceMap,
    facts: [
      ...evidenceMap.facts,
      {
        factId: 'fact-condition-01',
        role: 'boundary',
        evidence: [
          {
            path: 'src/source.unknown',
            startLine: 3,
            contentDigest: 'b'.repeat(64),
            kind: 'source',
          },
        ],
        planObligations: seed.planObligations,
      },
    ],
  };
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              candidateBundle('operation'),
              {
                role: 'unsafe-condition',
                explanation:
                  'The inherited input remains provenance and the condition fact establishes the unsafe boundary.',
                selections: [
                  { factId: 'fact-origin-01', evidenceIndex: 0 },
                  { factId: 'fact-condition-01', evidenceIndex: 0 },
                ],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    mapWithConditionFact,
  );
  expect(selected).toMatchObject({ submittedCount: 1, nullCount: 0, rejectedCount: 0 });
  expect(selected.candidates[0]?.claimEvidenceBundles[1]?.evidence).toMatchObject([
    { startLine: 1, role: 'unsafe-condition' },
    { startLine: 3, role: 'unsafe-condition' },
  ]);
});

test('lets grounding independently select either valid role evidence location from its map basis', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              candidateBundle('operation'),
              {
                role: 'unsafe-condition',
                explanation: 'The operation is reused for a different role.',
                selections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 1, nullCount: 0, rejectedCount: 0 });
});

test('allows one grounding selection to establish both independently selected roles', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              candidateBundle('operation'),
              {
                role: 'unsafe-condition',
                explanation: 'The selected operation also establishes the unsafe condition.',
                selections: [{ factId: 'fact-operation-01', evidenceIndex: 0 }],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 1, nullCount: 0, rejectedCount: 0 });
});

test('allows grounding to add missing role evidence from the seed-owned map basis', () => {
  const mapWithAdditionalConditionEvidence: EvidenceMap = {
    ...evidenceMap,
    facts: evidenceMap.facts.map((fact) =>
      fact.factId !== 'fact-operation-01'
        ? fact
        : {
            ...fact,
            evidence: [
              ...fact.evidence,
              {
                path: 'src/source.unknown',
                startLine: 3,
                contentDigest: 'b'.repeat(64),
                kind: 'source' as const,
              },
            ],
          },
    ),
  };
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              candidateBundle('operation'),
              {
                role: 'unsafe-condition',
                explanation:
                  'The inherited input remains provenance and the additional source location establishes the condition.',
                selections: [
                  { factId: 'fact-origin-01', evidenceIndex: 0 },
                  { factId: 'fact-operation-01', evidenceIndex: 1 },
                ],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    mapWithAdditionalConditionEvidence,
  );
  expect(selected).toMatchObject({ submittedCount: 1, nullCount: 0, rejectedCount: 0 });
  expect(selected.candidates[0]?.claimEvidenceBundles[1]?.evidence).toMatchObject([
    { startLine: 1, role: 'unsafe-condition' },
    { startLine: 3, role: 'unsafe-condition' },
  ]);
});

test('derives a duplicate-free fact basis from model evidence selections', () => {
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              candidateBundle('operation'),
              {
                role: 'unsafe-condition',
                explanation: 'The same map evidence can support this distinct role.',
                selections: [{ factId: 'fact-origin-01', evidenceIndex: 0 }],
              },
            ],
          },
          nullReason: null,
        },
      ],
    }),
  ).not.toThrow();
  expect(() =>
    HypothesisSeedSchema.parse({
      ...seed,
      evidenceMapFactIds: ['fact-origin-01', 'fact-origin-01'],
    }),
  ).toThrow('Evidence-map fact references must be unique');
});

test('rejects retired singleton evidence fields instead of silently treating them as a bundle', () => {
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            statement: candidate.statement,
            operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
            unsafeConditionEvidence: { factId: 'fact-origin-01', evidenceIndex: 0 },
          },
          nullReason: null,
        },
      ],
    }),
  ).toThrow();
});

test('rejects a source-location selection outside the candidate map basis', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              {
                role: 'operation',
                explanation: 'Outside the approved basis.',
                selections: [{ factId: 'fact-unselected-01', evidenceIndex: 0 }],
              },
              candidateBundle('unsafe-condition'),
            ],
          },
          nullReason: null,
        },
      ],
    },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 0, nullCount: 0, rejectedCount: 1 });
});

test('rejects an out-of-range map evidence selection', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              candidateBundle('operation'),
              {
                role: 'unsafe-condition',
                explanation: 'Outside the available evidence range.',
                selections: [{ factId: 'fact-origin-01', evidenceIndex: 1 }],
              },
            ],
          },
          nullReason: null,
        },
      ],
    },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 0, nullCount: 0, rejectedCount: 1 });
});

test('projects an evidence location beyond the retired fixed selection ceiling', () => {
  const map: EvidenceMap = {
    ...evidenceMap,
    facts: evidenceMap.facts.map((fact) =>
      fact.factId !== 'fact-operation-01'
        ? fact
        : {
            ...fact,
            evidence: Array.from({ length: 9 }, (_, index) => ({
              path: 'src/source.unknown',
              startLine: index + 2,
              contentDigest: 'a'.repeat(64),
              kind: 'source' as const,
            })),
          },
    ),
  };
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: {
            ...candidate,
            claimEvidenceBundles: [
              {
                role: 'operation',
                explanation: 'The ninth evidence item is selected.',
                selections: [{ factId: 'fact-operation-01', evidenceIndex: 8 }],
              },
              candidateBundle('unsafe-condition'),
            ],
          },
          nullReason: null,
        },
      ],
    },
    map,
  );
  expect(selected.candidates[0]?.claimEvidenceBundles[0]?.evidence[0]?.startLine).toBe(10);
});

test('records an explicit null outcome for a seed without a complete candidate', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: null,
          nullReason: 'no-source-backed-candidate',
        },
      ],
    },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 0, nullCount: 1, rejectedCount: 0 });
});

test('creates a recovery-safe canonical null outcome without retaining the discovery seed', async () => {
  const canonical = await canonicalizeCandidateGroundingOutput({
    vector: {
      vectorId: seed.vectorId,
      vectorDigest: 'a'.repeat(64),
      title: 'Grounding fixture',
      rationale: 'Fixture',
      enabled: true,
      scopeGlobs: ['src/**'],
      reviewObligations: [
        {
          obligationId: seed.planObligations[0]?.obligationId ?? 'grounding-obligation-01',
          riskStatement: 'Fixture risk.',
          evidenceRequirement: 'Fixture evidence.',
        },
      ],
      limitations: [],
    },
    seeds: [seed],
    output: {
      groundings: [
        {
          seedId: seed.seedId,
          candidate: null,
          nullReason: 'no-source-backed-candidate',
        },
      ],
    },
    evidenceMap,
    sourcePosture: { assessments: [], limitations: [] },
    sourceEvidence: sourceEvidenceFor([]),
  });
  expect(canonical).toEqual({
    groundings: [{ seedId: seed.seedId, disposition: 'no-source-backed-candidate' }],
  });
  expect(selectCanonicalSeedBoundGroundings([seed], canonical)).toMatchObject({
    submittedCount: 0,
    nullCount: 1,
    rejectedCount: 0,
  });
});

test('preserves the closed map-insufficient disposition across the durable boundary', async () => {
  const canonical = await canonicalizeCandidateGroundingOutput({
    vector: {
      vectorId: seed.vectorId,
      vectorDigest: 'a'.repeat(64),
      title: 'Grounding fixture',
      rationale: 'Fixture',
      enabled: true,
      scopeGlobs: ['src/**'],
      reviewObligations: [
        {
          obligationId: seed.planObligations[0]?.obligationId ?? 'grounding-obligation-01',
          riskStatement: 'Fixture risk.',
          evidenceRequirement: 'Fixture evidence.',
        },
      ],
      limitations: [],
    },
    seeds: [seed],
    output: {
      groundings: [{ seedId: seed.seedId, candidate: null, nullReason: 'map-insufficient' }],
      mapInsufficiencies: [
        {
          obligationIds: ['grounding-obligation-01'],
          needs: ['source-relation-unresolved'],
        },
      ],
    },
    evidenceMap,
    sourcePosture: { assessments: [], limitations: [] },
    sourceEvidence: sourceEvidenceFor([]),
  });
  expect(canonical.groundings).toEqual([{ seedId: seed.seedId, disposition: 'map-insufficient' }]);
});

test('requires every raw null to explain whether map repair is required', () => {
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [{ seedId: seed.seedId, candidate: null }],
    }),
  ).toThrow();
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [{ seedId: seed.seedId, candidate: null, nullReason: null }],
    }),
  ).toThrow();
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [
        {
          seedId: seed.seedId,
          candidate,
          nullReason: 'no-source-backed-candidate',
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [{ seedId: seed.seedId, candidate: null, nullReason: 'map-insufficient' }],
      mapInsufficiencies: [],
    }),
  ).toThrow('must declare at least one generic map insufficiency');
  expect(
    CandidateGroundingOutputSchema.parse({
      groundings: [{ seedId: seed.seedId, candidate: null, nullReason: 'map-insufficient' }],
      mapInsufficiencies: [
        {
          obligationIds: [seed.planObligations[0]?.obligationId ?? 'grounding-obligation-01'],
          needs: ['source-relation-unresolved'],
        },
      ],
    }),
  ).toMatchObject({ groundings: [{ nullReason: 'map-insufficient' }] });
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [
        {
          seedId: seed.seedId,
          candidate: null,
          nullReason: 'no-source-backed-candidate',
        },
      ],
      mapInsufficiencies: [
        {
          obligationIds: [seed.planObligations[0]?.obligationId ?? 'grounding-obligation-01'],
          needs: ['source-relation-unresolved'],
        },
      ],
    }),
  ).toThrow('Only a map-insufficient grounding may request candidate-blind map repair');
});

test('rejects model-authored posture identifiers and carries the seed projection instead', () => {
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [
        {
          seedId: seed.seedId,
          candidate: { ...candidate, sourcePostureAssessmentIds: seed.sourcePostureAssessmentIds },
          nullReason: null,
        },
      ],
    }),
  ).toThrow();
  const selected = selectSeedBoundGroundings(
    [seed],
    { groundings: [{ seedId: seed.seedId, candidate, nullReason: null }] },
    evidenceMap,
  );
  expect(selected.candidates[0]?.sourcePostureAssessmentIds).toEqual(
    seed.sourcePostureAssessmentIds,
  );
});

test('retains only the validated redacted candidate narrative in the canonical grounded hypothesis', async () => {
  const canonical = await canonicalizeCandidateGroundingOutput({
    vector: {
      vectorId: seed.vectorId,
      vectorDigest: 'a'.repeat(64),
      title: 'Grounding fixture',
      rationale: 'Fixture',
      enabled: true,
      scopeGlobs: ['src/**'],
      reviewObligations: [
        {
          obligationId: 'grounding-obligation-01',
          riskStatement: 'Fixture risk.',
          evidenceRequirement: 'Fixture evidence.',
        },
      ],
      limitations: [],
    },
    seeds: [seed],
    output: {
      groundings: [{ seedId: seed.seedId, candidate, nullReason: null }],
    },
    evidenceMap,
    sourcePosture: {
      assessments: [
        {
          assessmentId: 'posture-grounding-01',
          obligationId: 'grounding-obligation-01',
          conclusion: 'inconclusive',
          evidenceMapFactIds: seed.evidenceMapFactIds,
          limitations: [],
        },
      ],
      limitations: [],
    },
    sourceEvidence: sourceEvidenceFor([
      {
        path: 'src/source.unknown',
        content: 'input\noperation',
        languageHint: null,
      },
    ]),
  });
  expect(canonical.groundings[0]).toMatchObject({ disposition: 'grounded' });
  expect(JSON.stringify(canonical)).toContain('Request-controlled operation');
  expect(JSON.stringify(canonical)).toContain('supports this role');
});
