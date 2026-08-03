import { expect, test } from 'bun:test';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../../shared/contracts/core.js';

import {
  candidateRegistryDigest,
  loadCandidateRegistry,
  verifyCandidateMetadataSource,
  verifyCweBenchJavaCandidateSource,
  verifyOpenSsfCandidateSource,
  verifyOsvCandidateSource,
} from './candidate-registry.js';
import { CorpusCandidateRegistrySchema } from './candidate-registry.schema.js';

test('loads the checked-in OpenSSF candidate registry without treating it as an evaluation corpus', async () => {
  const registry = await loadCandidateRegistry(
    'evaluation/candidates/openssf-candidate-pilot.json',
  );
  expect(registry.candidates).toHaveLength(30);
  expect(
    registry.candidates.every((candidate) => candidate.sourceLicenseStatus === 'unverified'),
  ).toBe(true);
  expect(
    registry.candidates.every(
      (candidate) => !('sourceSnapshotStatus' in candidate) && !('adjudicationState' in candidate),
    ),
  ).toBe(true);
});

test('loads the checked-in CWE-Bench-Java registry as metadata-only acquisition input', async () => {
  const registry = await loadCandidateRegistry(
    'evaluation/candidates/cwe-bench-java-candidate-pilot.json',
  );
  expect(registry.candidates).toHaveLength(12);
  expect(
    registry.candidates.every(
      (candidate) => !('sourceSnapshotStatus' in candidate) && !('adjudicationState' in candidate),
    ),
  ).toBe(true);
});

test('rejects retired acquisition and adjudication state from a candidate registry', async () => {
  const registry = await loadCandidateRegistry(
    'evaluation/candidates/openssf-candidate-pilot.json',
  );
  const candidate = registry.candidates.at(0);
  if (candidate === undefined) throw new Error('Expected a checked-in candidate.');
  expect(
    CorpusCandidateRegistrySchema.safeParse({
      ...registry,
      candidates: [
        {
          ...candidate,
          sourceSnapshotStatus: 'not-fetched',
          adjudicationState: 'not-started',
        },
      ],
    }).success,
  ).toBe(false);
});

test('loads the checked-in OSV Python registry only after its Git pair is locally verified', async () => {
  const registry = await loadCandidateRegistry(
    'evaluation/candidates/osv-python-candidate-pilot.json',
  );
  expect(registry.candidates).toHaveLength(1);
  await expect(
    verifyOsvCandidateSource({ registry, sourceRoot: 'evaluation/acquisition-metadata' }),
  ).resolves.toMatchObject({ verifiedCandidates: 1 });
});

test('validates a CWE-Bench-Java candidate against its pinned CSV record', async () => {
  const root = join(tmpdir(), `security-reviewer-cwe-candidates-${crypto.randomUUID()}`);
  await mkdir(join(root, 'data'), { recursive: true });
  const metadata = [
    'id,project_slug,cve_id,cwe_id,cwe_name,github_username,github_repository_name,github_tag,github_url,advisory_id,buggy_commit_id,fix_commit_ids',
    '1,example__project_CVE-2026-1111,CVE-2026-1111,CWE-22,Path traversal,example,project,1.0.0,https://github.com/example/project,GHSA-test,before,after',
  ].join('\n');
  await writeFile(join(root, 'data', 'project_info.csv'), metadata, 'utf8');
  const unsigned = {
    schemaVersion: 1 as const,
    registryId: 'cwe-candidate-test',
    source: {
      datasetId: 'cwe-bench-java',
      title: 'CWE-Bench-Java',
      sourceUrl: 'https://github.com/iris-sast/cwe-bench-java',
      revision: 'pinned',
      license: 'MIT',
      retrievedAt: '2026-07-31T08:00:00.000Z',
      attribution: 'Test metadata.',
    },
    candidates: [
      {
        candidateId: 'cwe-candidate-2026-1111',
        sourceRecordId: 'cve-2026-1111',
        repositoryUrl: 'https://github.com/example/project',
        vulnerableRevision: 'before',
        patchedRevision: 'after',
        metadataPath: 'data/project_info.csv',
        metadataDigest: sha256(metadata),
        sourceLicenseStatus: 'unverified' as const,
      },
    ],
  };
  const registryPath = join(root, 'registry.json');
  await writeFile(
    registryPath,
    JSON.stringify({ ...unsigned, registryDigest: candidateRegistryDigest(unsigned) }),
    'utf8',
  );
  const registry = await loadCandidateRegistry(registryPath);
  await expect(
    verifyCweBenchJavaCandidateSource({ registry, sourceRoot: root }),
  ).resolves.toMatchObject({ verifiedCandidates: 1 });
  const firstCandidate = registry.candidates.at(0);
  if (firstCandidate === undefined) throw new Error('Expected a CWE-Bench-Java candidate.');
  const mismatched = {
    ...registry,
    candidates: [{ ...firstCandidate, patchedRevision: 'other' }],
  };
  await expect(
    verifyCweBenchJavaCandidateSource({ registry: mismatched, sourceRoot: root }),
  ).rejects.toThrow('does not match');
});

test('validates a pinned local metadata source and rejects a changed candidate record', async () => {
  const root = join(tmpdir(), `security-reviewer-candidates-${crypto.randomUUID()}`);
  const metadataPath = join(root, 'CVEs', 'CVE-2026-1234.json');
  await mkdir(join(root, 'CVEs'), { recursive: true });
  const metadata = JSON.stringify({
    CVE: 'CVE-2026-1234',
    state: 'PUBLISHED',
    repository: 'https://github.com/example/project.git',
    prePatch: {
      commit: 'before',
      weaknesses: [
        { location: { file: 'src/a.txt', line: 1 }, explanation: 'Recorded upstream metadata.' },
      ],
    },
    postPatch: { commit: 'after' },
    CWEs: ['CWE-20'],
  });
  await writeFile(metadataPath, metadata, 'utf8');
  const unsigned = {
    schemaVersion: 1 as const,
    registryId: 'candidate-test',
    source: {
      datasetId: 'test-source',
      title: 'Test source',
      sourceUrl: 'https://example.test/source',
      revision: 'pinned',
      license: 'MIT',
      retrievedAt: '2026-07-29T00:00:00.000Z',
      attribution: 'Test metadata.',
    },
    candidates: [
      {
        candidateId: 'candidate-2026-1234',
        sourceRecordId: 'cve-2026-1234',
        repositoryUrl: 'https://github.com/example/project',
        vulnerableRevision: 'before',
        patchedRevision: 'after',
        metadataPath: 'CVEs/CVE-2026-1234.json',
        metadataDigest: sha256(metadata),
        sourceLicenseStatus: 'unverified' as const,
      },
    ],
  };
  const registryPath = join(root, 'registry.json');
  await writeFile(
    registryPath,
    JSON.stringify({ ...unsigned, registryDigest: candidateRegistryDigest(unsigned) }),
    'utf8',
  );
  const registry = await loadCandidateRegistry(registryPath);
  await expect(
    verifyCandidateMetadataSource({ registry, sourceRoot: root }),
  ).resolves.toMatchObject({ verifiedCandidates: 1 });
  await expect(verifyOpenSsfCandidateSource({ registry, sourceRoot: root })).resolves.toMatchObject(
    { verifiedCandidates: 1 },
  );
  await writeFile(metadataPath, `${metadata}\n`, 'utf8');
  await expect(verifyOpenSsfCandidateSource({ registry, sourceRoot: root })).rejects.toThrow(
    'digest',
  );
});

test('requires an OSV record to bind the exact adjacent Git revision pair', async () => {
  const root = join(tmpdir(), `security-reviewer-osv-candidates-${crypto.randomUUID()}`);
  await mkdir(join(root, 'osv'), { recursive: true });
  const metadata = JSON.stringify({
    id: 'CVE-2026-3333',
    affected: [
      {
        ranges: [
          {
            type: 'GIT',
            repo: 'https://github.com/example/project.git',
            events: [{ introduced: 'before' }, { fixed: 'after' }],
          },
        ],
      },
    ],
    ignoredByAdapter: 'The strict adapter intentionally strips unneeded upstream fields.',
  });
  await writeFile(join(root, 'osv', 'CVE-2026-3333.json'), metadata, 'utf8');
  const unsigned = {
    schemaVersion: 1 as const,
    registryId: 'osv-candidate-test',
    source: {
      datasetId: 'osv-api',
      title: 'OSV API',
      sourceUrl: 'https://api.osv.dev/v1/vulns/CVE-2026-3333',
      revision: 'response-sha256-test',
      license: 'Metadata provenance only.',
      retrievedAt: '2026-07-31T08:00:00.000Z',
      attribution: 'Test metadata.',
    },
    candidates: [
      {
        candidateId: 'osv-candidate-2026-3333',
        sourceRecordId: 'cve-2026-3333',
        repositoryUrl: 'https://github.com/example/project',
        vulnerableRevision: 'before',
        patchedRevision: 'after',
        metadataPath: 'osv/CVE-2026-3333.json',
        metadataDigest: sha256(metadata),
        sourceLicenseStatus: 'unverified' as const,
      },
    ],
  };
  const registryPath = join(root, 'registry.json');
  await writeFile(
    registryPath,
    JSON.stringify({ ...unsigned, registryDigest: candidateRegistryDigest(unsigned) }),
    'utf8',
  );
  const registry = await loadCandidateRegistry(registryPath);
  await expect(verifyOsvCandidateSource({ registry, sourceRoot: root })).resolves.toMatchObject({
    verifiedCandidates: 1,
  });
  const candidate = registry.candidates.at(0);
  if (candidate === undefined) throw new Error('Expected OSV candidate fixture.');
  await expect(
    verifyOsvCandidateSource({
      registry: { ...registry, candidates: [{ ...candidate, patchedRevision: 'wrong' }] },
      sourceRoot: root,
    }),
  ).rejects.toThrow('exact OSV Git revision pair');
});

test('rejects malformed metadata and a symlinked metadata directory', async () => {
  const root = join(tmpdir(), `security-reviewer-candidate-jail-${crypto.randomUUID()}`);
  const outside = join(tmpdir(), `security-reviewer-candidate-outside-${crypto.randomUUID()}`);
  await mkdir(join(root, 'CVEs'), { recursive: true });
  await mkdir(outside, { recursive: true });
  const metadata = '{';
  await writeFile(join(root, 'CVEs', 'CVE-2026-2222.json'), metadata, 'utf8');
  const unsigned = {
    schemaVersion: 1 as const,
    registryId: 'candidate-jail-test',
    source: {
      datasetId: 'test-source',
      title: 'Test source',
      sourceUrl: 'https://example.test/source',
      revision: 'pinned',
      license: 'MIT',
      retrievedAt: '2026-07-29T00:00:00.000Z',
      attribution: 'Test metadata.',
    },
    candidates: [
      {
        candidateId: 'candidate-2026-2222',
        sourceRecordId: 'cve-2026-2222',
        repositoryUrl: 'https://github.com/example/project',
        vulnerableRevision: 'before',
        patchedRevision: 'after',
        metadataPath: 'CVEs/CVE-2026-2222.json',
        metadataDigest: sha256(metadata),
        sourceLicenseStatus: 'unverified' as const,
      },
    ],
  };
  const registryPath = join(root, 'registry.json');
  await writeFile(
    registryPath,
    JSON.stringify({ ...unsigned, registryDigest: candidateRegistryDigest(unsigned) }),
    'utf8',
  );
  const registry = await loadCandidateRegistry(registryPath);
  await expect(verifyOpenSsfCandidateSource({ registry, sourceRoot: root })).rejects.toThrow(
    'valid JSON',
  );
  await writeFile(join(outside, 'CVE-2026-2222.json'), '{}', 'utf8');
  await symlink(outside, join(root, 'escaped'), 'dir');
  const firstCandidate = registry.candidates.at(0);
  if (firstCandidate === undefined) throw new Error('Expected candidate fixture.');
  const escapedRegistry = {
    ...registry,
    candidates: [{ ...firstCandidate, metadataPath: 'escaped/CVE-2026-2222.json' }],
  };
  await expect(
    verifyOpenSsfCandidateSource({ registry: escapedRegistry, sourceRoot: root }),
  ).rejects.toThrow('escapes');
});
