import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';
import { AuditRuntimeError } from '../../src/shared/errors/audit-runtime-error.js';
import {
  type RealWorldAcquisitionSummary,
  RealWorldAcquisitionSummarySchema,
  type RealWorldAcquisitionTrack,
  RealWorldAcquisitionTrackSchema,
} from './acquisition-track.schema.js';
import { loadCandidateRegistry } from './candidate-registry.js';

/** Loads a content-free, evaluator-only acquisition plan without fetching or importing source. */
export async function loadRealWorldAcquisitionTrack(
  path: string,
): Promise<RealWorldAcquisitionTrack> {
  const parsed = RealWorldAcquisitionTrackSchema.safeParse(await parseJson(path));
  if (!parsed.success) throw acquisitionError('Acquisition track schema is invalid.');
  const { trackDigest, ...unsigned } = parsed.data;
  if (realWorldAcquisitionTrackDigest(unsigned) !== trackDigest) {
    throw acquisitionError('Acquisition track digest does not match its content.');
  }
  return parsed.data;
}

export function realWorldAcquisitionTrackDigest(
  track: Omit<RealWorldAcquisitionTrack, 'trackDigest'>,
): string {
  return sha256(canonicalJson(track));
}

/**
 * Confirms only track/registry metadata links. It does not fetch snapshots,
 * read candidate source, construct a corpus case, or expose anything to a model.
 */
export async function validateRealWorldAcquisitionTrack(input: {
  track: RealWorldAcquisitionTrack;
  repositoryRoot: string;
}): Promise<RealWorldAcquisitionSummary> {
  const registryIds: string[] = [];
  for (const lane of input.track.lanes) {
    if (lane.candidateRegistryPath === undefined) continue;
    const registryPath = withinRepository(input.repositoryRoot, lane.candidateRegistryPath);
    const registry = await loadCandidateRegistry(registryPath);
    if (canonicalJson(registry.source) !== canonicalJson(lane.source)) {
      throw acquisitionError(`Lane source does not match its candidate registry: ${lane.laneId}.`);
    }
    if (registry.candidates.length !== lane.candidateLeadCount) {
      throw acquisitionError(
        `Lane lead count does not match its candidate registry: ${lane.laneId}.`,
      );
    }
    registryIds.push(registry.registryId);
  }
  return RealWorldAcquisitionSummarySchema.parse({
    trackId: input.track.trackId,
    laneCount: input.track.lanes.length,
    metadataReadyLaneCount: input.track.lanes.filter((lane) => lane.state === 'metadata-ready')
      .length,
    metadataUnavailableLaneCount: input.track.lanes.filter(
      (lane) => lane.state === 'metadata-unavailable',
    ).length,
    candidateLeadCount: input.track.lanes.reduce((sum, lane) => sum + lane.candidateLeadCount, 0),
    targetLanguages: uniqueSorted(input.track.lanes.flatMap((lane) => lane.targetLanguages)),
    linkedRegistries: uniqueSorted(registryIds),
  });
}

function withinRepository(repositoryRoot: string, candidatePath: string): string {
  const root = resolve(repositoryRoot);
  const resolved = resolve(root, candidatePath);
  if (relative(root, resolved).startsWith('..')) {
    throw acquisitionError('Candidate registry path escapes the repository root.');
  }
  return resolved;
}

async function parseJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw acquisitionError(`Cannot parse acquisition track ${path}.`);
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function acquisitionError(message: string): AuditRuntimeError {
  return new AuditRuntimeError('invalid-input', `Invalid real-world acquisition track: ${message}`);
}
