import { expect, test } from 'bun:test';

import type { ProposedFinding } from '../../attack-planning/plan.schema.js';
import { AttackVectorSchema } from '../../attack-planning/plan.schema.js';
import { EvidenceMapSchema } from '../evidence-map/contract.js';
import { SourcePostureSchema } from '../source-posture/contract.js';

import { deriveObligationClosureMatrix, hasCompleteObligationClosure } from './derive.js';

const vector = AttackVectorSchema.parse({
  vectorId: 'vector-closure-01',
  vectorDigest: 'a'.repeat(64),
  title: 'Close the bounded review',
  rationale: 'A language-neutral source review needs an explicit terminal account.',
  enabled: true,
  scopeGlobs: ['source.unknown'],
  reviewObligations: [
    {
      obligationId: 'closure-obligation-01',
      riskStatement: 'The bounded source risk may be present.',
      evidenceRequirement: 'The bounded review has a visible terminal state.',
    },
  ],
  limitations: [],
});

const evidenceMap = EvidenceMapSchema.parse({
  facts: [
    {
      factId: 'closure-fact-01',
      role: 'operation',
      statement: 'The bounded source contains the reviewed operation.',
      evidence: [{ path: 'source.unknown', startLine: 1, snippet: 'operation', kind: 'source' }],
      planObligations: [{ obligationId: 'closure-obligation-01' }],
    },
  ],
  unansweredPlanObligations: [],
  limitations: [],
});

const sourcePosture = SourcePostureSchema.parse({
  assessments: [
    {
      assessmentId: 'closure-posture-01',
      obligationId: 'closure-obligation-01',
      conclusion: 'inconclusive',
      evidenceMapFactIds: ['closure-fact-01'],
      limitations: [],
    },
  ],
  limitations: [],
});

test('keeps a complete no-candidate review distinct from a safety conclusion', () => {
  const matrix = deriveObligationClosureMatrix({
    vector,
    evidenceMap,
    sourcePosture,
    investigationClosures: [
      {
        planObligation: { obligationId: 'closure-obligation-01' },
        disposition: 'no-source-backed-candidate',
        evidenceMapFactIds: ['closure-fact-01'],
        sourcePostureAssessmentIds: ['closure-posture-01'],
        limitations: [],
      },
    ],
  });

  expect(matrix).toMatchObject([
    {
      obligationId: 'closure-obligation-01',
      terminalDisposition: 'no-source-backed-candidate',
    },
  ]);
  expect(hasCompleteObligationClosure(matrix)).toBe(true);
});

test('keeps a source-backed not-applicable obligation neutral with its reason', () => {
  const notApplicablePosture = SourcePostureSchema.parse({
    assessments: [
      {
        assessmentId: 'closure-posture-01',
        obligationId: 'closure-obligation-01',
        conclusion: 'not-applicable',
        evidenceMapFactIds: ['closure-fact-01'],
        notApplicableReason:
          'The scoped code has no feature that accepts the business capability under review.',
        limitations: [],
      },
    ],
    limitations: [],
  });
  const matrix = deriveObligationClosureMatrix({
    vector,
    evidenceMap,
    sourcePosture: notApplicablePosture,
    investigationClosures: [
      {
        planObligation: { obligationId: 'closure-obligation-01' },
        disposition: 'not-applicable',
        evidenceMapFactIds: ['closure-fact-01'],
        sourcePostureAssessmentIds: ['closure-posture-01'],
        limitations: ['The supplied applicability reason is retained.'],
      },
    ],
  });

  expect(matrix[0]).toMatchObject({
    terminalDisposition: 'not-applicable',
    notApplicableReason:
      'The scoped code has no feature that accepts the business capability under review.',
  });
  expect(hasCompleteObligationClosure(matrix)).toBe(true);
});

test('fails closed when an investigator raises no candidate for its declared obligation', () => {
  const matrix = deriveObligationClosureMatrix({
    vector,
    evidenceMap,
    sourcePosture,
    investigationClosures: [
      {
        planObligation: { obligationId: 'closure-obligation-01' },
        disposition: 'candidate-raised',
        evidenceMapFactIds: ['closure-fact-01'],
        sourcePostureAssessmentIds: ['closure-posture-01'],
        limitations: [],
      },
    ],
  });

  expect(matrix[0]?.terminalDisposition).toBe('incomplete');
  expect(hasCompleteObligationClosure(matrix)).toBe(false);
});

test('keeps verifier-incomplete candidate work visible as incomplete coverage', () => {
  const candidate: ProposedFinding = {
    vectorId: vector.vectorId,
    statement: 'Bounded candidate',
    evidence: [
      {
        path: 'source.unknown',
        startLine: 1,
        endLine: 1,
        snippet: 'operation',
        kind: 'source',
        role: 'operation',
      },
    ],
    planObligations: [{ obligationId: 'closure-obligation-01' }],
    limitations: [],
  };
  const matrix = deriveObligationClosureMatrix({
    vector,
    evidenceMap,
    sourcePosture,
    investigationClosures: [
      {
        planObligation: { obligationId: 'closure-obligation-01' },
        disposition: 'candidate-raised',
        evidenceMapFactIds: ['closure-fact-01'],
        sourcePostureAssessmentIds: ['closure-posture-01'],
        limitations: [],
      },
    ],
    candidates: [candidate],
    incompleteCandidates: [candidate],
  });

  expect(matrix[0]?.terminalDisposition).toBe('incomplete');
  expect(hasCompleteObligationClosure(matrix)).toBe(false);
});
