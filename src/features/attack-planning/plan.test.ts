import { describe, expect, test } from 'bun:test';

import {
  assertPlanIsSealed,
  assertPlanMatchesTarget,
  createPlan as createExecutablePlan,
  resealPlan,
} from './plan.js';

const fingerprint = 'a'.repeat(64);
const digest = 'b'.repeat(64);

function createPlan() {
  return createExecutablePlan({
    targetFingerprint: fingerprint,
    contextDigest: digest,
    targetDisplayName: 'demo',
    inventorySummary: { fileCount: 1, totalBytes: 4, languageHints: ['typescript'] },
    createdAt: '2026-07-27T12:00:00.000Z',
    vectors: [
      {
        title: 'Review injection',
        rationale: 'Check query construction.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'plan-obligation-01',
            riskStatement: 'User input may reach a query without parameterization.',
            evidenceRequirement: 'The review identifies source-backed unsafe interpolation.',
          },
        ],
        limitations: [],
      },
    ],
  });
}

function draftVector(scopeGlobs: string[]) {
  return {
    title: 'Review injection',
    rationale: 'Check query construction.',
    enabled: true,
    scopeGlobs,
    reviewObligations: [
      {
        obligationId: 'plan-obligation-01',
        riskStatement: 'User input may reach a query without parameterization.',
        evidenceRequirement: 'The review identifies source-backed unsafe interpolation.',
      },
    ],
    limitations: [],
  };
}

describe('plan lifecycle', () => {
  test('creates deterministic executable identifiers', () => {
    const first = createPlan();
    const second = createPlan();
    expect(first.planId).toBe(second.planId);
    expect(first.vectors[0]?.vectorId).toBe(second.vectors[0]?.vectorId);
    expect(first.planDigest).toBe(second.planDigest);
    expect(first.vectors[0]?.vectorDigest).toBe(second.vectors[0]?.vectorDigest);
  });

  test('changes sealed vector and plan identity when a behavior field changes', () => {
    const original = createPlan();
    const changed = createExecutablePlan({
      targetFingerprint: fingerprint,
      contextDigest: digest,
      targetDisplayName: 'demo',
      inventorySummary: { fileCount: 1, totalBytes: 4, languageHints: ['typescript'] },
      createdAt: '2026-07-27T12:00:00.000Z',
      vectors: [draftVector(['src/private/**'])],
    });
    expect(changed.planId).not.toBe(original.planId);
    expect(changed.vectors[0]?.vectorId).not.toBe(original.vectors[0]?.vectorId);
  });

  test('does not change sealed identity for presentation-only metadata', () => {
    const original = createPlan();
    const changedMetadata = createExecutablePlan({
      targetFingerprint: fingerprint,
      contextDigest: digest,
      targetDisplayName: 'renamed display label',
      inventorySummary: { fileCount: 9, totalBytes: 99, languageHints: ['unknown'] },
      createdAt: '2026-08-01T12:00:00.000Z',
      vectors: [draftVector(['src/**'])],
    });
    expect(changedMetadata.planId).toBe(original.planId);
    expect(changedMetadata.planDigest).toBe(original.planDigest);
  });

  test('normalizes persistable plan text before deriving a sealed identity', () => {
    const withSensitiveLiteral = createExecutablePlan({
      targetFingerprint: fingerprint,
      contextDigest: digest,
      targetDisplayName: 'demo',
      inventorySummary: { fileCount: 1, totalBytes: 4, languageHints: ['typescript'] },
      createdAt: '2026-07-27T12:00:00.000Z',
      vectors: [
        {
          ...draftVector(['src/**']),
          rationale: 'password = "fixture-secret"',
        },
      ],
    });
    const withRedactedLiteral = createExecutablePlan({
      targetFingerprint: fingerprint,
      contextDigest: digest,
      targetDisplayName: 'demo',
      inventorySummary: { fileCount: 1, totalBytes: 4, languageHints: ['typescript'] },
      createdAt: '2026-07-27T12:00:00.000Z',
      vectors: [
        {
          ...draftVector(['src/**']),
          rationale: 'password = [REDACTED_SECRET]',
        },
      ],
    });

    expect(JSON.stringify(withSensitiveLiteral)).not.toContain('fixture-secret');
    expect(withSensitiveLiteral.vectors[0]?.rationale).toBe('password = [REDACTED_SECRET]');
    expect(withSensitiveLiteral.planId).toBe(withRedactedLiteral.planId);
    expect(() => assertPlanIsSealed(withSensitiveLiteral)).not.toThrow();
  });

  test('requires a matching target and context', () => {
    const plan = createPlan();
    expect(() => assertPlanMatchesTarget(plan, fingerprint, digest)).not.toThrow();
    expect(() => assertPlanMatchesTarget(plan, 'c'.repeat(64), digest)).toThrow('does not match');
  });

  test('rejects edited sealed content until it is deliberately resealed', () => {
    const original = createPlan();
    const originalVector = original.vectors[0];
    if (originalVector === undefined) throw new Error('Fixture requires one vector.');
    const edited = {
      ...original,
      vectors: [
        {
          ...originalVector,
          scopeGlobs: ['src/private/**'],
        },
      ],
    };

    expect(() => assertPlanIsSealed(edited)).toThrow('edited without being resealed');
    expect(resealPlan(edited).vectors[0]?.scopeGlobs).toEqual(['src/private/**']);
    expect(() => assertPlanIsSealed(resealPlan(edited))).not.toThrow();
  });
});
