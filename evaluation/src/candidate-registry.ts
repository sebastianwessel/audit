import { lstat, readFile, realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { z } from 'zod';

import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import {
  type CandidateSourceVerification,
  CandidateSourceVerificationSchema,
  type CorpusCandidateRegistry,
  CorpusCandidateRegistrySchema,
  normalizeRepositoryUrl,
} from './candidate-registry.schema.js';

export async function loadCandidateRegistry(path: string): Promise<CorpusCandidateRegistry> {
  const parsed = CorpusCandidateRegistrySchema.safeParse(await parseJson(path));
  if (!parsed.success) throw candidateError('Candidate registry schema is invalid.');
  const { registryDigest, ...unsigned } = parsed.data;
  if (candidateRegistryDigest(unsigned) !== registryDigest) {
    throw candidateError('Candidate registry digest does not match its content.');
  }
  return parsed.data;
}

export function candidateRegistryDigest(
  registry: Omit<CorpusCandidateRegistry, 'registryDigest'>,
): string {
  return sha256(canonicalJson(registry));
}

/**
 * Validates only referenced metadata files from an already-local pinned
 * dataset checkout. It never fetches or reads a candidate target repository.
 */
export async function verifyCandidateMetadataSource(input: {
  registry: CorpusCandidateRegistry;
  sourceRoot: string;
}): Promise<CandidateSourceVerification> {
  await readVerifiedCandidateMetadata(input);
  return verifiedCandidateSummary(input);
}

/** Validates OpenSSF metadata fields after the generic local-file integrity boundary. */
export async function verifyOpenSsfCandidateSource(input: {
  registry: CorpusCandidateRegistry;
  sourceRoot: string;
}): Promise<CandidateSourceVerification> {
  const metadataFiles = await readVerifiedCandidateMetadata(input);
  for (const candidate of input.registry.candidates) {
    const raw = metadataFiles.get(candidate.metadataPath);
    if (raw === undefined)
      throw candidateError(`Candidate metadata is missing: ${candidate.candidateId}.`);
    const metadata = OpenSsfMetadataSchema.safeParse(
      parseCandidateMetadata(raw, candidate.candidateId),
    );
    if (!metadata.success)
      throw candidateError(`Candidate metadata is invalid: ${candidate.candidateId}.`);
    if (
      metadata.data.state !== 'PUBLISHED' ||
      metadata.data.CVE.toLowerCase() !== candidate.sourceRecordId ||
      normalizeRepositoryUrl(metadata.data.repository) !==
        normalizeRepositoryUrl(candidate.repositoryUrl) ||
      metadata.data.prePatch.commit !== candidate.vulnerableRevision ||
      metadata.data.postPatch.commit !== candidate.patchedRevision
    ) {
      throw candidateError(
        `Candidate metadata does not match its registry entry: ${candidate.candidateId}.`,
      );
    }
  }
  return verifiedCandidateSummary(input);
}

/** Validates CWE-Bench-Java lead bindings after the generic local-file integrity boundary. */
export async function verifyCweBenchJavaCandidateSource(input: {
  registry: CorpusCandidateRegistry;
  sourceRoot: string;
}): Promise<CandidateSourceVerification> {
  const metadataFiles = await readVerifiedCandidateMetadata(input);
  for (const candidate of input.registry.candidates) {
    const raw = metadataFiles.get(candidate.metadataPath);
    if (raw === undefined)
      throw candidateError(`Candidate metadata is missing: ${candidate.candidateId}.`);
    const records = parseCsvRecords(raw, candidate.metadataPath);
    const matching = records.some(
      (record) =>
        record.cve_id?.toLowerCase() === candidate.sourceRecordId &&
        record.github_username !== undefined &&
        record.github_repository_name !== undefined &&
        normalizeRepositoryUrl(
          `https://github.com/${record.github_username}/${record.github_repository_name}`,
        ) === normalizeRepositoryUrl(candidate.repositoryUrl) &&
        record.buggy_commit_id === candidate.vulnerableRevision &&
        record.fix_commit_ids?.split(';').includes(candidate.patchedRevision),
    );
    if (!matching) {
      throw candidateError(
        `Candidate metadata does not match its registry entry: ${candidate.candidateId}.`,
      );
    }
  }
  return verifiedCandidateSummary(input);
}

/**
 * Validates an OSV Git-range record without interpreting its vulnerability
 * details, category, source text, or fix semantics. A candidate is eligible
 * only when its exact repository and adjacent introduced/fixed revision pair
 * are present in the pinned metadata record.
 */
export async function verifyOsvCandidateSource(input: {
  registry: CorpusCandidateRegistry;
  sourceRoot: string;
}): Promise<CandidateSourceVerification> {
  const metadataFiles = await readVerifiedCandidateMetadata(input);
  for (const candidate of input.registry.candidates) {
    const raw = metadataFiles.get(candidate.metadataPath);
    if (raw === undefined)
      throw candidateError(`Candidate metadata is missing: ${candidate.candidateId}.`);
    const metadata = OsvVulnerabilityMetadataSchema.safeParse(
      parseCandidateMetadata(raw, candidate.candidateId),
    );
    if (!metadata.success)
      throw candidateError(`Candidate metadata is invalid: ${candidate.candidateId}.`);
    const matchingRange = metadata.data.affected
      .flatMap((affected) => affected.ranges)
      .find(
        (range) =>
          range.type === 'GIT' &&
          normalizeRepositoryUrl(range.repo) === normalizeRepositoryUrl(candidate.repositoryUrl) &&
          hasExactOsvRevisionPair(
            range.events,
            candidate.vulnerableRevision,
            candidate.patchedRevision,
          ),
      );
    if (
      metadata.data.id.toLowerCase() !== candidate.sourceRecordId ||
      matchingRange === undefined
    ) {
      throw candidateError(
        `Candidate metadata does not bind its exact OSV Git revision pair: ${candidate.candidateId}.`,
      );
    }
  }
  return verifiedCandidateSummary(input);
}

async function readVerifiedCandidateMetadata(input: {
  registry: CorpusCandidateRegistry;
  sourceRoot: string;
}): Promise<ReadonlyMap<string, string>> {
  const root = await realpath(resolve(input.sourceRoot)).catch(() => undefined);
  if (root === undefined) throw candidateError('Source root is unavailable.');
  const files = new Map<string, string>();
  for (const candidate of input.registry.candidates) {
    const existing = files.get(candidate.metadataPath);
    if (existing !== undefined) {
      if (sha256(existing) !== candidate.metadataDigest) {
        throw candidateError(`Metadata digest is inconsistent: ${candidate.metadataPath}.`);
      }
      continue;
    }
    const metadataPath = resolve(root, candidate.metadataPath);
    if (relative(root, metadataPath).startsWith('..'))
      throw candidateError('Metadata path escapes its source root.');
    const stat = await lstat(metadataPath).catch(() => undefined);
    if (stat === undefined || !stat.isFile() || stat.isSymbolicLink()) {
      throw candidateError(`Candidate metadata is not a regular file: ${candidate.candidateId}.`);
    }
    const canonicalMetadataPath = await realpath(metadataPath).catch(() => undefined);
    if (
      canonicalMetadataPath === undefined ||
      relative(root, canonicalMetadataPath).startsWith('..')
    ) {
      throw candidateError(`Candidate metadata escapes its source root: ${candidate.candidateId}.`);
    }
    const raw = await readFile(canonicalMetadataPath, 'utf8');
    if (sha256(raw) !== candidate.metadataDigest) {
      throw candidateError(`Candidate metadata digest does not match: ${candidate.candidateId}.`);
    }
    files.set(candidate.metadataPath, raw);
  }
  return files;
}

function parseCandidateMetadata(raw: string, candidateId: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw candidateError(`Candidate metadata is not valid JSON: ${candidateId}.`);
  }
}

function parseCsvRecords(
  raw: string,
  metadataPath: string,
): readonly Readonly<Record<string, string>>[] {
  const rows = parseCsvRows(raw, metadataPath);
  const header = rows[0];
  if (header === undefined || header.length === 0)
    throw candidateError(`CSV metadata is empty: ${metadataPath}.`);
  if (new Set(header).size !== header.length)
    throw candidateError(`CSV metadata has duplicate columns: ${metadataPath}.`);
  return rows.slice(1).map((row, index) => {
    if (row.length !== header.length)
      throw candidateError(`CSV metadata has an incomplete row ${index + 2}: ${metadataPath}.`);
    return Object.fromEntries(
      header.map((column, columnIndex) => [column, row[columnIndex] ?? '']),
    );
  });
}

function parseCsvRows(raw: string, metadataPath: string): readonly (readonly string[])[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === undefined) continue;
    if (quoted) {
      if (character === '"') {
        if (raw[index + 1] === '"') {
          value += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') {
      if (value.length > 0)
        throw candidateError(`CSV metadata has an invalid quote: ${metadataPath}.`);
      quoted = true;
      continue;
    }
    if (character === ',') {
      row.push(value);
      value = '';
      continue;
    }
    if (character === '\n') {
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }
    if (character !== '\r') value += character;
  }
  if (quoted) throw candidateError(`CSV metadata has an unterminated quote: ${metadataPath}.`);
  if (row.length > 0 || value.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function verifiedCandidateSummary(input: {
  registry: CorpusCandidateRegistry;
}): CandidateSourceVerification {
  return CandidateSourceVerificationSchema.parse({
    registryId: input.registry.registryId,
    sourceRevision: input.registry.source.revision,
    checkedCandidates: input.registry.candidates.length,
    verifiedCandidates: input.registry.candidates.length,
  });
}

const OpenSsfMetadataSchema = z.strictObject({
  CVE: z.string().regex(/^CVE-\d{4}-\d+$/),
  state: z.string(),
  repository: z.url(),
  prePatch: z.strictObject({
    commit: z.string().trim().min(1).max(160),
    weaknesses: z
      .array(
        z.strictObject({
          location: z.strictObject({
            file: z.string(),
            line: z.int().positive(),
          }),
          explanation: z.string(),
        }),
      )
      .min(1),
  }),
  postPatch: z.strictObject({
    commit: z.string().trim().min(1).max(160),
  }),
  CWEs: z.array(z.string()).min(1),
});

const OsvGitRangeEventSchema = z
  .object({
    introduced: z.string().trim().min(1).max(160).optional(),
    fixed: z.string().trim().min(1).max(160).optional(),
    last_affected: z.string().trim().min(1).max(160).optional(),
    limit: z.string().trim().min(1).max(160).optional(),
  })
  .strip()
  .refine(
    (event) =>
      event.introduced !== undefined ||
      event.fixed !== undefined ||
      event.last_affected !== undefined ||
      event.limit !== undefined,
    { message: 'OSV Git range events require one recognized boundary.' },
  );

const OsvVulnerabilityMetadataSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    affected: z
      .array(
        z
          .object({
            ranges: z
              .array(
                z
                  .object({
                    type: z.string().trim().min(1).max(32),
                    repo: z.url(),
                    events: z.array(OsvGitRangeEventSchema).min(1),
                  })
                  .strip(),
              )
              .min(1),
          })
          .strip(),
      )
      .min(1),
  })
  .strip();

function hasExactOsvRevisionPair(
  events: readonly z.output<typeof OsvGitRangeEventSchema>[],
  vulnerableRevision: string,
  patchedRevision: string,
): boolean {
  return events.some(
    (event, index) =>
      event.introduced === vulnerableRevision && events[index + 1]?.fixed === patchedRevision,
  );
}

async function parseJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw candidateError(`Cannot parse candidate registry ${path}.`);
  }
}

function candidateError(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `Invalid corpus candidate registry: ${message}`);
}
