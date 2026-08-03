import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  modelTokenSchema,
} from '../../../shared/contracts/core.js';
import { PlanObligationReferenceSchema } from '../../attack-planning/plan.schema.js';
import {
  EvidenceMapFactIdsSchema,
  UnverifiedEvidenceMapFactIdsSchema,
} from '../evidence-map/contract.js';

/** A candidate-blind model judgment about one approved risk-positive obligation. */
export const SourcePostureConclusionSchema = modelTokenSchema(
  z.enum(['risk-supported', 'risk-contradicted', 'inconclusive', 'not-applicable']),
);

export const SourcePostureAssessmentSchema = z
  .strictObject({
    assessmentId: IdentifierSchema,
    obligationId: PlanObligationReferenceSchema.shape.obligationId,
    conclusion: SourcePostureConclusionSchema,
    evidenceMapFactIds: EvidenceMapFactIdsSchema,
    notApplicableReason: BoundedTextSchema.min(1).nullable().optional(),
    limitations: z.array(BoundedTextSchema.min(1)),
  })
  .superRefine((assessment, context) => {
    const requiresReason = assessment.conclusion === 'not-applicable';
    if (
      requiresReason !==
      (assessment.notApplicableReason !== undefined && assessment.notApplicableReason !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['notApplicableReason'],
        message: 'Only a not-applicable assessment carries a required reason.',
      });
    }
  });

export const UnverifiedSourcePostureAssessmentSchema = SourcePostureAssessmentSchema.safeExtend({
  assessmentId: z.string().trim().min(1).max(160),
  evidenceMapFactIds: UnverifiedEvidenceMapFactIdsSchema,
});

const SourcePostureEnvelopeFields = {
  limitations: z.array(BoundedTextSchema.min(1)),
};

function uniqueAssessments(
  assessments: readonly { assessmentId: string; obligationId: string }[],
  context: z.RefinementCtx,
): void {
  const identifiers = assessments.map((assessment) => assessment.assessmentId);
  if (new Set(identifiers).size !== identifiers.length) {
    context.addIssue({
      code: 'custom',
      path: ['assessments'],
      message: 'Source-posture assessment identifiers must be unique.',
    });
  }
  const obligations = assessments.map((assessment) => assessment.obligationId);
  if (new Set(obligations).size !== obligations.length) {
    context.addIssue({
      code: 'custom',
      path: ['assessments'],
      message: 'Source posture must contain at most one assessment per plan obligation.',
    });
  }
}

export const SourcePostureSchema = z
  .strictObject({
    assessments: z.array(SourcePostureAssessmentSchema),
    ...SourcePostureEnvelopeFields,
  })
  .superRefine((value, context) => uniqueAssessments(value.assessments, context));

export const UnverifiedSourcePostureSchema = z
  .strictObject({
    assessments: z.array(UnverifiedSourcePostureAssessmentSchema),
    ...SourcePostureEnvelopeFields,
  })
  .superRefine((value, context) => uniqueAssessments(value.assessments, context));

/** Canonical posture-reference collection for an investigator candidate. */
export const SourcePostureAssessmentIdsSchema = z.array(IdentifierSchema).min(1);

export const UnverifiedSourcePostureAssessmentIdsSchema = z
  .array(z.string().trim().min(1).max(160))
  .min(1);

export type SourcePosture = z.infer<typeof SourcePostureSchema>;
export type SourcePostureAssessment = z.infer<typeof SourcePostureAssessmentSchema>;
export type SourcePostureAssessmentIds = z.infer<typeof SourcePostureAssessmentIdsSchema>;
export type UnverifiedSourcePosture = z.infer<typeof UnverifiedSourcePostureSchema>;
