import { z } from 'zod';

import {
  PlanObligationReferenceSchema,
  SourceEvidenceSchema,
} from '../../attack-planning/index.js';
import { SourcePostureNotApplicableReasonSchema } from '../source-posture/contract.js';

export const ObligationMapStateSchema = z.enum(['mapped', 'unanswered', 'not-reached']);
export const ObligationInvestigationStateSchema = z.enum([
  'candidate-raised',
  'no-source-backed-candidate',
  'not-applicable',
  'incomplete',
  'not-reached',
]);
export const ObligationTerminalDispositionSchema = z.enum([
  'finding-admitted',
  'candidate-rejected',
  'review-required',
  'no-source-backed-candidate',
  'not-applicable',
  'incomplete',
  'not-reached',
]);

/** Content-free projection of all phase states for one plan-owned obligation. */
export const ObligationClosureSchema = z
  .strictObject({
    obligationId: z.string().trim().min(1).max(160),
    planObligation: PlanObligationReferenceSchema,
    mapState: ObligationMapStateSchema,
    evidenceMapFactCount: z.number().int().nonnegative(),
    sourcePostureConclusion: z
      .enum(['risk-supported', 'risk-contradicted', 'inconclusive', 'not-applicable'])
      .nullable(),
    notApplicableReason: SourcePostureNotApplicableReasonSchema.nullable().optional(),
    notApplicableEvidence: z.array(SourceEvidenceSchema).min(1).optional(),
    investigationState: ObligationInvestigationStateSchema,
    candidateCount: z.number().int().nonnegative(),
    admittedFindingCount: z.number().int().nonnegative(),
    terminalDisposition: ObligationTerminalDispositionSchema,
  })
  .superRefine((value, context) => {
    if (value.obligationId !== value.planObligation.obligationId) {
      context.addIssue({
        code: 'custom',
        path: ['obligationId'],
        message: 'Closure obligationId must match its plan-obligation reference.',
      });
    }
    const hasMappedFacts = value.evidenceMapFactCount > 0;
    if ((value.mapState === 'mapped') !== hasMappedFacts) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceMapFactCount'],
        message: 'Only a mapped obligation may retain one or more evidence-map facts.',
      });
    }
    const hasNotApplicableReason =
      value.notApplicableReason !== undefined && value.notApplicableReason !== null;
    if ((value.sourcePostureConclusion === 'not-applicable') !== hasNotApplicableReason) {
      context.addIssue({
        code: 'custom',
        path: ['notApplicableReason'],
        message: 'Only a not-applicable posture carries a required applicability reason.',
      });
    }
    if (
      (value.sourcePostureConclusion === 'not-applicable') !==
      (value.notApplicableEvidence !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['notApplicableEvidence'],
        message:
          'Only a not-applicable posture carries required source-minimal applicability evidence.',
      });
    }
    if ((value.terminalDisposition === 'finding-admitted') !== value.admittedFindingCount > 0) {
      context.addIssue({
        code: 'custom',
        path: ['admittedFindingCount'],
        message: 'Only a finding-admitted closure may retain admitted findings.',
      });
    }
    if (value.terminalDisposition === 'candidate-rejected' && value.candidateCount === 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidateCount'],
        message: 'A candidate-rejected closure must retain at least one candidate.',
      });
    }
    if (value.terminalDisposition === 'no-source-backed-candidate' && value.candidateCount !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidateCount'],
        message: 'A no-source-backed-candidate closure cannot retain candidates.',
      });
    }
    if (
      (value.terminalDisposition === 'not-applicable') !==
      (value.sourcePostureConclusion === 'not-applicable')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalDisposition'],
        message: 'Only a not-applicable posture may produce a not-applicable closure.',
      });
    }
  });

export const ObligationClosureMatrixSchema = z
  .array(ObligationClosureSchema)
  .min(1)
  .superRefine((closures, context) => {
    const obligationIds = closures.map((closure) => closure.obligationId);
    if (new Set(obligationIds).size === obligationIds.length) return;
    context.addIssue({
      code: 'custom',
      message: 'Obligation closures must contain at most one row per plan obligation.',
    });
  });

export type ObligationClosure = z.infer<typeof ObligationClosureSchema>;
export type ObligationClosureMatrix = z.infer<typeof ObligationClosureMatrixSchema>;
