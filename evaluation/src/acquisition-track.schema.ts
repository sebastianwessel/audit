import { z } from 'zod';

import {
  BoundedTextSchema,
  IdentifierSchema,
  RelativePathSchema,
  SchemaVersion,
  Sha256Schema,
} from '../../src/shared/contracts/core.js';

import { CorpusCandidateRegistrySchema } from './candidate-registry.schema.js';
import { CorpusControlFamiliesSchema, CorpusDatasetSchema } from './corpus.schema.js';
import { LanguageTagSchema } from './evaluation.schema.js';

export const AcquisitionLaneStateSchema = z.enum([
  'scouting',
  'metadata-unavailable',
  'metadata-ready',
]);

/** Why a pinned source cannot yet yield a digest-bound candidate registry. */
export const AcquisitionMetadataUnavailableReasonSchema = z.enum([
  'dataset-distribution-not-present',
  'record-set-not-present',
  'revision-provenance-incomplete',
]);

/**
 * Evaluator-only source lane. It contains acquisition metadata, never copied
 * source, labels, plans, answer keys, or anything visible to an audit agent.
 */
export const RealWorldAcquisitionLaneSchema = z
  .strictObject({
    laneId: IdentifierSchema,
    source: CorpusDatasetSchema,
    targetLanguages: z.array(LanguageTagSchema).min(1),
    targetControlFamilies: CorpusControlFamiliesSchema,
    state: AcquisitionLaneStateSchema,
    metadataUnavailableReason: AcquisitionMetadataUnavailableReasonSchema.optional(),
    candidateRegistryPath: RelativePathSchema.optional(),
    candidateLeadCount: z.int().nonnegative(),
    notes: BoundedTextSchema.min(1).max(2_000),
  })
  .superRefine((lane, context) => {
    if (new Set(lane.targetLanguages).size !== lane.targetLanguages.length) {
      context.addIssue({
        code: 'custom',
        path: ['targetLanguages'],
        message: 'Target languages must be unique.',
      });
    }
    if (lane.state === 'metadata-ready' && lane.candidateRegistryPath === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['candidateRegistryPath'],
        message: 'A metadata-ready lane requires a candidate registry.',
      });
    }
    if (lane.state === 'metadata-unavailable' && lane.metadataUnavailableReason === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['metadataUnavailableReason'],
        message: 'A metadata-unavailable lane requires its closed reason.',
      });
    }
    if (lane.state !== 'metadata-unavailable' && lane.metadataUnavailableReason !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['metadataUnavailableReason'],
        message: 'Only a metadata-unavailable lane may declare an unavailable reason.',
      });
    }
    if (lane.candidateRegistryPath === undefined && lane.candidateLeadCount !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['candidateLeadCount'],
        message: 'A lane without a registry cannot claim candidate leads.',
      });
    }
  });

export const RealWorldAcquisitionTrackSchema = z
  .strictObject({
    schemaVersion: SchemaVersion,
    trackId: IdentifierSchema,
    purpose: BoundedTextSchema.min(1).max(2_000),
    lanes: z.array(RealWorldAcquisitionLaneSchema).min(1),
    trackDigest: Sha256Schema,
  })
  .superRefine((track, context) => {
    const laneIds = track.lanes.map((lane) => lane.laneId);
    if (new Set(laneIds).size !== laneIds.length) {
      context.addIssue({ code: 'custom', path: ['lanes'], message: 'Lane ids must be unique.' });
    }
  });

export const RealWorldAcquisitionSummarySchema = z.strictObject({
  trackId: IdentifierSchema,
  laneCount: z.int().positive(),
  metadataReadyLaneCount: z.int().nonnegative(),
  metadataUnavailableLaneCount: z.int().nonnegative(),
  candidateLeadCount: z.int().nonnegative(),
  targetLanguages: z.array(LanguageTagSchema),
  linkedRegistries: z.array(CorpusCandidateRegistrySchema.shape.registryId),
});

export type RealWorldAcquisitionLane = z.infer<typeof RealWorldAcquisitionLaneSchema>;
export type RealWorldAcquisitionTrack = z.infer<typeof RealWorldAcquisitionTrackSchema>;
export type RealWorldAcquisitionSummary = z.infer<typeof RealWorldAcquisitionSummarySchema>;
