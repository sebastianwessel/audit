import { lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  AuditCandidateAwareCheckpoint,
  AuditCandidateGroundingDraft,
  AuditContextOverflowLedger,
  AuditEvidenceMapDraft,
  AuditSourcePostureDraft,
  AuditVectorResult,
} from '../../src/features/audit-execution/audit.schema.js';
import {
  AuditCandidateAwareCheckpointSchema,
  AuditCandidateGroundingDraftSchema,
  AuditCandidateGroundingRecoveryLeafSchema,
  AuditContextOverflowLedgerSchema,
  AuditEvidenceMapDraftSchema,
  AuditEvidenceMapRecoveryLeafSchema,
  AuditSourcePostureDraftSchema,
  AuditSourcePostureRecoveryLeafSchema,
  AuditVectorCheckpointSchema,
  modelObservationForAuditCheckpointExecution,
} from '../../src/features/audit-execution/audit.schema.js';
import {
  type AuditCheckpointBaseBinding,
  auditCandidateAwareCheckpointPath,
  auditCandidateGroundingDraftPath,
  auditCandidateGroundingRecoveryLeafPath,
  auditCheckpointPath,
  auditContextOverflowLedgerPath,
  auditEvidenceMapDraftPath,
  auditEvidenceMapRecoveryLeafPath,
  auditSourcePostureDraftPath,
  auditSourcePostureRecoveryLeafPath,
  createAuditCandidateAwareCheckpoint,
  createAuditCandidateGroundingDraft,
  createAuditCandidateGroundingRecoveryLeaf,
  createAuditCheckpointBinding,
  createAuditContextOverflowLedger,
  createAuditEvidenceMapDraft,
  createAuditEvidenceMapRecoveryLeaf,
  createAuditSourcePostureDraft,
  createAuditSourcePostureRecoveryLeaf,
  createAuditVectorCheckpoint,
  loadObservedAuditVectorResults,
  loadReusableAuditCandidateAwareCheckpoints,
  loadReusableAuditCandidateGroundingDrafts,
  loadReusableAuditCandidateGroundingRecoveryLeaves,
  loadReusableAuditContextOverflowLedgers,
  loadReusableAuditEvidenceMapDrafts,
  loadReusableAuditEvidenceMapRecoveryLeaves,
  loadReusableAuditSourcePostureDrafts,
  loadReusableAuditSourcePostureRecoveryLeaves,
  loadReusableAuditVectorResults,
  reusableContextOverflowModelStages,
} from '../../src/features/audit-execution/checkpoints.js';
import { modelStagesForAudit } from '../../src/features/audit-execution/model-stage-observations.js';
import type { ModelStageObservation } from '../../src/features/model-operations/model-operations.js';
import {
  ArtifactStoreError,
  acquireArtifactLease,
  readArtifactLeaseMetadata,
  readJsonArtifact,
  releaseArtifactLease,
  removeArtifactDirectory,
  writeJsonArtifact,
  writeJsonLinesArtifact,
  writeMarkdownArtifact,
} from '../../src/platform/artifact-store/json-artifact-store.js';
import { ensureSafeOutputRoot } from '../../src/platform/artifact-store/root-topology.js';
import {
  canonicalJson,
  createStableId,
  IdentifierSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  sha256,
} from '../../src/shared/contracts/core.js';

import {
  type EvaluationGeneratedPlanCheckpoint,
  EvaluationGeneratedPlanCheckpointSchema,
  EvaluationTrialSchema,
  ExpectedEvidenceTraceCheckpointSchema,
  ProviderEvaluationAttemptModeSchema,
  type ProviderEvaluationCheckpoint,
  ProviderEvaluationCheckpointSchema,
  ProviderEvaluationLifecycleStatusSchema,
  type ProviderEvaluationPublicationFailureReason,
  type ProviderEvaluationTerminalManifest,
  ProviderEvaluationTerminalManifestSchema,
  type RealWorldEvaluationRun,
  RealWorldEvaluationRunSchema,
} from './corpus.schema.js';
import {
  type ProviderSmokeCheckpoint,
  ProviderSmokeCheckpointSchema,
} from './provider-smoke.schema.js';
import type {
  EvaluationAuditCheckpointStore,
  EvaluationExpectedEvidenceTraceCheckpointStore,
  EvaluationPlanningCheckpointStore,
} from './real-world-runner.js';

const providerEvaluationWorkPath = (runId: string) => `.provider-evaluations/${runId}`;
const checkpointPath = (runId: string) => `${providerEvaluationWorkPath(runId)}/checkpoint.json`;
const smokeCheckpointPath = (runId: string) => `smokes/${runId}.checkpoint.json`;

function evaluatorWorkPath(runId: string, artifactPath: string): string {
  return `${providerEvaluationWorkPath(runId)}/work/${artifactPath}`;
}

/**
 * Owns the evaluator-only semantic checkpoint location. Terminal publication
 * reserves the public run directory, so no mutable evaluator state may live
 * below that path.
 */
export function evaluationPlanSemanticCheckpointPath(runId: string, trialId: string): string {
  return evaluatorWorkPath(runId, `plan-semantic-evaluations/${trialId}.checkpoint.json`);
}

/** A typed, source-free publication reason that survives checkpoint recovery. */
export class ProviderEvaluationPublicationError extends ArtifactStoreError {
  public constructor(
    public readonly publicationReason: ProviderEvaluationPublicationFailureReason,
    message: string,
  ) {
    super('artifact-write-failed', message);
    this.name = 'ProviderEvaluationPublicationError';
  }
}

function generatedPlanCheckpointPath(trialId: string): string {
  return `plans/${trialId}.json`;
}

function expectedEvidenceTraceCheckpointPath(trialId: string): string {
  return `traces/${trialId}.expected-evidence.json`;
}

export type ProviderEvaluationLock = Awaited<ReturnType<typeof acquireArtifactLease>>;

/** Source-free ownership record for an exclusive provider-evaluation command lock. */
export const ProviderEvaluationLockMetadataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: IdentifierSchema,
  attemptId: IdentifierSchema,
  checkpointFingerprint: Sha256Schema,
  createdAt: IsoDateTimeSchema,
  processId: z.int().nonnegative(),
  hostFingerprint: Sha256Schema,
  commandMode: ProviderEvaluationAttemptModeSchema,
});
export type ProviderEvaluationLockMetadata = z.infer<typeof ProviderEvaluationLockMetadataSchema>;

export const ProviderEvaluationLockInspectionSchema = z.strictObject({
  lock: ProviderEvaluationLockMetadataSchema.nullable(),
  checkpoint: z
    .strictObject({
      runId: IdentifierSchema,
      status: ProviderEvaluationLifecycleStatusSchema,
      configFingerprint: Sha256Schema,
      activeAttemptId: IdentifierSchema.nullable(),
    })
    .nullable(),
});
export type ProviderEvaluationLockInspection = z.infer<
  typeof ProviderEvaluationLockInspectionSchema
>;

/**
 * Reconstructs every exact source-free observation retained in evaluator work
 * checkpoints. Deduplication covers overlapping predecessor and terminal
 * artifacts without losing paid-work telemetry after an interrupted process.
 */
export function evaluatorCheckpointModelStages(input: {
  observedVectorResults: readonly AuditVectorResult[];
  candidateGroundingDrafts: readonly AuditCandidateGroundingDraft[];
  candidateAwareCheckpoints: readonly AuditCandidateAwareCheckpoint[];
  evidenceMapDrafts: readonly AuditEvidenceMapDraft[];
  sourcePostureDrafts: readonly AuditSourcePostureDraft[];
  contextOverflowLedgers: readonly AuditContextOverflowLedger[];
}): readonly ModelStageObservation[] {
  return [
    ...modelStagesForAudit(input.observedVectorResults.map((result) => result.coverage)),
    ...input.evidenceMapDrafts.flatMap((draft) => {
      const observation = modelObservationForAuditCheckpointExecution(draft.execution);
      return [
        ...(observation === undefined ? [] : [observation]),
        ...draft.repairAttempts.flatMap((attempt) => {
          const repairObservation = modelObservationForAuditCheckpointExecution(attempt.execution);
          return repairObservation === undefined ? [] : [repairObservation];
        }),
      ];
    }),
    ...input.sourcePostureDrafts.flatMap(
      (draft) => modelObservationForAuditCheckpointExecution(draft.execution) ?? [],
    ),
    ...input.candidateGroundingDrafts.flatMap((draft) => [
      ...(draft.discoveryObservation === undefined ? [] : [draft.discoveryObservation]),
      ...(draft.modelObservation === undefined ? [] : [draft.modelObservation]),
    ]),
    ...input.candidateAwareCheckpoints.flatMap((checkpoint) =>
      checkpoint.result === undefined
        ? []
        : (modelObservationForAuditCheckpointExecution(checkpoint.result.execution) ?? []),
    ),
    ...reusableContextOverflowModelStages({
      ledgers: input.contextOverflowLedgers,
      terminalVectorResults: input.observedVectorResults,
      evidenceMapDrafts: input.evidenceMapDrafts,
      sourcePostureDrafts: input.sourcePostureDrafts,
      candidateGroundingDrafts: input.candidateGroundingDrafts,
    }),
  ];
}

/**
 * Keeps validated draft checkpoints out of source-free evaluation reports while
 * reusing the exact product checkpoint shape and compatibility rules.
 */
export function createEvaluationAuditCheckpointStore(input: {
  outputRoot: string;
  evaluationRunId: string;
  candidateGroundingProtocolFingerprint: string;
  savedAt: () => string;
}): EvaluationAuditCheckpointStore {
  const contextOverflowLedgersByStage = new Map<
    string,
    ReturnType<typeof createAuditContextOverflowLedger>
  >();
  const reader = async (artifactPath: string) =>
    readOptionalAuditArtifact(
      input.outputRoot,
      evaluatorWorkPath(input.evaluationRunId, artifactPath),
    );
  const vectorBinding = (
    binding: AuditCheckpointBaseBinding,
    plan: Parameters<EvaluationAuditCheckpointStore['saveEvidenceMap']>[0]['plan'],
    vectorId: string,
  ) => createAuditCheckpointBinding({ binding, plan, vectorId });
  return {
    load: async ({ binding, plan, retryUnfinished }) => {
      const candidateGroundingDrafts = await loadReusableAuditCandidateGroundingDrafts({
        binding,
        plan,
        reader,
        candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
      });
      const contextOverflowLedgers = await loadReusableAuditContextOverflowLedgers({
        binding,
        plan,
        reader,
      });
      const evidenceMapRecoveryLeaves = await loadReusableAuditEvidenceMapRecoveryLeaves({
        binding,
        plan,
        ledgers: contextOverflowLedgers,
        reader,
      });
      const sourcePostureRecoveryLeaves = await loadReusableAuditSourcePostureRecoveryLeaves({
        binding,
        plan,
        ledgers: contextOverflowLedgers,
        reader,
      });
      const candidateGroundingRecoveryLeaves =
        await loadReusableAuditCandidateGroundingRecoveryLeaves({
          binding,
          plan,
          ledgers: contextOverflowLedgers,
          reader,
        });
      for (const ledger of contextOverflowLedgers) {
        contextOverflowLedgersByStage.set(
          `${binding.runId}\0${ledger.vectorId}\0${ledger.phase}`,
          ledger,
        );
      }
      return {
        observedVectorResults: await loadObservedAuditVectorResults({
          binding,
          plan,
          reader,
        }),
        vectorResults: await loadReusableAuditVectorResults({
          binding,
          plan,
          reader,
          retryUnfinished,
        }),
        candidateGroundingDrafts,
        candidateAwareCheckpoints: await loadReusableAuditCandidateAwareCheckpoints({
          binding,
          plan,
          drafts: candidateGroundingDrafts,
          reader,
          candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
        }),
        evidenceMapDrafts: await loadReusableAuditEvidenceMapDrafts({
          binding,
          plan,
          reader,
        }),
        sourcePostureDrafts: await loadReusableAuditSourcePostureDrafts({
          binding,
          plan,
          reader,
        }),
        contextOverflowLedgers,
        evidenceMapRecoveryLeaves,
        sourcePostureRecoveryLeaves,
        candidateGroundingRecoveryLeaves,
      };
    },
    saveEvidenceMap: async ({ binding, plan, draft }) => {
      const checkpoint = createAuditEvidenceMapDraft({
        binding: vectorBinding(binding, plan, draft.vectorId),
        plan,
        evidenceMap: draft.evidenceMap,
        repairAttempts: draft.repairAttempts,
        execution: draft.execution,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditEvidenceMapDraftPath(binding.runId, draft.vectorId),
        ),
        AuditEvidenceMapDraftSchema,
        checkpoint,
      );
    },
    saveSourcePosture: async ({ binding, plan, draft }) => {
      const checkpoint = createAuditSourcePostureDraft({
        binding: vectorBinding(binding, plan, draft.vectorId),
        plan,
        evidenceMapFingerprint: draft.evidenceMapFingerprint,
        sourcePosture: draft.sourcePosture,
        execution: draft.execution,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditSourcePostureDraftPath(binding.runId, draft.vectorId),
        ),
        AuditSourcePostureDraftSchema,
        checkpoint,
      );
    },
    saveCandidateGrounding: async ({ binding, plan, draft }) => {
      const checkpoint = createAuditCandidateGroundingDraft({
        binding: vectorBinding(binding, plan, draft.vectorId),
        plan,
        candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
        evidenceMapFingerprint: draft.evidenceMapFingerprint,
        sourcePostureFingerprint: draft.sourcePostureFingerprint,
        groundings: draft.groundings,
        closures: draft.closures,
        hypothesisGroundingFunnel: draft.hypothesisGroundingFunnel,
        candidateIntegrityRejections: draft.candidateIntegrityRejections,
        discoveryObservation: draft.discoveryObservation,
        modelObservation: draft.modelObservation,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditCandidateGroundingDraftPath(binding.runId, draft.vectorId),
        ),
        AuditCandidateGroundingDraftSchema,
        checkpoint,
      );
    },
    saveCandidateAware: async ({ binding, plan, update }) => {
      const checkpoint = createAuditCandidateAwareCheckpoint({
        binding: vectorBinding(binding, plan, update.vectorId),
        plan,
        phase: update.phase,
        candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
        candidateOrdinal: update.candidateOrdinal,
        candidate: update.candidate,
        evidenceMapFingerprint: update.evidenceMapFingerprint,
        sourcePostureFingerprint: update.sourcePostureFingerprint,
        state: update.state,
        ...(update.result === undefined ? {} : { result: update.result }),
        ...(update.contextOverflowTopology === undefined
          ? {}
          : { contextOverflowTopology: update.contextOverflowTopology }),
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditCandidateAwareCheckpointPath({
            runId: binding.runId,
            vectorId: update.vectorId,
            phase: update.phase,
            candidateOrdinal: update.candidateOrdinal,
          }),
        ),
        AuditCandidateAwareCheckpointSchema,
        checkpoint,
      );
    },
    saveVectorResult: async ({ binding, plan, result }) => {
      const checkpoint = createAuditVectorCheckpoint({
        binding: vectorBinding(binding, plan, result.coverage.vectorId),
        plan,
        result,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditCheckpointPath(binding.runId, result.coverage.vectorId),
        ),
        AuditVectorCheckpointSchema,
        checkpoint,
      );
    },
    saveContextOverflowTransition: async ({ binding, plan, update }) => {
      const key = `${binding.runId}\0${update.vectorId}\0${update.phase}\0${update.phaseInputFingerprint}`;
      const current = contextOverflowLedgersByStage.get(key);
      const ledger = createAuditContextOverflowLedger({
        binding: vectorBinding(binding, plan, update.vectorId),
        plan,
        phase: update.phase,
        parentStageId: update.parentStageId,
        phaseInputFingerprint: update.phaseInputFingerprint,
        recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
        rootScopeFingerprint: update.rootScopeFingerprint,
        events: [
          ...(current?.events ?? []),
          {
            ordinal: (current?.events.length ?? 0) + 1,
            ...update.event,
            savedAt: input.savedAt(),
          },
        ],
      });
      contextOverflowLedgersByStage.set(key, ledger);
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditContextOverflowLedgerPath({
            runId: binding.runId,
            vectorId: update.vectorId,
            phase: update.phase,
          }),
        ),
        AuditContextOverflowLedgerSchema,
        ledger,
      );
    },
    saveEvidenceMapRecoveryLeaf: async ({ binding, plan, update }) => {
      const leaf = createAuditEvidenceMapRecoveryLeaf({
        binding: vectorBinding(binding, plan, update.vectorId),
        plan,
        phase: update.phase,
        parentStageId: update.parentStageId,
        phaseInputFingerprint: update.phaseInputFingerprint,
        recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
        rootScopeFingerprint: update.rootScopeFingerprint,
        childKey: update.childKey,
        scopeFingerprint: update.scopeFingerprint,
        execution: update.execution,
        evidenceMap: update.evidenceMap,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditEvidenceMapRecoveryLeafPath({
            runId: binding.runId,
            vectorId: update.vectorId,
            phase: update.phase,
            phaseInputFingerprint: update.phaseInputFingerprint,
            scopeFingerprint: update.scopeFingerprint,
          }),
        ),
        AuditEvidenceMapRecoveryLeafSchema,
        leaf,
      );
    },
    saveSourcePostureRecoveryLeaf: async ({ binding, plan, update }) => {
      const leaf = createAuditSourcePostureRecoveryLeaf({
        binding: vectorBinding(binding, plan, update.vectorId),
        plan,
        parentStageId: update.parentStageId,
        phaseInputFingerprint: update.phaseInputFingerprint,
        recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
        rootScopeFingerprint: update.rootScopeFingerprint,
        childKey: update.childKey,
        scopeFingerprint: update.scopeFingerprint,
        execution: update.execution,
        sourcePosture: update.sourcePosture,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditSourcePostureRecoveryLeafPath({
            runId: binding.runId,
            vectorId: update.vectorId,
            phaseInputFingerprint: update.phaseInputFingerprint,
            scopeFingerprint: update.scopeFingerprint,
          }),
        ),
        AuditSourcePostureRecoveryLeafSchema,
        leaf,
      );
    },
    saveCandidateGroundingRecoveryLeaf: async ({ binding, plan, update }) => {
      const leaf = createAuditCandidateGroundingRecoveryLeaf({
        binding: vectorBinding(binding, plan, update.vectorId),
        plan,
        parentStageId: update.parentStageId,
        phaseInputFingerprint: update.phaseInputFingerprint,
        recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
        rootScopeFingerprint: update.rootScopeFingerprint,
        childKey: update.childKey,
        scopeFingerprint: update.scopeFingerprint,
        execution: update.execution,
        groundings: update.groundings,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          auditCandidateGroundingRecoveryLeafPath({
            runId: binding.runId,
            vectorId: update.vectorId,
            phaseInputFingerprint: update.phaseInputFingerprint,
            scopeFingerprint: update.scopeFingerprint,
          }),
        ),
        AuditCandidateGroundingRecoveryLeafSchema,
        leaf,
      );
    },
  };
}

/** Persists a validated generated draft plan, never prompts or raw provider output. */
export function createEvaluationPlanningCheckpointStore(input: {
  outputRoot: string;
  evaluationRunId: string;
  configFingerprint: string;
  savedAt: () => string;
}): EvaluationPlanningCheckpointStore {
  return {
    load: async ({ trialId, targetFingerprint, contextDigest }) => {
      const checkpoint = await readOptionalEvaluationPlanArtifact(
        input.outputRoot,
        evaluatorWorkPath(input.evaluationRunId, generatedPlanCheckpointPath(trialId)),
      );
      if (checkpoint === undefined) return undefined;
      if (
        checkpoint.configFingerprint !== input.configFingerprint ||
        checkpoint.trialId !== trialId ||
        checkpoint.targetFingerprint !== targetFingerprint ||
        checkpoint.contextDigest !== contextDigest
      ) {
        throw new ArtifactStoreError(
          'artifact-read-failed',
          'Generated-plan checkpoint does not match this evaluation trial.',
        );
      }
      return checkpoint;
    },
    save: async ({ trialId, targetFingerprint, contextDigest, plan, modelObservation }) => {
      const checkpoint = EvaluationGeneratedPlanCheckpointSchema.parse({
        schemaVersion: 1,
        trialId,
        configFingerprint: input.configFingerprint,
        targetFingerprint,
        contextDigest,
        plan,
        modelObservation,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(input.evaluationRunId, generatedPlanCheckpointPath(trialId)),
        EvaluationGeneratedPlanCheckpointSchema,
        checkpoint,
      );
    },
  };
}

/** Persists only derived role booleans, never answer-key locations or discovery seeds. */
export function createEvaluationExpectedEvidenceTraceCheckpointStore(input: {
  outputRoot: string;
  evaluationRunId: string;
  savedAt: () => string;
}): EvaluationExpectedEvidenceTraceCheckpointStore {
  return {
    load: async (binding) => {
      const checkpoint = await readOptionalExpectedEvidenceTraceArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          expectedEvidenceTraceCheckpointPath(binding.trialId),
        ),
      );
      if (checkpoint === undefined) return undefined;
      if (JSON.stringify(checkpoint.binding) !== JSON.stringify(binding)) {
        throw new ArtifactStoreError(
          'artifact-read-failed',
          'Expected-evidence trace checkpoint does not match this evaluation trial.',
        );
      }
      return checkpoint.roleTraces;
    },
    save: async (binding, roleTraces) => {
      const checkpoint = ExpectedEvidenceTraceCheckpointSchema.parse({
        schemaVersion: 2,
        binding,
        roleTraces,
        savedAt: input.savedAt(),
      });
      await writeJsonArtifact(
        input.outputRoot,
        evaluatorWorkPath(
          input.evaluationRunId,
          expectedEvidenceTraceCheckpointPath(binding.trialId),
        ),
        ExpectedEvidenceTraceCheckpointSchema,
        checkpoint,
      );
    },
  };
}

async function readOptionalAuditArtifact(outputRoot: string, artifactPath: string) {
  const schema = auditArtifactSchemaForPath(artifactPath);
  if (schema === undefined) return undefined;
  try {
    return await readJsonArtifact(outputRoot, artifactPath, schema);
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}

/** Unknown evaluator work paths must never be interpreted as terminal checkpoints. */
function auditArtifactSchemaForPath(artifactPath: string) {
  if (/\.candidate-\d+\.(?:verification|countercheck)\.json$/u.test(artifactPath)) {
    return AuditCandidateAwareCheckpointSchema;
  }
  if (/\.candidate-grounding-recovery\.[a-f0-9]{64}\.[a-f0-9]{64}\.json$/u.test(artifactPath)) {
    return AuditCandidateGroundingRecoveryLeafSchema;
  }
  if (
    /\.evidence-map-recovery\.(?:evidence-mapping|evidence-map-repair)\.[a-f0-9]{64}\.[a-f0-9]{64}\.json$/u.test(
      artifactPath,
    )
  ) {
    return AuditEvidenceMapRecoveryLeafSchema;
  }
  if (/\.source-posture-recovery\.[a-f0-9]{64}\.[a-f0-9]{64}\.json$/u.test(artifactPath)) {
    return AuditSourcePostureRecoveryLeafSchema;
  }
  if (artifactPath.includes('.context-overflow.')) return AuditContextOverflowLedgerSchema;
  if (artifactPath.endsWith('.candidate-grounding.json')) {
    return AuditCandidateGroundingDraftSchema;
  }
  if (artifactPath.endsWith('.evidence-map.json')) return AuditEvidenceMapDraftSchema;
  if (artifactPath.endsWith('.source-posture.json')) return AuditSourcePostureDraftSchema;
  if (/(?:^|\/)checkpoints\/[^/]+\/[^/.]+\.json$/u.test(artifactPath)) {
    return AuditVectorCheckpointSchema;
  }
  return undefined;
}

async function readOptionalEvaluationPlanArtifact(
  outputRoot: string,
  artifactPath: string,
): Promise<EvaluationGeneratedPlanCheckpoint | undefined> {
  try {
    return await readJsonArtifact(
      outputRoot,
      artifactPath,
      EvaluationGeneratedPlanCheckpointSchema,
    );
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}

async function readOptionalExpectedEvidenceTraceArtifact(outputRoot: string, artifactPath: string) {
  try {
    return await readJsonArtifact(outputRoot, artifactPath, ExpectedEvidenceTraceCheckpointSchema);
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}

function providerEvaluationLockPath(runId: string): string {
  return `${providerEvaluationWorkPath(runId)}/.provider-evaluation.lock`;
}

/** Serializes one checkpoint writer per run through a metadata-sealed output-jail lease. */
export async function acquireProviderEvaluationLock(
  outputRoot: string,
  runId: string,
  input: Readonly<{
    attemptId?: string;
    checkpointFingerprint?: string;
    createdAt?: string;
    commandMode?: 'fresh' | 'resume-work' | 'resume-finalization';
  }> = {},
): Promise<ProviderEvaluationLock> {
  await ensureSafeOutputRoot(outputRoot);
  const createdAt = input.createdAt ?? new Date().toISOString();
  const metadata = ProviderEvaluationLockMetadataSchema.parse({
    schemaVersion: 1,
    runId,
    attemptId: input.attemptId ?? createStableId('provider-lock-attempt', `${runId}\0${createdAt}`),
    checkpointFingerprint: input.checkpointFingerprint ?? sha256(`provider-lock\0${runId}`),
    createdAt,
    processId: process.pid,
    hostFingerprint: sha256(hostname()),
    commandMode: input.commandMode ?? 'fresh',
  });
  return acquireArtifactLease(outputRoot, providerEvaluationLockPath(runId), { metadata });
}

/** Inspects only source-free lock ownership and checkpoint lifecycle state. */
export async function inspectProviderEvaluationLock(input: {
  outputRoot: string;
  runId: string;
}): Promise<ProviderEvaluationLockInspection> {
  const [metadata, checkpoint] = await Promise.all([
    readArtifactLeaseMetadata(input.outputRoot, providerEvaluationLockPath(input.runId)),
    readProviderEvaluationCheckpoint(input.outputRoot, input.runId),
  ]);
  return ProviderEvaluationLockInspectionSchema.parse({
    lock: metadata === undefined ? null : ProviderEvaluationLockMetadataSchema.parse(metadata),
    checkpoint:
      checkpoint === undefined
        ? null
        : {
            runId: checkpoint.runId,
            status: checkpoint.status,
            configFingerprint: checkpoint.configFingerprint,
            activeAttemptId: checkpoint.activeAttempt?.attemptId ?? null,
          },
  });
}

/**
 * Explicit operator recovery removes only a lock whose run, attempt, and
 * immutable checkpoint fingerprint all match the supplied confirmation.
 */
export async function releaseProviderEvaluationLock(input: {
  outputRoot: string;
  runId: string;
  attemptId: string;
  checkpointFingerprint: string;
}): Promise<void> {
  const { outputRoot, ...confirmationInput } = input;
  const confirmation = z
    .strictObject({
      runId: IdentifierSchema,
      attemptId: IdentifierSchema,
      checkpointFingerprint: Sha256Schema,
    })
    .parse(confirmationInput);
  const metadata = await readArtifactLeaseMetadata(
    outputRoot,
    providerEvaluationLockPath(confirmation.runId),
  );
  const parsedMetadata = ProviderEvaluationLockMetadataSchema.safeParse(metadata);
  if (
    !parsedMetadata.success ||
    parsedMetadata.data.runId !== confirmation.runId ||
    parsedMetadata.data.attemptId !== confirmation.attemptId ||
    parsedMetadata.data.checkpointFingerprint !== confirmation.checkpointFingerprint
  ) {
    throw new ArtifactStoreError(
      'artifact-lease-mismatch',
      'The provider evaluation lock does not match the supplied run, attempt, and checkpoint fingerprint.',
    );
  }
  await releaseArtifactLease(
    outputRoot,
    providerEvaluationLockPath(confirmation.runId),
    parsedMetadata.data,
  );
}

export async function writeProviderEvaluationCheckpoint(
  outputRoot: string,
  checkpoint: ProviderEvaluationCheckpoint,
): Promise<void> {
  const safeOutputRoot = await ensureSafeOutputRoot(outputRoot);
  await writeJsonArtifact(
    safeOutputRoot,
    checkpointPath(checkpoint.runId),
    ProviderEvaluationCheckpointSchema,
    checkpoint,
  );
}

export async function readProviderEvaluationCheckpoint(
  outputRoot: string,
  runId: string,
): Promise<ProviderEvaluationCheckpoint | undefined> {
  try {
    return await readJsonArtifact(
      outputRoot,
      checkpointPath(runId),
      ProviderEvaluationCheckpointSchema,
    );
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}

/**
 * Returns the digest used to seal a frozen finalization payload. It deliberately
 * covers the complete source-free run object rather than a partial aggregate.
 */
export function providerEvaluationRunDigest(run: RealWorldEvaluationRun): string {
  return sha256(canonicalJson(z.json().parse(run)));
}

export type ProviderEvaluationPublicationStep =
  | 'before-run-write'
  | 'before-report-write'
  | 'before-trace-write'
  | 'before-manifest-write'
  | 'before-publish'
  | 'after-publish';

/** Test-only failure seam around side-effect boundaries; production leaves it undefined. */
export type ProviderEvaluationPublicationDependencies = Readonly<{
  beforeStep?: (step: ProviderEvaluationPublicationStep) => Promise<void>;
}>;

const terminalArtifactNames = [
  'evaluation-run.json',
  'evaluation-report.md',
  'case-results.jsonl',
] as const;

function providerEvaluationStagingPath(runId: string, attemptId: string): string {
  return `${providerEvaluationWorkPath(runId)}/staging-${attemptId}`;
}

function providerEvaluationPublishedAttemptPath(runId: string, attemptId: string): string {
  return `${providerEvaluationWorkPath(runId)}/published-attempts/${attemptId}`;
}

function terminalArtifactPaths(runId: string) {
  return {
    jsonPath: `${runId}/evaluation-run.json`,
    markdownPath: `${runId}/evaluation-report.md`,
    trialTracePath: `${runId}/case-results.jsonl`,
    manifestPath: `${runId}/terminal-manifest.json`,
  };
}

/**
 * Stages every provider terminal artifact beneath the evaluator work root,
 * validates one manifest, and exposes the complete directory through exactly
 * one same-filesystem rename. No visible terminal file is written in sequence.
 */
export async function publishProviderEvaluationArtifacts(input: {
  outputRoot: string;
  checkpoint: ProviderEvaluationCheckpoint;
  attemptId: string;
  publishedAt: string;
  dependencies?: ProviderEvaluationPublicationDependencies;
}): Promise<
  Readonly<{
    jsonPath: string;
    markdownPath: string;
    trialTracePath: string;
    manifestPath: string;
  }>
> {
  const finalization = input.checkpoint.finalization;
  if (finalization === null) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Provider terminal publication requires frozen finalization data.',
    );
  }
  if (providerEvaluationRunDigest(finalization.run) !== finalization.aggregateDigest) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Frozen provider evaluation data does not match its aggregate digest.',
    );
  }
  const safeOutputRoot = await ensureSafeOutputRoot(input.outputRoot);
  const stagingPath = providerEvaluationStagingPath(input.checkpoint.runId, input.attemptId);
  const paths = terminalArtifactPaths(input.checkpoint.runId);
  const stagePaths = {
    jsonPath: `${stagingPath}/evaluation-run.json`,
    markdownPath: `${stagingPath}/evaluation-report.md`,
    trialTracePath: `${stagingPath}/case-results.jsonl`,
    manifestPath: `${stagingPath}/terminal-manifest.json`,
  };

  try {
    await input.dependencies?.beforeStep?.('before-run-write');
    await writeJsonArtifact(
      safeOutputRoot,
      stagePaths.jsonPath,
      RealWorldEvaluationRunSchema,
      finalization.run,
    );
    await input.dependencies?.beforeStep?.('before-report-write');
    await writeMarkdownArtifact(safeOutputRoot, stagePaths.markdownPath, finalization.report);
    await input.dependencies?.beforeStep?.('before-trace-write');
    await writeJsonLinesArtifact(
      safeOutputRoot,
      stagePaths.trialTracePath,
      EvaluationTrialSchema,
      finalization.run.trials,
    );
    const manifest = await createProviderEvaluationTerminalManifest({
      outputRoot: safeOutputRoot,
      checkpoint: input.checkpoint,
      attemptId: input.attemptId,
      publishedAt: input.publishedAt,
      stagingPath,
    });
    await input.dependencies?.beforeStep?.('before-manifest-write');
    await writeJsonArtifact(
      safeOutputRoot,
      stagePaths.manifestPath,
      ProviderEvaluationTerminalManifestSchema,
      manifest,
    );
    await validateProviderEvaluationArtifactSet({
      outputRoot: safeOutputRoot,
      directoryPath: stagingPath,
      checkpoint: input.checkpoint,
      expectedManifest: manifest,
    });
    await input.dependencies?.beforeStep?.('before-publish');
    await publishStagedProviderEvaluationDirectory({
      outputRoot: safeOutputRoot,
      runId: input.checkpoint.runId,
      stagingPath,
    });
    await input.dependencies?.beforeStep?.('after-publish');
    await validateProviderEvaluationArtifactSet({
      outputRoot: safeOutputRoot,
      directoryPath: input.checkpoint.runId,
      checkpoint: input.checkpoint,
      expectedManifest: manifest,
    });
    return paths;
  } catch (error) {
    await removeArtifactDirectory(safeOutputRoot, stagingPath).catch(() => undefined);
    throw error;
  }
}

/** Reads and revalidates the visible terminal set before a checkpoint may become completed. */
export async function validatePublishedProviderEvaluationArtifacts(input: {
  outputRoot: string;
  checkpoint: ProviderEvaluationCheckpoint;
}): Promise<ProviderEvaluationTerminalManifest> {
  const safeOutputRoot = await ensureSafeOutputRoot(input.outputRoot);
  return validateProviderEvaluationArtifactSet({
    outputRoot: safeOutputRoot,
    directoryPath: input.checkpoint.runId,
    checkpoint: input.checkpoint,
  });
}

/**
 * Moves one validated public terminal set below the private evaluator root
 * before explicit unfinished recovery republishes the same logical run id.
 * The move is atomic, never overwrites an earlier retained attempt, and lets a
 * process stopped between the move and checkpoint write recover idempotently.
 */
export async function archivePublishedProviderEvaluationArtifacts(input: {
  outputRoot: string;
  runId: string;
  publishedAttemptId: string;
}): Promise<Readonly<{ archivePath: string; alreadyArchived: boolean }>> {
  const safeOutputRoot = await ensureSafeOutputRoot(input.outputRoot);
  const archivePath = providerEvaluationPublishedAttemptPath(input.runId, input.publishedAttemptId);
  const publicPath = join(safeOutputRoot, input.runId);
  const archiveAbsolutePath = join(safeOutputRoot, archivePath);
  const [publicStatus, archiveStatus] = await Promise.all([
    lstat(publicPath).catch(() => undefined),
    lstat(archiveAbsolutePath).catch(() => undefined),
  ]);
  if (
    archiveStatus !== undefined &&
    (!archiveStatus.isDirectory() || archiveStatus.isSymbolicLink())
  ) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'The retained provider evaluation attempt is invalid.',
    );
  }
  if (publicStatus === undefined) {
    if (archiveStatus !== undefined) return { archivePath, alreadyArchived: true };
    throw new ArtifactStoreError(
      'artifact-not-found',
      'Provider terminal artifacts are unavailable for explicit unfinished recovery.',
    );
  }
  if (!publicStatus.isDirectory() || publicStatus.isSymbolicLink() || archiveStatus !== undefined) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Provider terminal artifacts cannot be safely retained for unfinished recovery.',
    );
  }
  await mkdir(join(safeOutputRoot, providerEvaluationWorkPath(input.runId), 'published-attempts'), {
    recursive: true,
  });
  await rename(publicPath, archiveAbsolutePath);
  return { archivePath, alreadyArchived: false };
}

/**
 * Checks whether a terminal destination is already occupied without treating
 * its contents as valid. Fresh provider runs use this before dispatching a
 * model so an orphaned terminal directory can never be overwritten.
 */
export async function providerEvaluationTerminalArtifactsExist(input: {
  outputRoot: string;
  runId: string;
}): Promise<boolean> {
  const safeOutputRoot = await ensureSafeOutputRoot(input.outputRoot);
  return (await lstat(join(safeOutputRoot, input.runId)).catch(() => undefined)) !== undefined;
}

/**
 * Fresh commands must not reuse an interrupted attempt's private staging
 * directory. A later explicit resume owns recovery from that state.
 */
export async function providerEvaluationStagingArtifactsExist(input: {
  outputRoot: string;
  runId: string;
}): Promise<boolean> {
  const safeOutputRoot = await ensureSafeOutputRoot(input.outputRoot);
  const workDirectory = join(safeOutputRoot, providerEvaluationWorkPath(input.runId));
  const entries = await readdir(workDirectory, { withFileTypes: true }).catch((error) => {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return [];
    throw error;
  });
  return entries.some((entry) => entry.name.startsWith('staging-'));
}

async function createProviderEvaluationTerminalManifest(input: {
  outputRoot: string;
  checkpoint: ProviderEvaluationCheckpoint;
  attemptId: string;
  publishedAt: string;
  stagingPath: string;
}): Promise<ProviderEvaluationTerminalManifest> {
  const finalization = input.checkpoint.finalization;
  if (finalization === null) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Provider terminal manifest requires frozen finalization data.',
    );
  }
  const requiredArtifacts = await Promise.all(
    terminalArtifactNames.map(async (name) => {
      const bytes = await readFile(join(input.outputRoot, input.stagingPath, name));
      return {
        name,
        schemaVersion: name === 'evaluation-run.json' ? finalization.run.schemaVersion : null,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      };
    }),
  );
  return ProviderEvaluationTerminalManifestSchema.parse({
    schemaVersion: 1,
    runId: input.checkpoint.runId,
    configFingerprint: input.checkpoint.configFingerprint,
    packId: input.checkpoint.packId,
    packVersion: input.checkpoint.packVersion,
    corpusManifestDigest: input.checkpoint.corpusManifestDigest,
    populationDigest: input.checkpoint.populationDigest,
    benchmarkProtocolFingerprint: input.checkpoint.benchmarkProtocolFingerprint,
    provider: input.checkpoint.provider,
    model: input.checkpoint.model,
    planProfile: input.checkpoint.planProfile,
    semanticPlanEvaluator: input.checkpoint.semanticPlanEvaluator,
    requiredArtifacts,
    frozenTrialIds: input.checkpoint.selectedTrialPopulation,
    aggregateDigest: finalization.aggregateDigest,
    publishedAt: input.publishedAt,
    attemptId: input.attemptId,
    terminalStatus: 'completed',
  });
}

async function validateProviderEvaluationArtifactSet(input: {
  outputRoot: string;
  directoryPath: string;
  checkpoint: ProviderEvaluationCheckpoint;
  expectedManifest?: ProviderEvaluationTerminalManifest;
}): Promise<ProviderEvaluationTerminalManifest> {
  const manifest = await readJsonArtifact(
    input.outputRoot,
    `${input.directoryPath}/terminal-manifest.json`,
    ProviderEvaluationTerminalManifestSchema,
  );
  if (
    manifest.runId !== input.checkpoint.runId ||
    manifest.configFingerprint !== input.checkpoint.configFingerprint ||
    manifest.populationDigest !== input.checkpoint.populationDigest ||
    canonicalJson(manifest.semanticPlanEvaluator) !==
      canonicalJson(input.checkpoint.semanticPlanEvaluator) ||
    manifest.aggregateDigest !== input.checkpoint.finalization?.aggregateDigest ||
    (input.expectedManifest !== undefined &&
      canonicalJson(z.json().parse(manifest)) !==
        canonicalJson(z.json().parse(input.expectedManifest)))
  ) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Provider terminal manifest does not match the sealed evaluation checkpoint.',
    );
  }
  const finalization = input.checkpoint.finalization;
  if (
    finalization === null ||
    providerEvaluationRunDigest(finalization.run) !== manifest.aggregateDigest
  ) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Provider terminal manifest does not match frozen evaluation data.',
    );
  }
  const run = await readJsonArtifact(
    input.outputRoot,
    `${input.directoryPath}/evaluation-run.json`,
    RealWorldEvaluationRunSchema,
  );
  if (
    canonicalJson(z.json().parse(run)) !== canonicalJson(z.json().parse(finalization.run)) ||
    canonicalPopulation(run.selectedTrialPopulation) !==
      canonicalPopulation(input.checkpoint.selectedTrialPopulation)
  ) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Provider terminal run does not match frozen evaluation data.',
    );
  }
  for (const artifact of manifest.requiredArtifacts) {
    const bytes = await readFile(join(input.outputRoot, input.directoryPath, artifact.name));
    if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.sha256) {
      throw new ArtifactStoreError(
        'artifact-schema-invalid',
        'Provider terminal artifact digest does not match its manifest.',
      );
    }
  }
  const trace = await readFile(
    join(input.outputRoot, input.directoryPath, 'case-results.jsonl'),
    'utf8',
  );
  const parsedTrials = trace
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => EvaluationTrialSchema.parse(JSON.parse(line)));
  if (canonicalJson(z.json().parse(parsedTrials)) !== canonicalJson(z.json().parse(run.trials))) {
    throw new ArtifactStoreError(
      'artifact-schema-invalid',
      'Provider terminal trial trace does not match the frozen evaluation run.',
    );
  }
  return manifest;
}

async function publishStagedProviderEvaluationDirectory(input: {
  outputRoot: string;
  runId: string;
  stagingPath: string;
}): Promise<void> {
  const stagingAbsolutePath = join(input.outputRoot, input.stagingPath);
  const destinationAbsolutePath = join(input.outputRoot, input.runId);
  const stagingStatus = await lstat(stagingAbsolutePath).catch(() => undefined);
  const destinationStatus = await lstat(destinationAbsolutePath).catch(() => undefined);
  if (destinationStatus !== undefined) {
    throw new ProviderEvaluationPublicationError(
      'terminal-destination-occupied',
      'Provider terminal artifacts cannot be atomically published at this output path.',
    );
  }
  if (
    stagingStatus === undefined ||
    !stagingStatus.isDirectory() ||
    stagingStatus.isSymbolicLink()
  ) {
    throw new ProviderEvaluationPublicationError(
      'staging-directory-invalid',
      'Provider terminal artifact staging is invalid.',
    );
  }
  try {
    await rename(stagingAbsolutePath, destinationAbsolutePath);
  } catch {
    throw new ProviderEvaluationPublicationError(
      'rename-failed',
      'Provider terminal artifact publication failed before a complete set became visible.',
    );
  }
}

function canonicalPopulation(
  population: readonly { caseId: string; variant: string; repetition: number }[],
): string {
  return population
    .map((entry) => `${entry.caseId}\0${entry.variant}\0${entry.repetition}`)
    .join('\n');
}

export async function writeProviderSmokeCheckpoint(
  outputRoot: string,
  checkpoint: ProviderSmokeCheckpoint,
): Promise<void> {
  const safeOutputRoot = await ensureSafeOutputRoot(outputRoot);
  await writeJsonArtifact(
    safeOutputRoot,
    smokeCheckpointPath(checkpoint.runId),
    ProviderSmokeCheckpointSchema,
    checkpoint,
  );
}

export async function readProviderSmokeCheckpoint(
  outputRoot: string,
  runId: string,
): Promise<ProviderSmokeCheckpoint | undefined> {
  try {
    return await readJsonArtifact(
      outputRoot,
      smokeCheckpointPath(runId),
      ProviderSmokeCheckpointSchema,
    );
  } catch (error) {
    if (error instanceof ArtifactStoreError && error.code === 'artifact-not-found')
      return undefined;
    throw error;
  }
}

/** Persists the validated, source-free run summary and its human Markdown projection. */
export async function writeRealWorldEvaluationArtifacts(
  outputRoot: string,
  run: RealWorldEvaluationRun,
  report: string,
): Promise<Readonly<{ jsonPath: string; markdownPath: string; trialTracePath: string }>> {
  const safeOutputRoot = await ensureSafeOutputRoot(outputRoot);
  const jsonPath = `${run.runId}/evaluation-run.json`;
  const markdownPath = `${run.runId}/evaluation-report.md`;
  const trialTracePath = `${run.runId}/case-results.jsonl`;
  await writeJsonArtifact(safeOutputRoot, jsonPath, RealWorldEvaluationRunSchema, run);
  await writeJsonLinesArtifact(safeOutputRoot, trialTracePath, EvaluationTrialSchema, run.trials);
  await writeMarkdownArtifact(safeOutputRoot, markdownPath, report);
  return { jsonPath, markdownPath, trialTracePath };
}
