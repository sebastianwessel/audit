import { z } from 'zod';
import { redactArtifactText } from '../../shared/contracts/artifact-text.js';
import { IdentifierSchema, IsoDateTimeSchema, Sha256Schema } from '../../shared/contracts/core.js';
import {
  type AttackPlan,
  AttackPlanSchema,
  ClaimEvidenceBundleSchema,
  PersistedPlanTextSchema,
  PlanObligationReferencesSchema,
  PlanTitleSchema,
} from '../attack-planning/plan/index.js';
import {
  AuditErrorSchema,
  type AuditReport,
  type Finding,
  FindingSchema,
  FindingVerificationSchema,
  VectorCoverageSchema,
} from '../audit-execution/audit.schema.js';
import { ObligationClosureSchema } from '../audit-execution/coverage-closure/contract.js';

/** Canonical finding provenance is already source-minimal and publishable. */
export const PublicClaimEvidenceBundleSchema = ClaimEvidenceBundleSchema;

/** The persisted verifier projection is already source-minimal and closed. */
export const PublicFindingVerificationSchema = FindingVerificationSchema;

/** A source-minimal accepted or review-required item suitable for CI upload. */
export const PublicFindingSchema = FindingSchema.omit({
  claimEvidenceBundles: true,
  verification: true,
}).extend({
  claimEvidenceBundles: z.array(PublicClaimEvidenceBundleSchema).length(2),
  planObligations: PlanObligationReferencesSchema,
  verification: PublicFindingVerificationSchema,
});

/** The deterministic closure and its closed map-derived applicability proof are publishable. */
const PublicObligationClosureFields = ObligationClosureSchema.shape;
export const PublicObligationClosureSchema = z.strictObject({
  ...PublicObligationClosureFields,
});

/** Redacted sealed-plan context makes a report understandable without becoming a finding decision. */
export const PublicReviewObligationContextSchema = z.strictObject({
  obligationId: IdentifierSchema,
  riskStatement: PersistedPlanTextSchema,
  evidenceRequirement: PersistedPlanTextSchema,
});

export const PublicVectorReviewContextSchema = z.strictObject({
  vectorId: IdentifierSchema,
  title: PlanTitleSchema,
  reviewObligations: z.array(PublicReviewObligationContextSchema).min(1),
});

export const PublicReviewContextSchema = z
  .strictObject({ vectors: z.array(PublicVectorReviewContextSchema).min(1) })
  .superRefine((value, context) => {
    const vectorIds = value.vectors.map((vector) => vector.vectorId);
    if (new Set(vectorIds).size !== vectorIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['vectors'],
        message: 'Review context vector identifiers must be unique.',
      });
    }
    for (const [index, vector] of value.vectors.entries()) {
      const obligationIds = vector.reviewObligations.map((obligation) => obligation.obligationId);
      if (new Set(obligationIds).size === obligationIds.length) continue;
      context.addIssue({
        code: 'custom',
        path: ['vectors', index, 'reviewObligations'],
        message: 'Review context obligation identifiers must be unique.',
      });
    }
  });

/** Public coverage has only closed state, closed limitations, provenance counts, and telemetry. */
const {
  obligationClosure: _obligationClosure,
  reviewRequiredCount: _reviewRequiredCount,
  ...PublicVectorCoverageFields
} = VectorCoverageSchema.shape;
export const PublicVectorCoverageSchema = z.strictObject({
  ...PublicVectorCoverageFields,
  reviewRequiredCount: z.number().int().nonnegative(),
  obligationClosure: z.array(PublicObligationClosureSchema).min(1),
});

/** Persisted audit errors contain only a closed code, stage, and retry state. */
export const PublicAuditErrorSchema = AuditErrorSchema;

/**
 * The only audit-report schema permitted beneath the public artifact root.
 * It deliberately has a separate version from the private runtime result.
 */
export const PublicAuditReportSchema = z
  .strictObject({
    schemaVersion: z.literal(5),
    reportId: IdentifierSchema,
    runId: IdentifierSchema,
    planId: IdentifierSchema,
    targetFingerprint: Sha256Schema,
    generatedAt: IsoDateTimeSchema,
    reviewContext: PublicReviewContextSchema,
    coverage: z.array(PublicVectorCoverageSchema).min(1),
    findings: z.array(PublicFindingSchema),
    reviewRequired: z.array(PublicFindingSchema),
    errors: z.array(PublicAuditErrorSchema),
  })
  .superRefine((report, context) => {
    const vectorIds = report.coverage.map((coverage) => coverage.vectorId);
    if (new Set(vectorIds).size !== vectorIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'Public report coverage vector identifiers must be unique.',
      });
    }
    const findingIds = report.findings.map((finding) => finding.findingId);
    const reviewRequiredIds = report.reviewRequired.map((finding) => finding.findingId);
    if (new Set(findingIds).size !== findingIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'Public report finding identifiers must be unique.',
      });
    }
    if (new Set(reviewRequiredIds).size !== reviewRequiredIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['reviewRequired'],
        message: 'Public report review-required identifiers must be unique.',
      });
    }
    if (reviewRequiredIds.some((findingId) => findingIds.includes(findingId))) {
      context.addIssue({
        code: 'custom',
        path: ['reviewRequired'],
        message: 'A public report item cannot be both accepted and review-required.',
      });
    }

    for (const [index, finding] of report.findings.entries()) {
      if (finding.status === 'accepted') continue;
      context.addIssue({
        code: 'custom',
        path: ['findings', index, 'status'],
        message: 'Public report findings must have accepted status.',
      });
    }
    for (const [index, finding] of report.reviewRequired.entries()) {
      if (finding.status === 'needs-review') continue;
      context.addIssue({
        code: 'custom',
        path: ['reviewRequired', index, 'status'],
        message: 'Public report review-required items must have needs-review status.',
      });
    }

    const coverageByVectorId = new Map(
      report.coverage.map((coverage) => [coverage.vectorId, coverage]),
    );
    const reviewContextByVectorId = new Map(
      report.reviewContext.vectors.map((vector) => [vector.vectorId, vector]),
    );
    for (const coverage of report.coverage) {
      if (reviewContextByVectorId.has(coverage.vectorId)) continue;
      context.addIssue({
        code: 'custom',
        path: ['reviewContext'],
        message: 'Every public coverage row requires its sealed plan review context.',
      });
    }
    for (const [index, finding] of report.findings.entries()) {
      if (coverageByVectorId.has(finding.vectorId)) continue;
      context.addIssue({
        code: 'custom',
        path: ['findings', index, 'vectorId'],
        message: 'Every public finding must reference a covered vector.',
      });
    }
    for (const [index, finding] of report.reviewRequired.entries()) {
      if (coverageByVectorId.has(finding.vectorId)) continue;
      context.addIssue({
        code: 'custom',
        path: ['reviewRequired', index, 'vectorId'],
        message: 'Every public review-required item must reference a covered vector.',
      });
    }
    for (const coverage of report.coverage) {
      const findingCount = report.findings.filter(
        (finding) => finding.vectorId === coverage.vectorId,
      ).length;
      const reviewRequiredCount = report.reviewRequired.filter(
        (finding) => finding.vectorId === coverage.vectorId,
      ).length;
      if (coverage.findingCount !== findingCount) {
        context.addIssue({
          code: 'custom',
          path: ['coverage', report.coverage.indexOf(coverage), 'findingCount'],
          message: 'Public coverage finding count must equal accepted findings for its vector.',
        });
      }
      if (coverage.reviewRequiredCount !== reviewRequiredCount) {
        context.addIssue({
          code: 'custom',
          path: ['coverage', report.coverage.indexOf(coverage), 'reviewRequiredCount'],
          message:
            'Public coverage review-required count must equal review-required items for its vector.',
        });
      }
    }
  });

export type PublicAuditReport = z.infer<typeof PublicAuditReportSchema>;
export type PublicFinding = z.infer<typeof PublicFindingSchema>;
export type PublicVectorCoverage = z.infer<typeof PublicVectorCoverageSchema>;

/** Projects one internal runtime result to the sole publishable report contract. */
export function createPublicAuditReport(report: AuditReport, plan?: AttackPlan): PublicAuditReport {
  const sealedPlan = plan === undefined ? undefined : AttackPlanSchema.parse(plan);
  if (
    sealedPlan !== undefined &&
    (sealedPlan.planId !== report.planId ||
      sealedPlan.targetFingerprint !== report.targetFingerprint)
  ) {
    throw new Error('The sealed plan does not match the audit report identity.');
  }
  return PublicAuditReportSchema.parse({
    schemaVersion: 5,
    reportId: report.reportId,
    runId: report.runId,
    planId: report.planId,
    targetFingerprint: report.targetFingerprint,
    generatedAt: report.generatedAt,
    reviewContext: createReviewContext(sealedPlan, report),
    coverage: report.coverage.map(projectCoverage),
    findings: report.findings.map(projectFinding),
    reviewRequired: report.reviewRequired.map(projectFinding),
    errors: report.errors.map((error) => ({ ...error })),
  });
}

function projectFinding(finding: Finding): PublicFinding {
  return {
    ...finding,
    claimEvidenceBundles: finding.claimEvidenceBundles.map((bundle) => ({ ...bundle })),
    verification: {
      status: finding.verification.status,
      checks: [...finding.verification.checks],
    },
  };
}

function projectCoverage(coverage: AuditReport['coverage'][number]): PublicVectorCoverage {
  const { obligationClosure, reviewRequiredCount, ...safeCoverage } = coverage;
  return {
    ...safeCoverage,
    reviewRequiredCount: reviewRequiredCount ?? 0,
    obligationClosure: obligationClosure.map((closure) => ({ ...closure })),
  };
}

function createReviewContext(plan: AttackPlan | undefined, report: AuditReport) {
  if (plan === undefined) {
    return {
      vectors: report.coverage.map((coverage) => ({
        vectorId: coverage.vectorId,
        title: 'Review context unavailable',
        reviewObligations: coverage.obligationClosure.map((closure) => ({
          obligationId: closure.obligationId,
          riskStatement: 'The sealed plan context was unavailable for this projection.',
          evidenceRequirement: 'Use the sealed plan artifact for the required evidence.',
        })),
      })),
    };
  }
  const coverageVectorIds = new Set(report.coverage.map((coverage) => coverage.vectorId));
  return {
    vectors: plan.vectors
      .filter((vector) => coverageVectorIds.has(vector.vectorId))
      .map((vector) => ({
        vectorId: vector.vectorId,
        title: redactArtifactText(vector.title),
        reviewObligations: vector.reviewObligations.map((obligation) => ({
          obligationId: obligation.obligationId,
          riskStatement: redactArtifactText(obligation.riskStatement),
          evidenceRequirement: redactArtifactText(obligation.evidenceRequirement),
        })),
      })),
  };
}
