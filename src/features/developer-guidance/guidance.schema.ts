import { z } from 'zod';

import { IdentifierSchema, IsoDateTimeSchema, Sha256Schema } from '../../shared/contracts/core.js';
import {
  ModelIdentifierSchema,
  ModelProviderIdentifierSchema,
} from '../../shared/contracts/model-identity.js';
import { RecommendedPrioritySchema } from '../developer-guidance/index.js';
import {
  ModelRunObservationSchema,
  ModelStageObservationSchema,
} from '../model-operations/model-operations.schema.js';

const GuidanceBindingSchema = z.strictObject({
  findingId: IdentifierSchema,
  findingFingerprint: IdentifierSchema,
  vectorId: IdentifierSchema,
});

/** Exact reuse boundary for one resumable developer-guidance run. */
export const DeveloperGuidanceCheckpointBindingSchema = z.strictObject({
  runId: IdentifierSchema,
  reportId: IdentifierSchema,
  reportDigest: Sha256Schema,
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
  contextDigest: Sha256Schema,
  provider: ModelProviderIdentifierSchema,
  model: ModelIdentifierSchema,
  protocolFingerprint: Sha256Schema,
});

/** Source-free ownership record for one mutable developer-guidance run. */
export const DeveloperGuidanceLeaseMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal('developer-guidance'),
  runId: IdentifierSchema,
});

export const DeveloperGuidanceItemSchema = z.discriminatedUnion('status', [
  GuidanceBindingSchema.extend({
    status: z.literal('completed'),
    recommendedPriority: RecommendedPrioritySchema,
  }),
  GuidanceBindingSchema.extend({
    status: z.literal('incomplete'),
    reasonCode: z.string().trim().min(1).max(64),
  }),
  GuidanceBindingSchema.extend({
    status: z.literal('cancelled'),
    reasonCode: z.literal('provider-cancelled'),
  }),
]);

/**
 * One terminal attempt for a finding. Failed or cancelled attempts remain in
 * the private checkpoint for cost accounting; only a later completed attempt
 * is reusable as guidance output.
 */
export const DeveloperGuidanceAttemptSchema = z
  .strictObject({
    attempt: z.number().int().positive(),
    item: DeveloperGuidanceItemSchema,
    modelObservation: ModelStageObservationSchema,
  })
  .superRefine((value, context) => {
    if (value.modelObservation.stage !== 'developer-guidance') {
      context.addIssue({
        code: 'custom',
        path: ['modelObservation', 'stage'],
        message: 'Developer guidance attempts retain only developer-guidance observations.',
      });
    }
    if (value.item.status === 'completed' && value.modelObservation.status !== 'completed') {
      context.addIssue({
        code: 'custom',
        path: ['modelObservation', 'status'],
        message: 'A completed guidance item requires a completed stage observation.',
      });
    }
    if (value.item.status !== 'completed' && value.modelObservation.status !== 'failed') {
      context.addIssue({
        code: 'custom',
        path: ['modelObservation', 'status'],
        message: 'An unfinished guidance item requires a failed stage observation.',
      });
    }
    if (
      value.item.status === 'cancelled' &&
      value.modelObservation.errorCode !== 'provider-cancelled'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modelObservation', 'errorCode'],
        message: 'A cancelled guidance item requires a provider-cancelled stage observation.',
      });
    }
  });

/** A non-gating, immutable companion to one already validated audit report. */
export const DeveloperGuidanceReportSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    guidanceId: IdentifierSchema,
    runId: IdentifierSchema,
    reportId: IdentifierSchema,
    reportDigest: Sha256Schema,
    planId: IdentifierSchema,
    planDigest: Sha256Schema,
    targetFingerprint: Sha256Schema,
    contextDigest: Sha256Schema,
    generatedAt: IsoDateTimeSchema,
    items: z.array(DeveloperGuidanceItemSchema),
    modelObservation: ModelRunObservationSchema,
  })
  .superRefine((value, context) => {
    const ids = value.items.map((item) => item.findingId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'Developer guidance contains at most one item for each accepted finding.',
      });
    }
  });

/** Durable, append-only progress for one guidance run. It is never a final report. */
export const DeveloperGuidanceCheckpointSchema = z
  .strictObject({
    schemaVersion: z.literal(3),
    binding: DeveloperGuidanceCheckpointBindingSchema,
    generatedAt: IsoDateTimeSchema,
    attempts: z.array(DeveloperGuidanceAttemptSchema),
  })
  .superRefine((value, context) => {
    const byFinding = new Map<string, number[]>();
    for (const attempt of value.attempts) {
      const attempts = byFinding.get(attempt.item.findingId) ?? [];
      attempts.push(attempt.attempt);
      byFinding.set(attempt.item.findingId, attempts);
    }
    for (const [findingId, attempts] of byFinding) {
      const unique = new Set(attempts);
      if (unique.size !== attempts.length) {
        context.addIssue({
          code: 'custom',
          path: ['attempts'],
          message: `Developer guidance checkpoint duplicates attempt state for finding ${findingId}.`,
        });
      }
      const ordered = [...unique].sort((left, right) => left - right);
      if (ordered.some((attempt, index) => attempt !== index + 1)) {
        context.addIssue({
          code: 'custom',
          path: ['attempts'],
          message: `Developer guidance checkpoint has a gap in attempt state for finding ${findingId}.`,
        });
      }
    }
  });

export type DeveloperGuidanceItem = z.infer<typeof DeveloperGuidanceItemSchema>;
export type DeveloperGuidanceAttempt = z.infer<typeof DeveloperGuidanceAttemptSchema>;
export type DeveloperGuidanceReport = z.infer<typeof DeveloperGuidanceReportSchema>;
export type DeveloperGuidanceCheckpoint = z.infer<typeof DeveloperGuidanceCheckpointSchema>;
export type DeveloperGuidanceCheckpointBinding = z.infer<
  typeof DeveloperGuidanceCheckpointBindingSchema
>;
export type DeveloperGuidanceLeaseMetadata = z.infer<typeof DeveloperGuidanceLeaseMetadataSchema>;
