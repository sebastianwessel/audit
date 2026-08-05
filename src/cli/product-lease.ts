import { z } from 'zod';

import { DeveloperGuidanceLeaseMetadataSchema } from '../features/developer-guidance/index.js';
import {
  ArtifactStoreError,
  readArtifactLeaseMetadata,
  releaseArtifactLease,
} from '../platform/artifact-store/json-artifact-store.js';
import { IdentifierSchema, Sha256Schema } from '../shared/contracts/core.js';

const SimpleProductLeaseMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.enum(['plan', 'plan-reseal', 'audit']),
  runId: IdentifierSchema,
});

const AuditPrivateWorkDiscardLeaseMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  operation: z.literal('audit-private-work-discard'),
  runId: IdentifierSchema,
  planId: IdentifierSchema,
  planDigest: Sha256Schema,
  targetFingerprint: Sha256Schema,
});

/** The only source-free lease records that the product recovery command may inspect or release. */
export const ProductLeaseMetadataSchema = z.discriminatedUnion('operation', [
  SimpleProductLeaseMetadataSchema,
  DeveloperGuidanceLeaseMetadataSchema,
  AuditPrivateWorkDiscardLeaseMetadataSchema,
]);
export type ProductLeaseMetadata = z.infer<typeof ProductLeaseMetadataSchema>;

export const ProductLeaseOperationSchema = z.enum([
  'plan',
  'plan-reseal',
  'audit',
  'developer-guidance',
  'audit-private-work-discard',
]);
export type ProductLeaseOperation = z.infer<typeof ProductLeaseOperationSchema>;

export const ProductLeaseInspectionSchema = z.strictObject({
  lease: ProductLeaseMetadataSchema.nullable(),
});
export type ProductLeaseInspection = z.infer<typeof ProductLeaseInspectionSchema>;

const ProductLeaseAddressSchema = z.strictObject({
  privateWork: z.string().trim().min(1),
  runId: IdentifierSchema,
});

const ProductLeaseReleaseConfirmationSchema = ProductLeaseAddressSchema.extend({
  operation: ProductLeaseOperationSchema,
});

export function productLeasePath(runId: string): string {
  return `work/leases/${runId}.lock`;
}

/** Reads one lease without opening target input, runtime configuration, or a provider. */
export async function inspectProductLease(input: {
  privateWork: string;
  runId: string;
}): Promise<ProductLeaseInspection> {
  const address = ProductLeaseAddressSchema.parse(input);
  const metadata = await readArtifactLeaseMetadata(
    address.privateWork,
    productLeasePath(address.runId),
  );
  if (metadata === undefined) return ProductLeaseInspectionSchema.parse({ lease: null });
  const parsedMetadata = ProductLeaseMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success) {
    throw new ArtifactStoreError(
      'artifact-lease-mismatch',
      'The product lease is absent or does not have recognized source-free metadata.',
    );
  }
  if (parsedMetadata.data.runId !== address.runId) {
    throw new ArtifactStoreError(
      'artifact-lease-mismatch',
      'The product lease metadata does not match its requested run identity.',
    );
  }
  return ProductLeaseInspectionSchema.parse({ lease: parsedMetadata.data });
}

/**
 * Removes one known-abandoned product lease after exact operation/run confirmation.
 * The artifact store rereads the complete metadata immediately before removal.
 */
export async function releaseProductLease(input: {
  privateWork: string;
  runId: string;
  operation: ProductLeaseOperation;
}): Promise<void> {
  const confirmation = ProductLeaseReleaseConfirmationSchema.parse(input);
  const inspection = await inspectProductLease({
    privateWork: confirmation.privateWork,
    runId: confirmation.runId,
  });
  if (
    inspection.lease === null ||
    inspection.lease.operation !== confirmation.operation ||
    inspection.lease.runId !== confirmation.runId
  ) {
    throw new ArtifactStoreError(
      'artifact-lease-mismatch',
      'The product lease does not match the supplied operation and run identity.',
    );
  }
  await releaseArtifactLease(
    confirmation.privateWork,
    productLeasePath(confirmation.runId),
    inspection.lease,
  );
}

export function createSimpleProductLeaseMetadata(input: {
  operation: 'plan' | 'plan-reseal' | 'audit';
  runId: string;
}): ProductLeaseMetadata {
  return SimpleProductLeaseMetadataSchema.parse({ schemaVersion: 1, ...input });
}
