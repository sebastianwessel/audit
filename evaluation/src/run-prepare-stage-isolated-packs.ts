import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import { loadCorpusPack } from './corpus.js';
import { StageIsolatedDiagnosticPackRegistrySchema } from './stage-isolated-diagnostic-pack.schema.js';
import { prepareStageIsolatedDiagnosticPack } from './stage-isolated-pack-preparation.js';
import { resolveStageIsolatedDiagnosticPath } from './stage-isolated-pack-registry.js';
import { StageIsolatedPreparedDiagnosticPackSchema } from './stage-semantic-pack.schema.js';

const usage = 'Usage: bun run eval:stage-isolated:prepare --write';

/** Contributor-only resealing of source-pinned diagnostic packs; never calls a provider. */
export async function runPrepareStageIsolatedPacksCommand(
  argv: readonly string[],
): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (argv.length !== 1 || argv[0] !== '--write') {
    throw new AuditRuntimeError('invalid-input', usage);
  }
  const dataRoot = resolve('evaluation/data');
  const registry = StageIsolatedDiagnosticPackRegistrySchema.parse(
    JSON.parse(
      await readFile(
        resolveStageIsolatedDiagnosticPath(dataRoot, 'stage-isolated/registry.json'),
        'utf8',
      ),
    ),
  );
  let changed = 0;
  for (const descriptor of registry.packs) {
    const packPath = resolveStageIsolatedDiagnosticPath(
      dataRoot,
      `stage-isolated/${descriptor.semanticPackPath}`,
    );
    const metadata = await lstat(packPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'A stage-isolated diagnostic pack must be an existing regular file.',
      );
    }
    const existingText = await readFile(packPath, 'utf8');
    const existingPack = StageIsolatedPreparedDiagnosticPackSchema.parse(JSON.parse(existingText));
    const corpus = await loadCorpusPack(
      resolveStageIsolatedDiagnosticPath(dataRoot, descriptor.corpusRoot),
    );
    const loadedCase = corpus.cases.find((entry) => entry.case.caseId === descriptor.caseId);
    if (loadedCase === undefined) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'A stage-isolated diagnostic pack does not select a corpus case.',
      );
    }
    const prepared = await prepareStageIsolatedDiagnosticPack({
      descriptor,
      corpus,
      loadedCase,
      existingPack,
    });
    const nextText = `${JSON.stringify(prepared, null, 2)}\n`;
    if (nextText === existingText) continue;
    await writeRegularFileAtomically(packPath, nextText);
    changed += 1;
  }
  process.stdout.write(`Resealed ${changed} stage-isolated diagnostic pack(s).\n`);
  return 0;
}

async function writeRegularFileAtomically(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runPrepareStageIsolatedPacksCommand(Bun.argv.slice(2));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected stage-isolated preparation failure.';
    process.stderr.write(`audit stage-isolated preparation: ${message}\n`);
    process.exitCode = 2;
  }
}
