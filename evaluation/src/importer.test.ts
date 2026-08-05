import { expect, test } from 'bun:test';
import { cp, lstat, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sha256 } from '../../src/shared/contracts/core.js';
import { corpusManifestDigest } from './corpus.js';
import { CorpusPackManifestSchema } from './corpus.schema.js';
import { importCorpusPack } from './importer.js';

test('imports only a validated local corpus pack and writes a content manifest', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'audit-import-'));
  const outputRoot = join(parent, 'imported-pack');
  const imported = await importCorpusPack({
    sourceRoot: 'evaluation/data/corpora',
    outputRoot,
    importedAt: '2026-07-28T12:00:00.000Z',
  });
  expect(imported.content.length).toBeGreaterThan(3);
  expect(JSON.parse(await readFile(join(outputRoot, 'import-manifest.json'), 'utf8')).packId).toBe(
    'audit-real-world-seed',
  );
  expect(
    await readFile(join(outputRoot, 'reviewed-plans', 'ossf-cve-2018-16492.json'), 'utf8'),
  ).toContain('ossf-cve-2018-16492');
  await expect(
    importCorpusPack({
      sourceRoot: 'evaluation/data/corpora',
      outputRoot,
      importedAt: '2026-07-28T12:00:00.000Z',
    }),
  ).rejects.toThrow('never overwrite');
});

test('refuses a local pack whose redistribution decision disallows source copying', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'audit-import-denied-'));
  const sourceRoot = join(parent, 'source-pack');
  await cp('evaluation/data/corpora', sourceRoot, { recursive: true });
  const manifestPath = join(sourceRoot, 'manifest.json');
  const original = CorpusPackManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const { manifestDigest: _manifestDigest, ...unsigned } = original;
  const denied = {
    ...unsigned,
    redistributionDecision: 'metadata-only' as const,
  };
  await writeFile(
    manifestPath,
    `${JSON.stringify({ ...denied, manifestDigest: corpusManifestDigest(denied) }, null, 2)}\n`,
    'utf8',
  );
  await expect(
    importCorpusPack({
      sourceRoot,
      outputRoot: join(parent, 'denied-output'),
      importedAt: '2026-07-28T12:00:00.000Z',
    }),
  ).rejects.toThrow('does not permit');
});

test('records imported content digests from exact source bytes', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'audit-import-raw-bytes-'));
  const sourceRoot = join(parent, 'source-pack');
  const outputRoot = join(parent, 'imported-pack');
  await cp('evaluation/data/corpora', sourceRoot, { recursive: true });
  const sourcePath = join(
    sourceRoot,
    'openssf-cve-benchmark-cve-2018-16492',
    'source',
    'vulnerable',
    'raw-byte.bin',
  );
  const rawBytes = new Uint8Array([0x80]);
  await writeFile(sourcePath, rawBytes);
  await updateOssfVulnerableDigest(sourceRoot);

  const imported = await importCorpusPack({
    sourceRoot,
    outputRoot,
    importedAt: '2026-08-03T12:00:00.000Z',
  });

  expect(imported.content).toContainEqual({
    relativePath: 'openssf-cve-benchmark-cve-2018-16492/source/vulnerable/raw-byte.bin',
    digest: sha256(rawBytes),
  });
  expect([
    ...(await readFile(
      join(
        outputRoot,
        'openssf-cve-benchmark-cve-2018-16492',
        'source',
        'vulnerable',
        'raw-byte.bin',
      ),
    )),
  ]).toEqual([...rawBytes]);
});

async function updateOssfVulnerableDigest(root: string): Promise<void> {
  const manifestPath = join(root, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const ossfCase = manifest.cases.find(
    (entry: { caseId: string }) => entry.caseId === 'ossf-cve-2018-16492',
  );
  if (ossfCase === undefined) throw new Error('Expected pinned OpenSSF fixture.');
  const sourceDigests = {
    ...ossfCase.sourceDigests,
    vulnerable: await rawDirectoryDigest(join(root, ossfCase.sourceDirectories.vulnerable)),
  };
  const transformedContentDigest = sha256(
    (['vulnerable', 'patched', 'benign'] as const)
      .flatMap((variant) => {
        const digest = sourceDigests[variant];
        return digest === undefined ? [] : [`${variant}\0${digest}`];
      })
      .join('\n'),
  );
  const cases = manifest.cases.map((entry: { caseId: string }) =>
    entry.caseId === ossfCase.caseId
      ? { ...entry, sourceDigests, transformedContentDigest }
      : entry,
  );
  const { manifestDigest: _manifestDigest, ...unsignedManifest } = { ...manifest, cases };
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      { ...unsignedManifest, manifestDigest: corpusManifestDigest(unsignedManifest) },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

async function rawDirectoryDigest(root: string): Promise<string> {
  const records: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(directory, entry.name);
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const status = await lstat(path);
      if (status.isDirectory()) {
        await visit(path, relativePath);
      } else if (status.isFile()) {
        records.push(`${relativePath}\0${sha256(await readFile(path))}`);
      }
    }
  };
  await visit(root, '');
  return sha256(records.join('\n'));
}
