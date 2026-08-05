import { copyFile, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { sha256 } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import { contextRoot, loadCorpusPack, variantRoot } from './corpus.js';
import {
  CorpusImportRequestSchema,
  type ImportedCorpusManifest,
  ImportedCorpusManifestSchema,
} from './corpus.schema.js';

/** Copies a fully validated, already-local corpus pack. It never performs network I/O or overwrites output. */
export async function importCorpusPack(input: {
  sourceRoot: string;
  outputRoot: string;
  importedAt: string;
}): Promise<ImportedCorpusManifest> {
  const request = CorpusImportRequestSchema.parse(input);
  const outputRoot = resolve(request.outputRoot);
  if (await exists(outputRoot))
    throw importError('Output root already exists; imports never overwrite data.');
  const pack = await loadCorpusPack(request.sourceRoot);
  if (pack.manifest.redistributionDecision !== 'source-included-with-license') {
    throw importError('This pack does not permit copying source into an imported corpus.');
  }
  const temporaryRoot = join(dirname(outputRoot), `.${basename(outputRoot)}.importing`);
  if (await exists(temporaryRoot))
    throw importError('A previous temporary import directory already exists.');
  try {
    await mkdir(temporaryRoot, { recursive: false });
    const selected = await selectedFiles(pack.root, pack);
    const content = [];
    for (const sourcePath of selected) {
      const relativePath = relative(pack.root, sourcePath).replaceAll('\\', '/');
      const destination = join(temporaryRoot, ...relativePath.split('/'));
      await mkdir(dirname(destination), { recursive: true });
      await copySafeFile(sourcePath, destination);
      content.push({ relativePath, digest: sha256(await readFile(sourcePath)) });
    }
    const manifest = ImportedCorpusManifestSchema.parse({
      schemaVersion: 1,
      packId: pack.manifest.packId,
      packVersion: pack.manifest.packVersion,
      sourceManifestDigest: pack.manifest.manifestDigest,
      importedAt: request.importedAt,
      content: content.sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
    });
    await writeFile(
      join(temporaryRoot, 'import-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryRoot, outputRoot);
    return manifest;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function selectedFiles(
  root: string,
  pack: Awaited<ReturnType<typeof loadCorpusPack>>,
): Promise<string[]> {
  const selected = new Set<string>([join(root, 'manifest.json')]);
  for (const loaded of pack.cases) {
    selected.add(join(root, ...loaded.case.answerKeyPath.split('/')));
    selected.add(join(root, ...loaded.case.reviewedPlanPath.split('/')));
    for (const variant of ['vulnerable', 'patched', 'benign'] as const) {
      if (loaded.case.sourceDirectories[variant] !== undefined) {
        for (const path of await filesInDirectory(variantRoot(pack, loaded.case, variant))) {
          selected.add(path);
        }
      }
    }
    const context = contextRoot(pack, loaded.case);
    if (context !== undefined) {
      for (const path of await filesInDirectory(context)) selected.add(path);
    }
  }
  return [...selected].sort((left, right) => left.localeCompare(right));
}

async function filesInDirectory(directory: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const path = join(current, entry.name);
      const status = await lstat(path);
      if (status.isSymbolicLink()) throw importError('Corpus import rejects symbolic links.');
      if (status.isDirectory()) await visit(path);
      else if (status.isFile()) files.push(path);
    }
  };
  await visit(directory);
  return files;
}

async function copySafeFile(source: string, destination: string): Promise<void> {
  const status = await lstat(source);
  if (!status.isFile() || status.isSymbolicLink())
    throw importError('Corpus import accepts regular files only.');
  await copyFile(source, destination);
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => undefined)) !== undefined;
}

function importError(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `Invalid offline corpus import: ${message}`);
}
