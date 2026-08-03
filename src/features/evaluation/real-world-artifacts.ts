import {
  ArtifactStoreError,
  acquireArtifactLease,
  readJsonArtifact,
  writeJsonArtifact,
  writeJsonLinesArtifact,
  writeMarkdownArtifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { ensureSafeOutputRoot } from '../../platform/artifact-store/root-topology.js';
import type {
  AuditCandidateAwareCheckpoint,
  AuditCandidateGroundingDraft,
  AuditContextOverflowLedger,
  AuditEvidenceMapDraft,
  AuditSourcePostureDraft,
  AuditVectorResult,
} from '../audit-execution/audit.schema.js';
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
} from '../audit-execution/audit.schema.js';
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
} from '../audit-execution/checkpoints.js';
import type { ModelStageObservation } from '../model-operations/model-operations.js';
import { modelStagesForAudit } from '../review-workflow/service.js';

import {
  type EvaluationGeneratedPlanCheckpoint,
  EvaluationGeneratedPlanCheckpointSchema,
  EvaluationTrialSchema,
  type ProviderEvaluationCheckpoint,
  ProviderEvaluationCheckpointSchema,
  type RealWorldEvaluationRun,
  RealWorldEvaluationRunSchema,
} from './corpus.schema.js';
import {
  type ProviderSmokeCheckpoint,
  ProviderSmokeCheckpointSchema,
} from './provider-smoke.schema.js';
import type {
  EvaluationAuditCheckpointStore,
  EvaluationPlanningCheckpointStore,
} from './real-world-runner.js';

const checkpointPath = (runId: string) => `${runId}/checkpoint.json`;
const smokeCheckpointPath = (runId: string) => `smokes/${runId}.checkpoint.json`;

function evaluatorWorkPath(runId: string, artifactPath: string): string {
  return `${runId}/.work/${artifactPath}`;
}

function generatedPlanCheckpointPath(trialId: string): string {
  return `plans/${trialId}.json`;
}

export type ProviderEvaluationLock = Awaited<ReturnType<typeof acquireArtifactLease>>;

/**
 * Reconstructs every exact source-free observation retained in evaluator work
 * checkpoints. The shared cost guard deduplicates byte-identical observations,
 * which covers overlapping predecessor and terminal artifacts without losing
 * paid work after an interrupted process.
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
    ...input.evidenceMapDrafts.flatMap((draft) =>
      draft.modelObservation === undefined ? [] : [draft.modelObservation],
    ),
    ...input.sourcePostureDrafts.flatMap((draft) =>
      draft.modelObservation === undefined ? [] : [draft.modelObservation],
    ),
    ...input.candidateGroundingDrafts.flatMap((draft) => [
      ...(draft.discoveryObservation === undefined ? [] : [draft.discoveryObservation]),
      ...(draft.modelObservation === undefined ? [] : [draft.modelObservation]),
    ]),
    ...input.candidateAwareCheckpoints.flatMap((checkpoint) =>
      checkpoint.result?.modelObservation === undefined ? [] : [checkpoint.result.modelObservation],
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
          retryUnfinished,
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
        ...(draft.modelObservation === undefined
          ? {}
          : { modelObservation: draft.modelObservation }),
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
        sourcePosture: draft.sourcePosture,
        ...(draft.modelObservation === undefined
          ? {}
          : { modelObservation: draft.modelObservation }),
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
        findings: draft.findings,
        closures: draft.closures,
        hypothesisGroundingFunnel: draft.hypothesisGroundingFunnel,
        candidateIntegrityRejections: draft.candidateIntegrityRejections,
        ...(draft.discoveryObservation === undefined
          ? {}
          : { discoveryObservation: draft.discoveryObservation }),
        ...(draft.modelObservation === undefined
          ? {}
          : { modelObservation: draft.modelObservation }),
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
        candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
        phase: update.phase,
        candidateOrdinal: update.candidateOrdinal,
        candidate: update.candidate,
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
      const key = `${binding.runId}\0${update.vectorId}\0${update.phase}`;
      const current = contextOverflowLedgersByStage.get(key);
      const ledger = createAuditContextOverflowLedger({
        binding: vectorBinding(binding, plan, update.vectorId),
        plan,
        phase: update.phase,
        parentStageId: update.parentStageId,
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
        parentStageId: update.parentStageId,
        recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
        rootScopeFingerprint: update.rootScopeFingerprint,
        childKey: update.childKey,
        scopeFingerprint: update.scopeFingerprint,
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
        recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
        rootScopeFingerprint: update.rootScopeFingerprint,
        childKey: update.childKey,
        scopeFingerprint: update.scopeFingerprint,
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
        recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
        rootScopeFingerprint: update.rootScopeFingerprint,
        childKey: update.childKey,
        scopeFingerprint: update.scopeFingerprint,
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
  if (/\.candidate-grounding-recovery\.[a-f0-9]{64}\.json$/u.test(artifactPath)) {
    return AuditCandidateGroundingRecoveryLeafSchema;
  }
  if (/\.evidence-map-recovery\.[a-f0-9]{64}\.json$/u.test(artifactPath)) {
    return AuditEvidenceMapRecoveryLeafSchema;
  }
  if (/\.source-posture-recovery\.[a-f0-9]{64}\.json$/u.test(artifactPath)) {
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

/** Serializes one checkpoint writer per run through the shared output-jail lease. */
export async function acquireProviderEvaluationLock(
  outputRoot: string,
  runId: string,
): Promise<ProviderEvaluationLock> {
  await ensureSafeOutputRoot(outputRoot);
  return acquireArtifactLease(outputRoot, `${runId}/.provider-evaluation.lock`);
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
