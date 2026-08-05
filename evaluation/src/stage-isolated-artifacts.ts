import {
  ArtifactStoreError,
  readJsonArtifact,
  writeJsonArtifact,
  writeNewJsonArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { canonicalJson } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';

import type {
  StageIsolatedEvaluationStageForensicResult,
  StageIsolatedEvaluationStagePack,
  StageIsolatedEvaluationStagePublicResult,
} from './stage-isolated.schema.js';
import { StageIsolatedEvaluationStagePublicResultSchema } from './stage-isolated.schema.js';
import {
  type StageIsolatedEvaluationCheckpoint,
  StageIsolatedEvaluationCheckpointSchema,
} from './stage-isolated-artifacts.schema.js';

function privateCheckpointPath(packId: string): string {
  return `stage-isolated/${packId}.checkpoint.json`;
}

function publicResultPath(packId: string): string {
  return `stage-isolated/${packId}.json`;
}

/** Starts an exact-bound evaluator-private checkpoint without persisting its canonical input. */
export async function createStageIsolatedCheckpoint(input: {
  evaluatorWorkRoot: string;
  pack: StageIsolatedEvaluationStagePack;
  canonicalInputFingerprint: string;
  productProjectionFingerprint?: string;
  rubricFingerprint: string;
  startedAt: string;
}): Promise<StageIsolatedEvaluationCheckpoint> {
  const checkpoint = StageIsolatedEvaluationCheckpointSchema.parse({
    schemaVersion: 2,
    pack: input.pack,
    canonicalInputFingerprint: input.canonicalInputFingerprint,
    productProjectionFingerprint: input.productProjectionFingerprint ?? null,
    rubricFingerprint: input.rubricFingerprint,
    status: 'running',
    startedAt: input.startedAt,
  });
  await writeNewJsonArtifact(
    input.evaluatorWorkRoot,
    privateCheckpointPath(checkpoint.pack.packId),
    StageIsolatedEvaluationCheckpointSchema,
    checkpoint,
  );
  return checkpoint;
}

/** Reads only a matching evaluator-private checkpoint; a mismatch fails before provider construction. */
export async function loadStageIsolatedCheckpoint(input: {
  evaluatorWorkRoot: string;
  pack: StageIsolatedEvaluationStagePack;
  canonicalInputFingerprint: string;
  productProjectionFingerprint?: string;
  rubricFingerprint: string;
}): Promise<StageIsolatedEvaluationCheckpoint | undefined> {
  let checkpoint: StageIsolatedEvaluationCheckpoint;
  try {
    checkpoint = await readJsonArtifact(
      input.evaluatorWorkRoot,
      privateCheckpointPath(input.pack.packId),
      StageIsolatedEvaluationCheckpointSchema,
    );
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
  if (
    canonicalJson(checkpoint.pack) !== canonicalJson(input.pack) ||
    checkpoint.canonicalInputFingerprint !== input.canonicalInputFingerprint ||
    checkpoint.productProjectionFingerprint !== (input.productProjectionFingerprint ?? null) ||
    checkpoint.rubricFingerprint !== input.rubricFingerprint
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The stage-isolated checkpoint does not match the sealed pack and canonical input.',
    );
  }
  return checkpoint;
}

/** Stores one terminal private result. It cannot replace a different pack or lifecycle state. */
export async function saveStageIsolatedCheckpoint(input: {
  evaluatorWorkRoot: string;
  checkpoint: StageIsolatedEvaluationCheckpoint;
  result: StageIsolatedEvaluationStageForensicResult;
  completedAt: string;
}): Promise<StageIsolatedEvaluationCheckpoint> {
  if (input.checkpoint.status !== 'running') {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'Only a running stage-isolated checkpoint may receive its terminal result.',
    );
  }
  const checkpoint = StageIsolatedEvaluationCheckpointSchema.parse({
    ...input.checkpoint,
    status:
      input.result.semanticOutcome.status === 'inconclusive'
        ? input.result.evaluatorObservation?.status === 'failed'
          ? 'failed'
          : 'incomplete'
        : 'completed',
    completedAt: input.completedAt,
    result: input.result,
  });
  await writeJsonArtifact(
    input.evaluatorWorkRoot,
    privateCheckpointPath(checkpoint.pack.packId),
    StageIsolatedEvaluationCheckpointSchema,
    checkpoint,
  );
  return checkpoint;
}

/** Publishes the source-free projection once. Private forensic data never enters this root. */
export async function publishStageIsolatedPublicResult(input: {
  reportRoot: string;
  result: StageIsolatedEvaluationStagePublicResult;
}): Promise<void> {
  const result = StageIsolatedEvaluationStagePublicResultSchema.parse(input.result);
  await writeNewJsonArtifact(
    input.reportRoot,
    publicResultPath(result.pack.packId),
    StageIsolatedEvaluationStagePublicResultSchema,
    result,
  );
}
