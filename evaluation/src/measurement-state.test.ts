import { expect, test } from 'bun:test';

import { deriveEvaluationMeasurementState } from './measurement-state.js';

test('derives generated-plan measurement state only from persisted trial terminals', () => {
  expect(
    deriveEvaluationMeasurementState({
      planProfile: 'planning-generated',
      trials: [
        {
          status: 'completed',
          semanticPlanMeasurement: { status: 'completed' },
        },
        {
          status: 'completed',
          semanticPlanMeasurement: { status: 'completed' },
        },
      ],
    }),
  ).toEqual({ workflow: 'complete', semanticPlan: 'complete', finding: 'not-applicable' });

  expect(
    deriveEvaluationMeasurementState({
      planProfile: 'end-to-end-generated',
      trials: [
        {
          status: 'incomplete',
          semanticPlanMeasurement: { status: 'not-reached' },
        },
      ],
    }),
  ).toEqual({ workflow: 'incomplete', semanticPlan: 'incomplete', finding: 'incomplete' });

  expect(
    deriveEvaluationMeasurementState({
      planProfile: 'audit-reviewed-plan',
      trials: [{ status: 'completed', semanticPlanMeasurement: { status: 'not-applicable' } }],
    }),
  ).toEqual({ workflow: 'complete', semanticPlan: 'not-applicable', finding: 'complete' });
});
