import { z } from 'zod';

import {
  IdentifierSchema,
  RelativePathSchema,
  Sha256Schema,
} from '../../../shared/contracts/core.js';
import { AuditRunManifestSchema } from '../../audit-execution/audit.schema.js';
import { AttackPlanSchema } from './plan.schema.js';

/** Immutable private recovery record for one plan-pair publication attempt. */
export const PlanPublicationIntentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    command: z.enum(['plan', 'plan-reseal']),
    runId: IdentifierSchema,
    planId: IdentifierSchema,
    planDigest: Sha256Schema,
    planJsonPath: RelativePathSchema,
    planMarkdownPath: RelativePathSchema,
    plan: AttackPlanSchema,
    runManifest: AuditRunManifestSchema.nullable(),
  })
  .superRefine((intent, context) => {
    if (intent.command === 'plan' && intent.runManifest === null) {
      context.addIssue({
        code: 'custom',
        path: ['runManifest'],
        message: 'A model-backed plan publication requires its exact run manifest.',
      });
      return;
    }
    if (intent.command === 'plan-reseal' && intent.runManifest !== null) {
      context.addIssue({
        code: 'custom',
        path: ['runManifest'],
        message: 'A local plan reseal must not retain a model-backed run manifest.',
      });
      return;
    }
    if (
      intent.runManifest !== null &&
      (intent.runManifest.runId !== intent.runId ||
        intent.runManifest.planId !== intent.planId ||
        intent.runManifest.targetFingerprint !== intent.plan.targetFingerprint)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['runManifest'],
        message: 'The plan run manifest must bind the same run, plan, and target.',
      });
    }
  });

export type PlanPublicationIntent = z.infer<typeof PlanPublicationIntentSchema>;
