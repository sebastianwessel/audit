import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { loadCorpusPack } from './corpus.js';
import { StageIsolatedDiagnosticPackRegistrySchema } from './stage-isolated-diagnostic-pack.schema.js';
import { prepareStageIsolatedDiagnosticPack } from './stage-isolated-pack-preparation.js';
import {
  assertStageIsolatedDiagnosticPackBinding,
  loadStageIsolatedDiagnosticPackRegistry,
} from './stage-isolated-pack-registry.js';
import { StageIsolatedPreparedDiagnosticPackSchema } from './stage-semantic-pack.schema.js';

test('loads the four source-pinned diagnostic packs without constructing a provider', async () => {
  const registry = await loadStageIsolatedDiagnosticPackRegistry('evaluation/data');
  expect(registry.packs.map((pack) => pack.diagnosticId).sort()).toEqual([
    'codeql-grounding',
    'decamelize-planning',
    'juliet-verification',
    'openssf-map',
  ]);
  expect(registry.packs.every((pack) => pack.qualification === 'diagnostic')).toBe(true);
});

test('rejects sealed protocol and stage drift before any provider can be constructed', async () => {
  const registry = StageIsolatedDiagnosticPackRegistrySchema.parse(
    JSON.parse(await readFile('evaluation/data/stage-isolated/registry.json', 'utf8')),
  );
  const descriptor = registry.packs[0];
  if (descriptor === undefined) throw new Error('Expected a diagnostic pack.');
  const preparedPack = StageIsolatedPreparedDiagnosticPackSchema.parse(
    JSON.parse(
      await readFile(`evaluation/data/stage-isolated/${descriptor.semanticPackPath}`, 'utf8'),
    ),
  );
  const binding = {
    descriptor,
    corpus: {
      packId: descriptor.corpusPackId,
      packVersion: descriptor.corpusPackVersion,
      manifestDigest: descriptor.corpusManifestFingerprint,
    },
    sourceDigest: descriptor.corpusSourceDigest,
    preparedPack,
    canonicalInputFingerprint: preparedPack.canonicalInputFingerprint,
  };
  expect(() => assertStageIsolatedDiagnosticPackBinding(binding)).not.toThrow();
  expect(() =>
    assertStageIsolatedDiagnosticPackBinding({
      ...binding,
      preparedPack: {
        ...preparedPack,
        pack: { ...preparedPack.pack, stageProtocolFingerprint: '0'.repeat(64) },
      },
    }),
  ).toThrow('sealed corpus, protocol, or canonical input');
  expect(() =>
    assertStageIsolatedDiagnosticPackBinding({
      ...binding,
      descriptor: { ...descriptor, stage: 'planning', planProfile: 'planning-generated' },
    }),
  ).toThrow('sealed corpus, protocol, or canonical input');
});

test('rejects a prepared pack if someone adds a fabricated product result', async () => {
  const raw = JSON.parse(
    await readFile('evaluation/data/stage-isolated/packs/openssf-map.json', 'utf8'),
  );
  expect(() =>
    StageIsolatedPreparedDiagnosticPackSchema.parse({
      ...raw,
      productStageOutput: {},
    }),
  ).toThrow();
});

test('reseals only derived diagnostic-pack identities from the canonical fixture', async () => {
  const registry = StageIsolatedDiagnosticPackRegistrySchema.parse(
    JSON.parse(await readFile('evaluation/data/stage-isolated/registry.json', 'utf8')),
  );
  const descriptor = registry.packs[0];
  if (descriptor === undefined) throw new Error('Expected a diagnostic pack.');
  const existingPack = StageIsolatedPreparedDiagnosticPackSchema.parse(
    JSON.parse(
      await readFile(`evaluation/data/stage-isolated/${descriptor.semanticPackPath}`, 'utf8'),
    ),
  );
  const corpus = await loadCorpusPack(`evaluation/data/${descriptor.corpusRoot}`);
  const loadedCase = corpus.cases.find((entry) => entry.case.caseId === descriptor.caseId);
  if (loadedCase === undefined) throw new Error('Expected the selected corpus case.');
  const prepared = await prepareStageIsolatedDiagnosticPack({
    descriptor,
    corpus,
    loadedCase,
    existingPack: {
      ...existingPack,
      pack: { ...existingPack.pack, workflowProtocolFingerprint: '0'.repeat(64) },
    },
  });
  expect(prepared.rubric).toEqual(existingPack.rubric);
  expect(prepared.pack.workflowProtocolFingerprint).not.toBe('0'.repeat(64));
  expect(prepared.canonicalInputFingerprint).toBe(prepared.pack.productInput.fingerprint);
});
