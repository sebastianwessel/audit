import { describe, expect, test } from 'bun:test';

import { createPlan } from './plan.js';
import { createAttackPlanDraft, resealAttackPlanDraft } from './plan-authoring.js';

function createFixturePlan() {
  return createPlan({
    targetFingerprint: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    targetDisplayName: 'fixture',
    inventorySummary: { fileCount: 2, totalBytes: 8, languageHints: [] },
    createdAt: '2026-08-03T12:00:00.000Z',
    vectors: [
      {
        title: 'Review authorization boundaries',
        rationale: 'Authorization must remain enforced at each protected boundary.',
        enabled: true,
        scopeGlobs: ['src/**'],
        reviewObligations: [
          {
            obligationId: 'authorization-boundary-01',
            riskStatement: 'A caller may reach protected data without authorization.',
            evidenceRequirement: 'Source evidence shows the protected operation and its control.',
          },
        ],
        limitations: [],
      },
    ],
    additionalObservations: [
      {
        observationId: 'review-session-boundary',
        title: 'Review session-boundary propagation',
        rationale: 'A human may choose to extend the plan to the session boundary.',
        scopeGlobs: ['src/session/**'],
        reviewObligations: [
          {
            obligationId: 'session-boundary-01',
            riskStatement: 'A session boundary may not preserve the expected caller identity.',
            evidenceRequirement:
              'Source evidence identifies session creation and identity propagation.',
          },
        ],
        limitations: [],
      },
    ],
  });
}

describe('plan authoring lifecycle', () => {
  test('reseals a changed editable draft while preserving immutable base metadata', () => {
    const basePlan = createFixturePlan();
    const draft = createAttackPlanDraft(basePlan);
    const firstVector = draft.vectors[0];
    if (firstVector === undefined) throw new Error('Fixture requires one editable vector.');
    const editedDraft = {
      ...draft,
      vectors: [{ ...firstVector, scopeGlobs: ['src/private/**'] }],
    };

    const resealed = resealAttackPlanDraft({ basePlan, draft: editedDraft });

    expect(resealed.planId).not.toBe(basePlan.planId);
    expect(resealed.vectors[0]?.vectorId).not.toBe(basePlan.vectors[0]?.vectorId);
    expect(resealed.targetFingerprint).toBe(basePlan.targetFingerprint);
    expect(resealed.contextDigest).toBe(basePlan.contextDigest);
    expect(resealed.inventorySummary).toEqual(basePlan.inventorySummary);
  });

  test('rejects a draft bound to another sealed plan', () => {
    const basePlan = createFixturePlan();
    const draft = createAttackPlanDraft(basePlan);
    expect(() =>
      resealAttackPlanDraft({
        basePlan,
        draft: { ...draft, basePlanDigest: 'c'.repeat(64) },
      }),
    ).toThrow('not bound');
  });

  test('rejects a draft that does not change executable plan content', () => {
    const basePlan = createFixturePlan();
    expect(() =>
      resealAttackPlanDraft({ basePlan, draft: createAttackPlanDraft(basePlan) }),
    ).toThrow('does not change');
  });

  test('promotes one additional observation into executable human-approved work', () => {
    const basePlan = createFixturePlan();
    const draft = createAttackPlanDraft(basePlan);
    const resealed = resealAttackPlanDraft({
      basePlan,
      draft: { ...draft, promotedObservationIds: ['review-session-boundary'] },
    });

    expect(resealed.vectors.map((vector) => vector.title)).toContain(
      'Review session-boundary propagation',
    );
    expect(resealed.additionalObservations).toEqual([]);
  });
});
