import { z } from 'zod';
import { IdentifierSchema, IsoDateTimeSchema, Sha256Schema } from '../../shared/contracts/core.js';

export const AuditLineageReportIdentitySchema = z.strictObject({
  reportId: IdentifierSchema,
  planId: IdentifierSchema,
  targetFingerprint: Sha256Schema,
});

export const AuditLineageStatusSchema = z.enum(['new', 'persisting', 'resolved', 'unknown']);
export const AuditLineageReasonSchema = z.enum([
  'exact-match-and-coverage-complete',
  'exact-match-but-coverage-incomplete-or-missing',
  'no-exact-match-and-coverage-complete',
  'no-exact-match-and-coverage-incomplete-or-missing',
]);

export const AuditLineageEntrySchema = z.strictObject({
  findingIdentity: IdentifierSchema,
  previousFindingId: IdentifierSchema.nullable(),
  currentFindingId: IdentifierSchema.nullable(),
  previousVectorId: IdentifierSchema.nullable(),
  currentVectorId: IdentifierSchema.nullable(),
  status: AuditLineageStatusSchema,
  reason: AuditLineageReasonSchema,
});

export const AuditLineageCountsSchema = z.strictObject({
  new: z.number().int().nonnegative(),
  persisting: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

export const AuditReportLineageSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    lineageId: IdentifierSchema,
    generatedAt: IsoDateTimeSchema,
    previous: AuditLineageReportIdentitySchema,
    current: AuditLineageReportIdentitySchema,
    counts: AuditLineageCountsSchema,
    entries: z.array(AuditLineageEntrySchema).max(2_000),
  })
  .superRefine((lineage, context) => {
    const identities = lineage.entries.map((entry) => entry.findingIdentity);
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Lineage entries must have unique finding identities.',
      });
    }
    const ordered = [...identities].sort((left, right) => left.localeCompare(right));
    if (!identities.every((identity, index) => identity === ordered[index])) {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Lineage entries must be ordered by finding identity.',
      });
    }
    const counts = {
      new: lineage.entries.filter((entry) => entry.status === 'new').length,
      persisting: lineage.entries.filter((entry) => entry.status === 'persisting').length,
      resolved: lineage.entries.filter((entry) => entry.status === 'resolved').length,
      unknown: lineage.entries.filter((entry) => entry.status === 'unknown').length,
    };
    if (
      counts.new !== lineage.counts.new ||
      counts.persisting !== lineage.counts.persisting ||
      counts.resolved !== lineage.counts.resolved ||
      counts.unknown !== lineage.counts.unknown
    ) {
      context.addIssue({
        code: 'custom',
        path: ['counts'],
        message: 'Lineage counts must equal the emitted entry statuses.',
      });
    }
  });

export type AuditLineageEntry = z.infer<typeof AuditLineageEntrySchema>;
export type AuditReportLineage = z.infer<typeof AuditReportLineageSchema>;
