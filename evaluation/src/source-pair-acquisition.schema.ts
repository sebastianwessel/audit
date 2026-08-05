import { z } from 'zod';

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  RelativePathSchema,
  SchemaVersion,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';

import { CandidateSourceLicenseStatusSchema } from './candidate-registry.schema.js';

/** One tracked regular file copied from a pinned Git revision. */
export const AcquiredSourceFileSchema = z.strictObject({
  path: RelativePathSchema,
  mode: z.enum(['100644', '100755']),
  digest: Sha256Schema,
});

export const AcquiredSourceVariantSchema = z
  .strictObject({
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    directory: z.enum(['vulnerable', 'patched']),
    files: z.array(AcquiredSourceFileSchema).min(1),
    contentDigest: Sha256Schema,
  })
  .superRefine((variant, context) => {
    const paths = variant.files.map((file) => file.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Snapshot files must be unique.',
      });
    }
    if (
      paths.some((path, index) => index > 0 && (paths[index - 1]?.localeCompare(path) ?? -1) >= 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['files'],
        message: 'Snapshot files must be ordered.',
      });
    }
  });

/**
 * Evaluator-only source-pair provenance. It intentionally contains no label,
 * reviewer state, answer key, plan, or source content.
 */
export const AcquiredSourcePairSchema = z.strictObject({
  schemaVersion: SchemaVersion,
  snapshotId: IdentifierSchema,
  candidateRegistryId: IdentifierSchema,
  candidateRegistryDigest: Sha256Schema,
  candidateId: IdentifierSchema,
  sourceRecordId: IdentifierSchema,
  repositoryUrl: z.url(),
  sourceLicenseStatus: CandidateSourceLicenseStatusSchema,
  capturedAt: IsoDateTimeSchema,
  variants: z.strictObject({
    vulnerable: AcquiredSourceVariantSchema,
    patched: AcquiredSourceVariantSchema,
  }),
  snapshotDigest: Sha256Schema,
});

export const AcquiredSourcePairSummarySchema = z.strictObject({
  snapshotId: IdentifierSchema,
  candidateId: IdentifierSchema,
  vulnerableFileCount: z.int().positive(),
  patchedFileCount: z.int().positive(),
  snapshotDigest: Sha256Schema,
});

/** Content-free report from rechecking every local acquisition workspace. */
export const AcquiredSourcePairCollectionSummarySchema = z.strictObject({
  snapshotCount: z.int().nonnegative(),
  snapshots: z.array(AcquiredSourcePairSummarySchema),
});

export type AcquiredSourceFile = z.infer<typeof AcquiredSourceFileSchema>;
export type AcquiredSourceVariant = z.infer<typeof AcquiredSourceVariantSchema>;
export type AcquiredSourcePair = z.infer<typeof AcquiredSourcePairSchema>;
export type AcquiredSourcePairSummary = z.infer<typeof AcquiredSourcePairSummarySchema>;
export type AcquiredSourcePairCollectionSummary = z.infer<
  typeof AcquiredSourcePairCollectionSummarySchema
>;
