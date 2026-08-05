import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { sha256 } from '../../src/shared/contracts/core.js';

import {
  type ProviderEvaluationTerminalManifest,
  ProviderEvaluationTerminalManifestSchema,
  type RealWorldEvaluationRun,
  RealWorldEvaluationRunSchema,
} from './corpus.schema.js';
import {
  type EvaluationArtifactHeadlineStatus,
  type EvaluationArtifactInspection,
  EvaluationArtifactInspectionSchema,
} from './evaluation-artifact-inspector.schema.js';

const profiles = ['planning-generated', 'audit-reviewed-plan', 'end-to-end-generated'] as const;

type PublicArtifactCandidate = Readonly<{
  run: RealWorldEvaluationRun;
  terminal: ProviderEvaluationTerminalManifest | undefined;
}>;

/**
 * Inspects only visible, source-free terminal artifact directories. Private
 * evaluator work directories are ignored by construction.
 */
export async function inspectEvaluationArtifacts(input: {
  outputRoot: string;
  expectedBenchmarkProtocolFingerprint: string;
}): Promise<EvaluationArtifactInspection> {
  const expectedBenchmarkProtocolFingerprint = z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .parse(input.expectedBenchmarkProtocolFingerprint);
  const candidates = await readPublicArtifactCandidates(input.outputRoot);
  return EvaluationArtifactInspectionSchema.parse({
    schemaVersion: 1,
    expectedBenchmarkProtocolFingerprint,
    headlines: profiles.map((planProfile) =>
      headlineForProfile(planProfile, candidates, expectedBenchmarkProtocolFingerprint),
    ),
  });
}

async function readPublicArtifactCandidates(
  outputRoot: string,
): Promise<PublicArtifactCandidate[]> {
  const root = await lstat(outputRoot).catch(() => undefined);
  if (root === undefined || !root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('Evaluation artifact inspection requires a regular output directory.');
  }
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const candidates: PublicArtifactCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const run = await readRegularJson(
      join(outputRoot, entry.name, 'evaluation-run.json'),
      RealWorldEvaluationRunSchema,
    );
    if (run === undefined || run.runId !== entry.name) continue;
    const terminal = await readRegularJson(
      join(outputRoot, entry.name, 'terminal-manifest.json'),
      ProviderEvaluationTerminalManifestSchema,
    );
    if (
      terminal !== undefined &&
      !(await matchesTerminalArtifactSet(run, terminal, outputRoot, entry.name))
    ) {
      continue;
    }
    candidates.push({ run, terminal });
  }
  return candidates;
}

async function readRegularJson<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<z.output<Schema> | undefined> {
  const status = await lstat(path).catch(() => undefined);
  if (status === undefined || !status.isFile() || status.isSymbolicLink() || status.size === 0) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return undefined;
  }
  const json = z.json().safeParse(value);
  return json.success ? schema.safeParse(json.data).data : undefined;
}

async function matchesTerminalArtifactSet(
  run: RealWorldEvaluationRun,
  terminal: ProviderEvaluationTerminalManifest,
  outputRoot: string,
  directory: string,
): Promise<boolean> {
  if (
    terminal.runId !== run.runId ||
    terminal.benchmarkProtocolFingerprint !== run.benchmarkProtocolFingerprint ||
    terminal.planProfile !== run.planProfile ||
    terminal.semanticPlanEvaluator?.protocolFingerprint !==
      run.semanticPlanEvaluator?.protocolFingerprint ||
    terminal.semanticPlanEvaluator?.route !== run.semanticPlanEvaluator?.route
  ) {
    return false;
  }
  const validations = await Promise.all(
    terminal.requiredArtifacts.map(async (artifact) => {
      const path = join(outputRoot, directory, artifact.name);
      const status = await lstat(path).catch(() => undefined);
      if (status === undefined || !status.isFile() || status.isSymbolicLink()) return false;
      const bytes = new Uint8Array(await readFile(path));
      return bytes.byteLength === artifact.byteLength && sha256(bytes) === artifact.sha256;
    }),
  );
  return validations.every(Boolean);
}

function headlineForProfile(
  planProfile: (typeof profiles)[number],
  candidates: readonly PublicArtifactCandidate[],
  expectedBenchmarkProtocolFingerprint: string,
) {
  const profileCandidates = candidates
    .filter(
      (candidate) => candidate.run.planProfile === planProfile && candidate.run.mode === 'provider',
    )
    .sort((left, right) => right.run.finishedAt.localeCompare(left.run.finishedAt));
  const matching = profileCandidates.filter(
    (candidate) =>
      candidate.run.benchmarkProtocolFingerprint === expectedBenchmarkProtocolFingerprint,
  );
  const selected = matching[0];
  if (selected !== undefined) {
    return {
      planProfile,
      status: statusFor(selected),
      runId: selected.run.runId,
      finishedAt: selected.run.finishedAt,
      benchmarkProtocolFingerprint: selected.run.benchmarkProtocolFingerprint,
    };
  }
  const mismatched = profileCandidates[0];
  if (mismatched !== undefined) {
    return {
      planProfile,
      status: 'protocol-mismatch' as const,
      runId: mismatched.run.runId,
      finishedAt: mismatched.run.finishedAt,
      benchmarkProtocolFingerprint: mismatched.run.benchmarkProtocolFingerprint,
    };
  }
  return {
    planProfile,
    status: 'no-current-scoreable-provider-result' as const,
    runId: null,
    finishedAt: null,
    benchmarkProtocolFingerprint: null,
  };
}

function statusFor(candidate: PublicArtifactCandidate): EvaluationArtifactHeadlineStatus {
  const { run } = candidate;
  if (run.trials.some((trial) => trial.status === 'cancelled')) return 'cancelled';
  if (run.trials.some((trial) => trial.status === 'failed')) return 'failed';
  if (run.trials.some((trial) => trial.status === 'incomplete')) return 'incomplete';
  if (
    run.planProfile !== 'audit-reviewed-plan' &&
    run.measurementState.semanticPlan !== 'complete' &&
    candidate.terminal === undefined
  ) {
    return 'orphaned-semantic-checkpoint';
  }
  if (candidate.terminal === undefined) return 'incomplete';
  if (
    run.measurementState.workflow === 'complete' &&
    run.measurementState.finding !== 'incomplete' &&
    run.measurementState.semanticPlan !== 'incomplete'
  ) {
    return 'scoreable-completed';
  }
  return 'incomplete';
}
