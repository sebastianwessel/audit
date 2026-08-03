import { expect, test } from 'bun:test';

import {
  loadRealWorldAcquisitionTrack,
  validateRealWorldAcquisitionTrack,
} from './acquisition-track.js';
import { RealWorldAcquisitionTrackSchema } from './acquisition-track.schema.js';

test('validates the separate multilingual real-world acquisition track without loading source', async () => {
  const track = await loadRealWorldAcquisitionTrack(
    'evaluation/acquisition/real-world-multilingual-v1.json',
  );
  const summary = await validateRealWorldAcquisitionTrack({
    track,
    repositoryRoot: process.cwd(),
  });

  expect(summary).toEqual({
    trackId: 'real-world-multilingual-acquisition-v1',
    laneCount: 6,
    metadataReadyLaneCount: 4,
    metadataUnavailableLaneCount: 2,
    candidateLeadCount: 44,
    targetLanguages: ['c', 'c++', 'go', 'java', 'javascript', 'php', 'python', 'typescript'],
    linkedRegistries: [
      'cwe-bench-java-candidate-pilot',
      'openssf-candidate-pilot',
      'osv-go-candidate-pilot',
      'osv-python-candidate-pilot',
    ],
  });
  expect(
    track.lanes
      .filter((lane) => lane.state === 'metadata-unavailable')
      .map((lane) => [lane.laneId, lane.metadataUnavailableReason]),
  ).toEqual([
    ['cvefixes-multilingual-scouting', 'dataset-distribution-not-present'],
    ['diversevul-c-family-scouting', 'record-set-not-present'],
  ]);
});

test('requires a closed unavailable reason only for unavailable acquisition lanes', async () => {
  const track = await loadRealWorldAcquisitionTrack(
    'evaluation/acquisition/real-world-multilingual-v1.json',
  );
  const unavailable = track.lanes.find((lane) => lane.state === 'metadata-unavailable');
  const ready = track.lanes.find((lane) => lane.state === 'metadata-ready');
  if (unavailable === undefined || ready === undefined)
    throw new Error('Expected unavailable and ready acquisition lanes.');
  expect(
    RealWorldAcquisitionTrackSchema.safeParse({
      ...track,
      lanes: [{ ...unavailable, metadataUnavailableReason: undefined }, ...track.lanes.slice(1)],
    }).success,
  ).toBe(false);
  expect(
    RealWorldAcquisitionTrackSchema.safeParse({
      ...track,
      lanes: [
        ...track.lanes.filter((lane) => lane.laneId !== ready.laneId),
        { ...ready, metadataUnavailableReason: 'record-set-not-present' },
      ],
    }).success,
  ).toBe(false);
});

test('accepts complete acquisition language and lane collections above retired ceilings', async () => {
  const track = await loadRealWorldAcquisitionTrack(
    'evaluation/acquisition/real-world-multilingual-v1.json',
  );
  const template = track.lanes.at(0);
  if (template === undefined) throw new Error('Expected an acquisition lane.');
  const lanes = Array.from({ length: 33 }, (_, index) => ({
    ...template,
    laneId: `acquisition-lane-${String(index).padStart(2, '0')}`,
    targetLanguages: Array.from(
      { length: 33 },
      (_, languageIndex) =>
        `language-${String(index).padStart(2, '0')}-${String(languageIndex).padStart(2, '0')}`,
    ),
  }));
  const parsed = RealWorldAcquisitionTrackSchema.parse({ ...track, lanes });
  expect(parsed.lanes).toHaveLength(33);
  expect(parsed.lanes.at(0)?.targetLanguages).toHaveLength(33);
});
