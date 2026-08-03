import { expect, test } from 'bun:test';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { corpusManifestDigest } from './corpus.js';
import { CorpusPackManifestSchema } from './corpus.schema.js';
import { importCorpusPack } from './importer.js';

test('imports only a validated local corpus pack and writes a content manifest', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'security-reviewer-import-'));
  const outputRoot = join(parent, 'imported-pack');
  const imported = await importCorpusPack({
    sourceRoot: 'evaluation/corpora',
    outputRoot,
    importedAt: '2026-07-28T12:00:00.000Z',
  });
  expect(imported.content.length).toBeGreaterThan(3);
  expect(JSON.parse(await readFile(join(outputRoot, 'import-manifest.json'), 'utf8')).packId).toBe(
    'security-reviewer-real-world-seed',
  );
  expect(
    await readFile(join(outputRoot, 'reviewed-plans', 'ossf-cve-2018-16492.json'), 'utf8'),
  ).toContain('ossf-cve-2018-16492');
  await expect(
    importCorpusPack({
      sourceRoot: 'evaluation/corpora',
      outputRoot,
      importedAt: '2026-07-28T12:00:00.000Z',
    }),
  ).rejects.toThrow('never overwrite');
});

test('refuses a local pack whose redistribution decision disallows source copying', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'security-reviewer-import-denied-'));
  const sourceRoot = join(parent, 'source-pack');
  await cp('evaluation/corpora', sourceRoot, { recursive: true });
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
