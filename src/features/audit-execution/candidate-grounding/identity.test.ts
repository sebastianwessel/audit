import { expect, test } from 'bun:test';

import type { EvidenceMap } from '../evidence-map/contract.js';
import { type HypothesisSeed, HypothesisSeedSchema } from '../investigation/contract.js';
import { CandidateGroundingOutputSchema, type UnverifiedGroundedCandidate } from './contract.js';
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
      statement: 'The scoped source reads the request-controlled value.',
      evidence: [
        {
          path: 'src/source.unknown',
          startLine: 1,
          snippet: 'value = request.input',
          kind: 'source',
        },
      ],
      planObligations: seed.planObligations,
    },
    {
      factId: 'fact-operation-01',
      role: 'operation',
      statement: 'The scoped source performs the reviewed operation.',
      evidence: [
        {
          path: 'src/source.unknown',
          startLine: 2,
          snippet: 'operation(value)',
          kind: 'source',
        },
      ],
      planObligations: seed.planObligations,
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
};

const candidate: UnverifiedGroundedCandidate = {
  vectorId: seed.vectorId,
  statement: 'Request-controlled operation',
  operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 0 },
  unsafeConditionEvidence: { factId: 'fact-origin-01', evidenceIndex: 0 },
  planObligations: seed.planObligations,
  evidenceMapFactIds: seed.evidenceMapFactIds,
  limitations: [],
};

test('projects candidate locations from selected evidence-map facts', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    { groundings: [{ seedId: seed.seedId, candidate }] },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 1, nullCount: 0, rejectedCount: 0 });
  expect(selected.candidates[0]?.evidence).toEqual([
    {
      path: 'src/source.unknown',
      startLine: 2,
      snippet: 'operation(value)',
      kind: 'source',
      role: 'operation',
    },
    {
      path: 'src/source.unknown',
      startLine: 1,
      snippet: 'value = request.input',
      kind: 'source',
      role: 'unsafe-condition',
    },
  ]);
});

test('does not let grounding replace or extend the discovery evidence basis', () => {
  for (const evidenceMapFactIds of [
    ['fact-operation-01'],
    [...seed.evidenceMapFactIds, 'fact-extra-01'],
    ['fact-origin-01', 'fact-origin-01'],
  ]) {
    const selected = selectSeedBoundGroundings(
      [seed],
      { groundings: [{ seedId: seed.seedId, candidate: { ...candidate, evidenceMapFactIds } }] },
      evidenceMap,
    );
    expect(selected).toMatchObject({ submittedCount: 0, nullCount: 0, rejectedCount: 1 });
  }
});

test('rejects duplicate model fact references before grounding selection', () => {
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [
        {
          seedId: seed.seedId,
          candidate: { ...candidate, evidenceMapFactIds: ['fact-origin-01', 'fact-origin-01'] },
        },
      ],
    }),
  ).toThrow('Evidence-map fact references must be unique');
  expect(() =>
    HypothesisSeedSchema.parse({
      ...seed,
      evidenceMapFactIds: ['fact-origin-01', 'fact-origin-01'],
    }),
  ).toThrow('Evidence-map fact references must be unique');
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
            operationEvidence: { factId: 'fact-unselected-01', evidenceIndex: 0 },
          },
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
            unsafeConditionEvidence: { factId: 'fact-origin-01', evidenceIndex: 1 },
          },
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
              snippet: `operation-${index + 1}(value)`,
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
            operationEvidence: { factId: 'fact-operation-01', evidenceIndex: 8 },
          },
        },
      ],
    },
    map,
  );
  expect(selected.candidates[0]?.evidence[0]?.startLine).toBe(10);
});

test('records an explicit null outcome for a seed without a complete candidate', () => {
  const selected = selectSeedBoundGroundings(
    [seed],
    { groundings: [{ seedId: seed.seedId, candidate: null }] },
    evidenceMap,
  );
  expect(selected).toMatchObject({ submittedCount: 0, nullCount: 1, rejectedCount: 0 });
});

test('creates a recovery-safe canonical null outcome without retaining the discovery seed', () => {
  const canonical = canonicalizeCandidateGroundingOutput({
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
    output: { groundings: [{ seedId: seed.seedId, candidate: null }] },
    evidenceMap,
    sourcePosture: { assessments: [], limitations: [] },
    sources: [],
  });
  expect(canonical).toEqual({
    groundings: [{ seedId: seed.seedId, disposition: 'null' }],
  });
  expect(selectCanonicalSeedBoundGroundings([seed], canonical)).toMatchObject({
    submittedCount: 0,
    nullCount: 1,
    rejectedCount: 0,
  });
});

test('rejects model-authored posture identifiers and carries the seed projection instead', () => {
  expect(() =>
    CandidateGroundingOutputSchema.parse({
      groundings: [
        {
          seedId: seed.seedId,
          candidate: { ...candidate, sourcePostureAssessmentIds: seed.sourcePostureAssessmentIds },
        },
      ],
    }),
  ).toThrow();
  const selected = selectSeedBoundGroundings(
    [seed],
    { groundings: [{ seedId: seed.seedId, candidate }] },
    evidenceMap,
  );
  expect(selected.candidates[0]?.sourcePostureAssessmentIds).toEqual(
    seed.sourcePostureAssessmentIds,
  );
});
