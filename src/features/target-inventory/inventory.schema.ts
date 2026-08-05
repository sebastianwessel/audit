import { z } from 'zod';

import { IdentifierSchema, RelativePathSchema, Sha256Schema } from '../../shared/contracts/core.js';

export const ContextKindSchema = z.enum([
  'architecture',
  'deployment',
  'data-flow',
  'controls',
  'threat-model',
  'other',
]);

export const ContextSensitivitySchema = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted',
]);

/** Content-free summary of the admitted source inventory. */
export const InventorySummarySchema = z.strictObject({
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  languageHints: z.array(z.string().trim().min(1)),
});

/** Explicit source-admission policy; it never carries a size or result limit. */
export const SourceAdmissionExclusionReasonSchema = z.enum([
  'vcs-metadata',
  'dependency-or-vendor-cache',
  'build-or-generated-output',
  'local-secret-store',
  'outside-includes',
  'invalid-encoding',
]);

export const SourceAdmissionPolicySchema = z.strictObject({
  schemaVersion: z.literal(1),
  includeGlobs: z.array(z.string().trim().min(1)).min(1),
  defaultExclusions: z.array(SourceAdmissionExclusionReasonSchema).min(1),
  overrides: z.array(SourceAdmissionExclusionReasonSchema),
});

export const AdmittedSourceSnapshotRowSchema = z.strictObject({
  disposition: z.literal('admitted'),
  path: RelativePathSchema,
  byteLength: z.number().int().nonnegative(),
  contentDigest: Sha256Schema,
  objectRef: RelativePathSchema,
  languageHint: z.string().trim().min(1).max(32).nullable(),
});

export const ExcludedSourceSnapshotRowSchema = z.strictObject({
  disposition: z.literal('excluded'),
  path: RelativePathSchema,
  reason: SourceAdmissionExclusionReasonSchema,
});

export const SourceSnapshotRowSchema = z.discriminatedUnion('disposition', [
  AdmittedSourceSnapshotRowSchema,
  ExcludedSourceSnapshotRowSchema,
]);

/** Source-free, ordered admission record for one immutable target snapshot. */
export const SourceSnapshotManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    policy: SourceAdmissionPolicySchema,
    targetFingerprint: Sha256Schema,
    rows: z.array(SourceSnapshotRowSchema).min(1),
  })
  .superRefine((value, context) => {
    const paths = value.rows.map((row) => row.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'Source snapshot rows must have unique paths.',
      });
    }
    if (paths.some((path, index) => index > 0 && path < (paths[index - 1] ?? path))) {
      context.addIssue({
        code: 'custom',
        path: ['rows'],
        message: 'Source snapshot rows must be sorted by path.',
      });
    }
  });

/** Content-free ownership state for a retained private snapshot. */
export const SourceSnapshotRetentionRecordSchema = z.strictObject({
  runId: IdentifierSchema,
  contextDigest: Sha256Schema,
});

export const SourceSnapshotRetentionIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    targetFingerprint: Sha256Schema,
    retainedRuns: z.array(SourceSnapshotRetentionRecordSchema),
  })
  .superRefine((value, context) => {
    const runIds = value.retainedRuns.map((record) => record.runId);
    if (new Set(runIds).size !== runIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['retainedRuns'],
        message: 'Snapshot retention run identifiers must be unique.',
      });
    }
    if (
      value.retainedRuns.some(
        (record, index) =>
          index > 0 && record.runId < (value.retainedRuns[index - 1]?.runId ?? record.runId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['retainedRuns'],
        message: 'Snapshot retention run identifiers must be sorted.',
      });
    }
  });

export const ContextDocumentSchema = z.strictObject({
  path: RelativePathSchema,
  title: z.string().trim().min(1),
  kind: ContextKindSchema,
  sensitivity: ContextSensitivitySchema,
  appliesTo: z.array(z.string().trim().min(1)),
  body: z
    .string()
    .min(1)
    .refine((body) => body.trim().length > 0, 'Context body must contain non-whitespace text.'),
  digest: Sha256Schema,
});

export const TargetInventorySchema = z
  .strictObject({
    targetFingerprint: Sha256Schema,
    contextDigest: Sha256Schema,
    summary: InventorySummarySchema,
    sourceSnapshot: SourceSnapshotManifestSchema,
    context: z.array(ContextDocumentSchema),
  })
  .superRefine((value, context) => {
    if (value.targetFingerprint !== value.sourceSnapshot.targetFingerprint) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSnapshot', 'targetFingerprint'],
        message: 'The source snapshot must bind the inventory target fingerprint.',
      });
    }
  });

export type ContextDocument = z.infer<typeof ContextDocumentSchema>;
export type InventorySummary = z.infer<typeof InventorySummarySchema>;
export type SourceAdmissionExclusionReason = z.infer<typeof SourceAdmissionExclusionReasonSchema>;
export type SourceAdmissionPolicy = z.infer<typeof SourceAdmissionPolicySchema>;
export type SourceSnapshotManifest = z.infer<typeof SourceSnapshotManifestSchema>;
export type SourceSnapshotRetentionIndex = z.infer<typeof SourceSnapshotRetentionIndexSchema>;
export type SourceSnapshotRow = z.infer<typeof SourceSnapshotRowSchema>;
export type TargetInventory = z.infer<typeof TargetInventorySchema>;

/** The immutable manifest is the sole source of admitted source-path identity. */
export function admittedSourcePaths(manifest: SourceSnapshotManifest): string[] {
  return manifest.rows.flatMap((row) => (row.disposition === 'admitted' ? [row.path] : []));
}
