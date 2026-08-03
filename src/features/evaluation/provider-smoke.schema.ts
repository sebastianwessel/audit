import { z } from 'zod';

import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import { IdentifierSchema, IsoDateTimeSchema, Sha256Schema } from '../../shared/contracts/core.js';
import { VerificationTerminalLaneCountsSchema } from '../audit-execution/verification/contract.js';
import { ModelRunObservationSchema } from '../model-operations/model-operations.schema.js';

import { CorpusVariantSchema } from './corpus.schema.js';
import {
  ProviderCommandCheckpointStatusSchema,
  validateProviderCommandCheckpointLifecycle,
} from './provider-command-checkpoint-lifecycle.schema.js';

/** Source-free terminal projection for one vector in a non-scoring provider smoke. */
export const ProviderSmokeVectorSchema = z.strictObject({
  vectorId: IdentifierSchema,
  outcome: z.enum(['completed', 'incomplete', 'failed', 'cancelled', 'skipped']),
  errorCode: z.string().trim().min(1).max(64).nullable(),
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
  provider: z.string().trim().min(1).max(160),
  model: z.string().trim().min(1).max(160),
  caseId: IdentifierSchema,
  variant: CorpusVariantSchema,
  planProfile: z.literal('reviewed-plan'),
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  reviewedPlanFingerprint: Sha256Schema,
  verificationRouteFingerprint: Sha256Schema,
  evidenceMapProtocolFingerprint: Sha256Schema,
  reviewWorkflowProtocolFingerprint: Sha256Schema,
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
    executionBudget: checkpoint.executionBudget,
  });
}

/** A diagnostic run never contains answer keys, findings, source, prompts, or model text. */
export const ProviderSmokeRunSchema = ProviderSmokeIdentitySchema.extend({
  schemaVersion: z.literal(2),
  mode: z.literal('provider-smoke'),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  status: z.enum(['completed', 'incomplete', 'failed', 'cancelled']),
  vectors: z.array(ProviderSmokeVectorSchema).min(1),
  modelObservation: ModelRunObservationSchema,
});

export type ProviderSmokeRun = z.infer<typeof ProviderSmokeRunSchema>;
export type ProviderSmokeCheckpoint = z.infer<typeof ProviderSmokeCheckpointSchema>;
