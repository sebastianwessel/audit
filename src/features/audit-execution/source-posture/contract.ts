import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  modelTokenSchema,
} from '../../../shared/contracts/core.js';
import { PlanObligationReferenceSchema } from '../../attack-planning/plan/index.js';
import {
  EvidenceMapFactIdsSchema,
  UnverifiedEvidenceMapFactIdsSchema,
} from '../evidence-map/contract.js';
import { AuditNarrativeTextSchema } from '../narrative/contract.js';

/** A candidate-blind model judgment about one approved risk-positive obligation. */
export const SourcePostureConclusionSchema = modelTokenSchema(
  z.enum(['risk-supported', 'risk-contradicted', 'inconclusive', 'not-applicable']),
);

/** Closed durable replacement for model-authored applicability prose. */
export const SourcePostureNotApplicableReasonSchema = modelTokenSchema(
  z.enum(['no-relevant-operation-in-scope', 'external-component-not-represented-in-scope']),
);

/** Closed durable signals derived from posture prose or lifecycle state. */
export const SourcePostureLimitationCodeSchema = z.enum([
  'model-declared-limitation',
  'obligation-assessment-missing',
  'source-inspection-missing',
]);

export const SourcePostureAssessmentSchema = z
  .strictObject({
    assessmentId: IdentifierSchema,
    obligationId: PlanObligationReferenceSchema.shape.obligationId,
    conclusion: SourcePostureConclusionSchema,
    /** Validated/redacted context for later bounded model stages; it is not evidence or proof. */
    summary: AuditNarrativeTextSchema.optional(),
    evidenceMapFactIds: EvidenceMapFactIdsSchema,
    notApplicableReason: SourcePostureNotApplicableReasonSchema.nullable().optional(),
    limitations: z.array(SourcePostureLimitationCodeSchema),
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

export const UnverifiedSourcePostureAssessmentSchema = z
  .strictObject({
    obligationId: PlanObligationReferenceSchema.shape.obligationId,
    conclusion: SourcePostureConclusionSchema,
    summary: AuditNarrativeTextSchema.optional(),
    evidenceMapFactIds: UnverifiedEvidenceMapFactIdsSchema,
    notApplicableReason: SourcePostureNotApplicableReasonSchema.nullable().optional(),
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

function uniqueAssessmentObligations(
  assessments: readonly { obligationId: string }[],
  context: z.RefinementCtx,
): void {
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
    limitations: z.array(SourcePostureLimitationCodeSchema),
  })
  .superRefine((value, context) => {
    const identifiers = value.assessments.map((assessment) => assessment.assessmentId);
    if (new Set(identifiers).size !== identifiers.length) {
      context.addIssue({
        code: 'custom',
        path: ['assessments'],
        message: 'Source-posture assessment identifiers must be unique.',
      });
    }
    uniqueAssessmentObligations(value.assessments, context);
  });

export const UnverifiedSourcePostureSchema = z
  .strictObject({
    assessments: z.array(UnverifiedSourcePostureAssessmentSchema),
    limitations: z.array(BoundedTextSchema.min(1)),
  })
  .superRefine((value, context) => uniqueAssessmentObligations(value.assessments, context));

/** Canonical posture-reference collection for an investigator candidate. */
export const SourcePostureAssessmentIdsSchema = z.array(IdentifierSchema).min(1);

export const UnverifiedSourcePostureAssessmentIdsSchema = z
  .array(z.string().trim().min(1).max(160))
  .min(1);

export type SourcePosture = z.infer<typeof SourcePostureSchema>;
export type SourcePostureAssessment = z.infer<typeof SourcePostureAssessmentSchema>;
export type SourcePostureAssessmentIds = z.infer<typeof SourcePostureAssessmentIdsSchema>;
export type UnverifiedSourcePosture = z.infer<typeof UnverifiedSourcePostureSchema>;
