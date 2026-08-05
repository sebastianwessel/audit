import { z } from 'zod';
import { AuditErrorSchema } from '../../src/features/audit-execution/audit.schema.js';
import { VerificationTerminalLaneCountsSchema } from '../../src/features/audit-execution/verification/contract.js';
import {
  ModelRunObservationSchema,
  ModelStageErrorCodeSchema,
} from '../../src/features/model-operations/model-operations.schema.js';
import { HarnessExecutionConfigurationSchema } from '../../src/platform/harness/audit-harness.js';
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';
import {
  ModelIdentifierSchema,
  ModelProviderIdentifierSchema,
} from '../../src/shared/contracts/model-identity.js';

import { CorpusVariantSchema } from './corpus.schema.js';
import {
  ProviderCommandCheckpointStatusSchema,
  validateProviderCommandCheckpointLifecycle,
} from './provider-command-checkpoint-lifecycle.schema.js';

/** Source-free terminal projection for one vector in a non-scoring provider smoke. */
export const ProviderSmokeVectorSchema = z.strictObject({
  vectorId: IdentifierSchema,
  outcome: z.enum(['completed', 'incomplete', 'failed', 'cancelled', 'skipped']),
  errorCode: ModelStageErrorCodeSchema.nullable(),
  matchedSourcePaths: z.number().int().nonnegative(),
  evidenceMapFactCount: z.number().int().nonnegative(),
  evidenceMapUnansweredObligationCount: z.number().int().nonnegative(),
  sourcePostureAssessmentCount: z.number().int().nonnegative(),
  findingCount: z.number().int().nonnegative(),
  reviewRequiredCount: z.number().int().nonnegative(),
  verificationTerminalLanes: VerificationTerminalLaneCountsSchema,
});

/** Immutable source-free identity shared by a smoke command checkpoint and its terminal artifact. */
export const ProviderSmokeIdentitySchema = z.strictObject({
  runId: IdentifierSchema,
  provider: ModelProviderIdentifierSchema,
  model: ModelIdentifierSchema,
  caseId: IdentifierSchema,
  variant: CorpusVariantSchema,
  planProfile: z.literal('audit-reviewed-plan'),
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  reviewedPlanFingerprint: Sha256Schema,
  verificationRouteFingerprint: Sha256Schema,
  evidenceMapProtocolFingerprint: Sha256Schema,
  reviewWorkflowProtocolFingerprint: Sha256Schema,
  structuredOutputCompatibilityFingerprint: Sha256Schema,
  executionBudget: HarnessExecutionConfigurationSchema,
});

export const ProviderSmokeCheckpointErrorCodeSchema = z.enum([
  'provider-cancelled',
  'provider-smoke-failed',
]);

/** Source-free start/terminal state that prevents one smoke run id being repurposed. */
export const ProviderSmokeCheckpointSchema = ProviderSmokeIdentitySchema.extend({
  schemaVersion: z.literal(1),
  status: ProviderCommandCheckpointStatusSchema,
  errorCode: ProviderSmokeCheckpointErrorCodeSchema.nullable(),
  startedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).superRefine((checkpoint, context) =>
  validateProviderCommandCheckpointLifecycle(checkpoint, context, {
    cancelled: 'provider-cancelled',
    failed: 'provider-smoke-failed',
  }),
);

export function providerSmokeIdentityFromCheckpoint(
  checkpoint: z.infer<typeof ProviderSmokeCheckpointSchema>,
): z.infer<typeof ProviderSmokeIdentitySchema> {
  return ProviderSmokeIdentitySchema.parse({
    runId: checkpoint.runId,
    provider: checkpoint.provider,
    model: checkpoint.model,
    caseId: checkpoint.caseId,
    variant: checkpoint.variant,
    planProfile: checkpoint.planProfile,
    targetFingerprint: checkpoint.targetFingerprint,
    contextDigest: checkpoint.contextDigest,
    reviewedPlanFingerprint: checkpoint.reviewedPlanFingerprint,
    verificationRouteFingerprint: checkpoint.verificationRouteFingerprint,
    evidenceMapProtocolFingerprint: checkpoint.evidenceMapProtocolFingerprint,
    reviewWorkflowProtocolFingerprint: checkpoint.reviewWorkflowProtocolFingerprint,
    structuredOutputCompatibilityFingerprint: checkpoint.structuredOutputCompatibilityFingerprint,
    executionBudget: checkpoint.executionBudget,
  });
}

/** A diagnostic run retains its closed operational error ledger but never source or model content. */
export const ProviderSmokeRunSchema = ProviderSmokeIdentitySchema.extend({
  schemaVersion: z.literal(3),
  mode: z.literal('provider-smoke'),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  status: z.enum(['completed', 'incomplete', 'failed', 'cancelled']),
  vectors: z.array(ProviderSmokeVectorSchema).min(1),
  errors: z.array(AuditErrorSchema),
  modelObservation: ModelRunObservationSchema,
});

export type ProviderSmokeRun = z.infer<typeof ProviderSmokeRunSchema>;
export type ProviderSmokeCheckpoint = z.infer<typeof ProviderSmokeCheckpointSchema>;
