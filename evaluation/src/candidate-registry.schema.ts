import { z } from 'zod';

import {
  IdentifierSchema,
  RelativePathSchema,
  SchemaVersion,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';

import { CorpusDatasetSchema } from './corpus.schema.js';

export const CandidateSourceLicenseStatusSchema = z.enum(['unverified', 'verified', 'rejected']);

/** Metadata-only acquisition lead. It is never a corpus case or an answer key. */
export const CorpusCandidateSchema = z.strictObject({
  candidateId: IdentifierSchema,
  sourceRecordId: IdentifierSchema,
  repositoryUrl: z.url(),
  vulnerableRevision: z.string().trim().min(1).max(160),
  patchedRevision: z.string().trim().min(1).max(160),
  metadataPath: RelativePathSchema,
  metadataDigest: Sha256Schema,
  sourceLicenseStatus: CandidateSourceLicenseStatusSchema,
});

export const CorpusCandidateRegistrySchema = z
  .strictObject({
    schemaVersion: SchemaVersion,
    registryId: IdentifierSchema,
    source: CorpusDatasetSchema,
    candidates: z.array(CorpusCandidateSchema).min(1),
    registryDigest: Sha256Schema,
  })
  .superRefine((registry, context) => {
    const candidateIds = new Set<string>();
    const repositories = new Set<string>();
    for (const candidate of registry.candidates) {
      if (candidateIds.has(candidate.candidateId)) {
        context.addIssue({
          code: 'custom',
          message: 'Candidate ids must be unique.',
          path: ['candidates'],
        });
      }
      candidateIds.add(candidate.candidateId);
      const repository = normalizeRepositoryUrl(candidate.repositoryUrl);
      if (repositories.has(repository)) {
        context.addIssue({
          code: 'custom',
          message: 'Candidates must be repository-distinct.',
          path: ['candidates'],
        });
      }
      repositories.add(repository);
    }
    const ids = registry.candidates.map((candidate) => candidate.candidateId);
    if (ids.some((id, index) => index > 0 && (ids[index - 1]?.localeCompare(id) ?? -1) >= 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Candidates must be ordered by candidate id.',
        path: ['candidates'],
      });
    }
  });

export const CandidateSourceVerificationSchema = z.strictObject({
  registryId: IdentifierSchema,
  sourceRevision: z.string().trim().min(1).max(160),
  checkedCandidates: z.int().nonnegative(),
  verifiedCandidates: z.int().nonnegative(),
});

export type CorpusCandidateRegistry = z.infer<typeof CorpusCandidateRegistrySchema>;
export type CandidateSourceVerification = z.infer<typeof CandidateSourceVerificationSchema>;

export function normalizeRepositoryUrl(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\.git$/i, '').toLowerCase()}`;
}
