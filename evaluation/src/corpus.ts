import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import {
  type CorpusAnswerKey,
  CorpusAnswerKeySchema,
  type CorpusCase,
  type CorpusPackManifest,
  CorpusPackManifestSchema,
  type ReviewedPlanFixture,
  ReviewedPlanFixtureSchema,
} from './corpus.schema.js';

export type LoadedCorpusCase = Readonly<{
  case: CorpusCase;
  answerKey: CorpusAnswerKey;
  reviewedPlan: ReviewedPlanFixture;
}>;
export type LoadedCorpusPack = Readonly<{
  root: string;
  manifest: CorpusPackManifest;
  cases: readonly LoadedCorpusCase[];
}>;

/**
 * The deterministic conformance provider may exercise audit-reviewed-plan workflow
 * wiring, but it must never receive evaluator answer keys. Keep this narrower
 * projection separate from the loaded corpus rather than relying on the
 * fixture implementation to ignore scoring data.
 */
export type DeterministicCorpusFixturePack = Readonly<{
  cases: readonly Readonly<{
    case: Pick<CorpusCase, 'caseId' | 'split' | 'sourceDirectories'>;
    reviewedPlan: ReviewedPlanFixture;
  }>[];
}>;

/**
 * Minimal evaluator-owned input for a non-scoring provider smoke. It
 * deliberately excludes every answer-key shape and never opens its path.
 */
export type LoadedCorpusSmokeCase = Readonly<{
  root: string;
  manifest: CorpusPackManifest;
  case: CorpusCase;
  reviewedPlan: ReviewedPlanFixture;
  variant: 'vulnerable' | 'patched' | 'benign';
  targetRoot: string;
  contextRoot: string | undefined;
}>;

/** Loads trusted evaluator data and validates every claimed digest before any agent view is created. */
export async function loadCorpusPack(root: string): Promise<LoadedCorpusPack> {
  const canonicalRoot = await canonicalDirectory(root, 'Corpus root');
  const manifest = CorpusPackManifestSchema.parse(
    await readCorpusJson(canonicalRoot, 'manifest.json'),
  );
  const { manifestDigest: _manifestDigest, ...unsignedManifest } = manifest;
  const expectedManifestDigest = corpusManifestDigest(unsignedManifest);
  if (manifest.manifestDigest !== expectedManifestDigest) {
    throw corpusError('Corpus manifest digest does not match its content.');
  }

  const datasetIds = new Set(manifest.datasets.map((dataset) => dataset.datasetId));
  const caseIds = new Set<string>();
  const splitByProject = new Map<string, string>();
  const cases: LoadedCorpusCase[] = [];
  for (const entry of manifest.cases) {
    if (!datasetIds.has(entry.datasetId)) throw corpusError(`Unknown dataset ${entry.datasetId}.`);
    if (caseIds.has(entry.caseId)) throw corpusError(`Duplicate case ${entry.caseId}.`);
    caseIds.add(entry.caseId);
    const existingSplit = splitByProject.get(entry.projectId);
    if (existingSplit !== undefined) {
      if (existingSplit !== entry.split) {
        throw corpusError(`Project ${entry.projectId} appears in more than one split.`);
      }
      throw corpusError(`Project ${entry.projectId} contributes more than one selected case.`);
    }
    splitByProject.set(entry.projectId, entry.split);
    await validateCaseSourceDigests(canonicalRoot, entry);
    const answerKey = CorpusAnswerKeySchema.parse(
      await readCorpusJson(canonicalRoot, entry.answerKeyPath),
    );
    if (answerKey.caseId !== entry.caseId)
      throw corpusError(`Answer key does not match ${entry.caseId}.`);
    if (entry.variantMode === 'paired' && answerKey.patchedExpectation !== 'no-matching-finding') {
      throw corpusError(`Paired case ${entry.caseId} requires a patched negative expectation.`);
    }
    await validateAnswerKeySourceAnchors(canonicalRoot, entry, answerKey);
    const reviewedPlan = ReviewedPlanFixtureSchema.parse(
      await readCorpusJson(canonicalRoot, entry.reviewedPlanPath),
    );
    if (reviewedPlan.caseId !== entry.caseId)
      throw corpusError(`Reviewed plan does not match ${entry.caseId}.`);
    cases.push({ case: entry, answerKey, reviewedPlan });
  }
  return Object.freeze({ root: canonicalRoot, manifest, cases: Object.freeze(cases) });
}

/** Projects only the non-scoring fields permitted to the scripted conformance provider. */
export function deterministicCorpusFixturePack(
  pack: LoadedCorpusPack,
): DeterministicCorpusFixturePack {
  return Object.freeze({
    cases: Object.freeze(
      pack.cases.map((loaded) =>
        Object.freeze({
          case: Object.freeze({
            caseId: loaded.case.caseId,
            split: loaded.case.split,
            sourceDirectories: loaded.case.sourceDirectories,
          }),
          reviewedPlan: loaded.reviewedPlan,
        }),
      ),
    ),
  });
}

/**
 * Loads exactly one development corpus variant for protocol diagnostics.
 * It validates the selected source digest and audit-reviewed-plan fixture without
 * reading, parsing, or exposing an answer key.
 */
export async function loadCorpusSmokeCase(input: {
  root: string;
  caseId: string;
  variant: 'vulnerable' | 'patched' | 'benign';
}): Promise<LoadedCorpusSmokeCase> {
  const canonicalRoot = await canonicalDirectory(input.root, 'Corpus root');
  const manifest = CorpusPackManifestSchema.parse(
    await readCorpusJson(canonicalRoot, 'manifest.json'),
  );
  const { manifestDigest: _manifestDigest, ...unsignedManifest } = manifest;
  if (manifest.manifestDigest !== corpusManifestDigest(unsignedManifest)) {
    throw corpusError('Corpus manifest digest does not match its content.');
  }
  const entry = manifest.cases.find((candidate) => candidate.caseId === input.caseId);
  if (entry === undefined) throw corpusError(`Unknown smoke case ${input.caseId}.`);
  if (entry.split !== 'development') {
    throw corpusError('A provider smoke may select only a development corpus case.');
  }
  const sourceDirectory = entry.sourceDirectories[input.variant];
  const expectedDigest = entry.sourceDigests[input.variant];
  if (sourceDirectory === undefined || expectedDigest === undefined) {
    throw corpusError(`Case ${entry.caseId} has no ${input.variant} source variant.`);
  }
  const targetRoot = await resolveCorpusDirectory(
    canonicalRoot,
    sourceDirectory,
    'Case source directory',
  );
  if ((await directoryDigest(targetRoot)) !== expectedDigest) {
    throw corpusError(`${entry.caseId} ${input.variant} source digest does not match.`);
  }
  const reviewedPlan = ReviewedPlanFixtureSchema.parse(
    await readCorpusJson(canonicalRoot, entry.reviewedPlanPath),
  );
  if (reviewedPlan.caseId !== entry.caseId) {
    throw corpusError(`Reviewed plan does not match ${entry.caseId}.`);
  }
  return Object.freeze({
    root: canonicalRoot,
    manifest,
    case: entry,
    reviewedPlan,
    variant: input.variant,
    targetRoot,
    contextRoot:
      entry.contextDirectory === undefined
        ? undefined
        : await resolveCorpusDirectory(
            canonicalRoot,
            entry.contextDirectory,
            'Case context directory',
          ),
  });
}

export function corpusManifestDigest(manifest: Omit<CorpusPackManifest, 'manifestDigest'>): string {
  return sha256(canonicalJson(manifest));
}

export function variantRoot(
  pack: LoadedCorpusPack,
  entry: CorpusCase,
  variant: 'vulnerable' | 'patched' | 'benign',
): string {
  const directory = entry.sourceDirectories[variant];
  if (directory === undefined)
    throw corpusError(`Case ${entry.caseId} has no ${variant} source variant.`);
  return resolveInside(pack.root, directory);
}

export function contextRoot(pack: LoadedCorpusPack, entry: CorpusCase): string | undefined {
  return entry.contextDirectory === undefined
    ? undefined
    : resolveInside(pack.root, entry.contextDirectory);
}

async function validateCaseSourceDigests(root: string, entry: CorpusCase): Promise<void> {
  const digests: string[] = [];
  for (const variant of ['vulnerable', 'patched', 'benign'] as const) {
    const directory = entry.sourceDirectories[variant];
    const expectedDigest = entry.sourceDigests[variant];
    if (directory === undefined || expectedDigest === undefined) continue;
    const actualDigest = await directoryDigest(
      await resolveCorpusDirectory(root, directory, 'Case source directory'),
    );
    if (actualDigest !== expectedDigest) {
      throw corpusError(`${entry.caseId} ${variant} source digest does not match.`);
    }
    digests.push(`${variant}\0${actualDigest}`);
  }
  if (sha256(digests.join('\n')) !== entry.transformedContentDigest) {
    throw corpusError(`${entry.caseId} transformed content digest does not match.`);
  }
}

async function directoryDigest(root: string): Promise<string> {
  await canonicalDirectory(root, 'Case source directory');
  const records: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw corpusError(`Symlink in corpus source: ${relativePath}.`);
      if (stat.isDirectory()) {
        await visit(path, relativePath);
      } else if (stat.isFile()) {
        const content = await readFile(path);
        records.push(`${relativePath}\0${sha256(content)}`);
      }
    }
  };
  await visit(root, '');
  return sha256(records.join('\n'));
}

/**
 * Answer keys are evaluator-only, but their source anchors still have to bind
 * to the already checksummed vulnerable snapshot. This prevents a malformed
 * key from reaching any later provider preparation with an invented path or
 * a range beyond the frozen source file.
 */
async function validateAnswerKeySourceAnchors(
  root: string,
  entry: CorpusCase,
  answerKey: CorpusAnswerKey,
): Promise<void> {
  const vulnerableRoot = await resolveCorpusDirectory(
    root,
    entry.sourceDirectories.vulnerable,
    'Vulnerable case source directory',
  );
  const lineCounts = new Map<string, number>();
  const sourceLineCount = async (relativePath: string): Promise<number> => {
    const existing = lineCounts.get(relativePath);
    if (existing !== undefined) return existing;
    const sourcePath = await resolveCorpusRegularFile(vulnerableRoot, relativePath);
    const count = await utf8SourceLineCount(sourcePath);
    lineCounts.set(relativePath, count);
    return count;
  };

  for (const scenario of answerKey.expectedPlanScenarios) {
    for (const relativePath of scenario.relevantPaths) await sourceLineCount(relativePath);
  }
  for (const finding of answerKey.expectedFindings) {
    for (const role of finding.evidenceRoles) {
      for (const range of role.ranges) {
        const lineCount = await sourceLineCount(range.path);
        if (range.endLine > lineCount) {
          throw corpusError(
            `Answer key range for ${entry.caseId} exceeds its frozen vulnerable source snapshot.`,
          );
        }
      }
    }
  }
}

async function utf8SourceLineCount(path: string): Promise<number> {
  const bytes = await readFile(path).catch(() => {
    throw corpusError('Cannot read answer-key source anchor.');
  });
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw corpusError('Answer-key source anchors must reference UTF-8 source files.');
  }
  if (source.length === 0) return 0;
  let lines = source.endsWith('\n') ? 0 : 1;
  for (const character of source) if (character === '\n') lines += 1;
  return lines;
}

async function canonicalDirectory(root: string, label: string): Promise<string> {
  const absolute = resolve(root);
  const status = await lstat(absolute).catch(() => undefined);
  if (status === undefined || !status.isDirectory() || status.isSymbolicLink()) {
    throw corpusError(`${label} must be an existing non-symlink directory.`);
  }
  return realpath(absolute).catch(() => {
    throw corpusError(`${label} cannot be canonicalized.`);
  });
}

function resolveInside(root: string, path: string): string {
  if (isAbsolute(path)) throw corpusError('Corpus paths must be relative.');
  const resolved = resolve(root, path);
  const child = relative(root, resolved);
  if (child.length === 0 || child.startsWith('..') || isAbsolute(child)) {
    throw corpusError('Corpus path escapes its root.');
  }
  return resolved;
}

async function readCorpusJson(root: string, relativePath: string) {
  return readValidatedJson(await resolveCorpusRegularFile(root, relativePath));
}

async function resolveCorpusRegularFile(root: string, relativePath: string): Promise<string> {
  const resolved = await resolveExistingInside(root, relativePath);
  const status = await lstat(resolved).catch(() => undefined);
  if (status === undefined || !status.isFile() || status.isSymbolicLink()) {
    throw corpusError('Corpus metadata must be an existing regular non-symlink file.');
  }
  return resolved;
}

async function resolveCorpusDirectory(
  root: string,
  relativePath: string,
  label: string,
): Promise<string> {
  const resolved = await resolveExistingInside(root, relativePath);
  const status = await lstat(resolved).catch(() => undefined);
  if (status === undefined || !status.isDirectory() || status.isSymbolicLink()) {
    throw corpusError(`${label} must be an existing non-symlink directory.`);
  }
  return resolved;
}

/** Rejects every symlink component before resolving an existing corpus path. */
async function resolveExistingInside(root: string, relativePath: string): Promise<string> {
  const lexical = resolveInside(root, relativePath);
  const child = relative(root, lexical);
  let current = root;
  for (const segment of child.split('/')) {
    current = join(current, segment);
    const status = await lstat(current).catch(() => undefined);
    if (status === undefined) throw corpusError('Corpus path does not exist.');
    if (status.isSymbolicLink()) throw corpusError('Corpus paths cannot traverse symbolic links.');
  }
  const canonical = await realpath(lexical).catch(() => {
    throw corpusError('Corpus path cannot be canonicalized.');
  });
  const canonicalChild = relative(root, canonical);
  if (
    canonicalChild.length === 0 ||
    canonicalChild.startsWith('..') ||
    isAbsolute(canonicalChild)
  ) {
    throw corpusError('Corpus path escapes its root.');
  }
  return canonical;
}

async function readValidatedJson(path: string) {
  const content = await readFile(path, 'utf8').catch(() => {
    throw corpusError(`Cannot read corpus file ${path}.`);
  });
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(content);
  } catch {
    throw corpusError(`Invalid JSON in ${path}.`);
  }
  const parsed = z.json().safeParse(rawJson);
  if (!parsed.success) throw corpusError(`Invalid JSON in ${path}.`);
  return parsed.data;
}

function corpusError(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `Invalid evaluation corpus: ${message}`);
}
