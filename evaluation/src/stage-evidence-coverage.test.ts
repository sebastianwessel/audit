import { expect, test } from 'bun:test';

import { SourceEvidenceSchema } from '../../src/features/attack-planning/index.js';
import { EvidenceMapSchema } from '../../src/features/audit-execution/evidence-map/contract.js';

import { loadCorpusPack } from './corpus.js';
import { stageEvidenceCoverage } from './stage-evidence-coverage.js';

test('locates expected evidence loss across mapping, grounding, and verification without persisting locations', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const answerKey = pack.cases.find(
    (loaded) => loaded.case.caseId === 'ossf-cve-2018-16492',
  )?.answerKey;
  if (answerKey === undefined) throw new Error('Expected pinned evaluator fixture.');
  const operation = SourceEvidenceSchema.parse({
    path: 'index.js',
    startLine: 77,
    endLine: 77,
    contentDigest: 'a'.repeat(64),
    kind: 'source',
    role: 'operation',
  });
  const unsafeCondition = SourceEvidenceSchema.parse({
    path: 'index.js',
    startLine: 57,
    endLine: 57,
    contentDigest: 'a'.repeat(64),
    kind: 'source',
    role: 'unsafe-condition',
  });
  const map = EvidenceMapSchema.parse({
    facts: [
      {
        factId: 'mapped-fact-01',
        role: 'operation',
        evidence: [{ ...operation, role: null }],
        planObligations: [{ obligationId: 'object-write-risk' }],
      },
      {
        factId: 'mapped-fact-02',
        role: 'operation',
        evidence: [{ ...unsafeCondition, role: null }],
        planObligations: [{ obligationId: 'object-write-risk' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });

  expect(
    stageEvidenceCoverage({
      answerKey,
      evidenceMaps: [map],
      groundedEvidence: [operation],
      verifiedEvidence: [operation, unsafeCondition],
    }),
  ).toEqual({
    expectedRoleCount: 2,
    mappedLocationCount: 2,
    groundedRoleCount: 1,
    verifiedRoleCount: 2,
    firstIncompleteStage: 'candidate-grounding',
  });
});

test('labels only the first observable expected-evidence loss', async () => {
  const pack = await loadCorpusPack('evaluation/data/corpora');
  const answerKey = pack.cases.find(
    (loaded) => loaded.case.caseId === 'ossf-cve-2018-16492',
  )?.answerKey;
  if (answerKey === undefined) throw new Error('Expected pinned evaluator fixture.');
  const operation = SourceEvidenceSchema.parse({
    path: 'index.js',
    startLine: 77,
    endLine: 77,
    contentDigest: 'a'.repeat(64),
    kind: 'source',
    role: 'operation',
  });
  const unsafeCondition = SourceEvidenceSchema.parse({
    ...operation,
    startLine: 57,
    endLine: 57,
    role: 'unsafe-condition',
  });
  const map = EvidenceMapSchema.parse({
    facts: [
      {
        factId: 'mapped-fact-01',
        role: 'operation',
        evidence: [{ ...operation, role: null }],
        planObligations: [{ obligationId: 'object-write-risk' }],
      },
      {
        factId: 'mapped-fact-02',
        role: 'operation',
        evidence: [{ ...unsafeCondition, role: null }],
        planObligations: [{ obligationId: 'object-write-risk' }],
      },
    ],
    unansweredPlanObligations: [],
    limitations: [],
  });
  const base = {
    answerKey,
    evidenceMaps: [map],
    groundedEvidence: [operation, unsafeCondition],
  };

  expect(
    stageEvidenceCoverage({ ...base, evidenceMaps: [], verifiedEvidence: [] }).firstIncompleteStage,
  ).toBe('evidence-mapping');
  expect(
    stageEvidenceCoverage({ ...base, verifiedEvidence: [operation] }).firstIncompleteStage,
  ).toBe('verification');
  expect(
    stageEvidenceCoverage({ ...base, verifiedEvidence: [operation, unsafeCondition] })
      .firstIncompleteStage,
  ).toBe('complete');
  expect(
    stageEvidenceCoverage({
      ...base,
      answerKey: { ...answerKey, staticReviewApplicable: false },
      verifiedEvidence: [],
    }).firstIncompleteStage,
  ).toBe('not-applicable');
});
