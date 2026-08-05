import {
  readOptionalJsonArtifact,
  writeJsonArtifact,
  writeMarkdownArtifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import type { AttackPlan } from '../attack-planning/index.js';
import {
  type PublicAuditReport,
  PublicAuditReportSchema,
} from '../audit-report/public-contract.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';
import type { AuditInput } from './audit.js';
import {
  type AuditCandidateAwareCheckpoint,
  AuditCandidateAwareCheckpointSchema,
  type AuditCandidateGroundingDraft,
  AuditCandidateGroundingDraftSchema,
  AuditCandidateGroundingRecoveryLeafSchema,
  type AuditCheckpointBinding,
  type AuditContextOverflowLedger,
  AuditContextOverflowLedgerSchema,
  type AuditEvidenceMapDraft,
  AuditEvidenceMapDraftSchema,
  AuditEvidenceMapRecoveryLeafSchema,
  type AuditSourcePostureDraft,
  AuditSourcePostureDraftSchema,
  AuditSourcePostureRecoveryLeafSchema,
  AuditVectorCheckpointSchema,
  type AuditVectorResult,
  materializeAuditVectorResultForPersistence,
  modelObservationForAuditCheckpointExecution,
} from './audit.schema.js';
import {
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
  createAuditResumeState,
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
} from './checkpoints.js';
import { modelStagesForAudit } from './model-stage-observations.js';

type AuditPersistenceBaseBinding = Readonly<{
  runId: string;
  planId: string;
  targetFingerprint: string;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
}>;

type AuditPersistenceCallbacks = Pick<
  AuditInput,
  | 'onEvidenceMapDraft'
  | 'onCandidateGroundingDraft'
  | 'onCandidateAwareCheckpoint'
  | 'onSourcePostureDraft'
  | 'onContextOverflowTransition'
  | 'onEvidenceMapRecoveryLeaf'
  | 'onSourcePostureRecoveryLeaf'
  | 'onCandidateGroundingRecoveryLeaf'
  | 'onVectorResult'
>;

export type AuditPersistenceSession = Readonly<{
  resumeState: ReturnType<typeof createAuditResumeState>;
  priorModelStages: readonly ModelStageObservation[];
  callbacks: AuditPersistenceCallbacks;
}>;

/**
 * The sole CLI-persistence owner for exact audit checkpoint identity creation.
 * It creates no artifacts and makes no lifecycle decision.
 */
export function createAuditPersistenceBindingFactory(input: {
  runId: string;
  plan: AttackPlan;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
}): Readonly<{
  base: AuditPersistenceBaseBinding;
  forVector: (vectorId: string) => AuditCheckpointBinding;
}> {
  const base = {
    runId: input.runId,
    planId: input.plan.planId,
    targetFingerprint: input.plan.targetFingerprint,
    provider: input.provider,
    model: input.model,
    verificationRouteFingerprint: input.verificationRouteFingerprint,
    evidenceMapProtocolFingerprint: input.evidenceMapProtocolFingerprint,
    reviewWorkflowProtocolFingerprint: input.reviewWorkflowProtocolFingerprint,
  };
  return Object.freeze({
    base: Object.freeze(base),
    forVector: (vectorId) =>
      createAuditCheckpointBinding({ binding: base, plan: input.plan, vectorId }),
  });
}

/** Schema-validated, jailed reads for audit recovery artifacts only. */
export function createAuditArtifactReader(outputRoot: string): Readonly<{
  vectorCheckpoint: (artifactPath: string) => ReturnType<typeof readVectorCheckpoint>;
  candidateGroundingDraft: (artifactPath: string) => ReturnType<typeof readCandidateGroundingDraft>;
  candidateAwareCheckpoint: (
    artifactPath: string,
  ) => ReturnType<typeof readCandidateAwareCheckpoint>;
  evidenceMapDraft: (artifactPath: string) => ReturnType<typeof readEvidenceMapDraft>;
  sourcePostureDraft: (artifactPath: string) => ReturnType<typeof readSourcePostureDraft>;
  contextOverflowLedger: (artifactPath: string) => ReturnType<typeof readContextOverflowLedger>;
  evidenceMapRecoveryLeaf: (artifactPath: string) => ReturnType<typeof readEvidenceMapRecoveryLeaf>;
  sourcePostureRecoveryLeaf: (
    artifactPath: string,
  ) => ReturnType<typeof readSourcePostureRecoveryLeaf>;
  candidateGroundingRecoveryLeaf: (
    artifactPath: string,
  ) => ReturnType<typeof readCandidateGroundingRecoveryLeaf>;
}> {
  return Object.freeze({
    vectorCheckpoint: (artifactPath) => readVectorCheckpoint(outputRoot, artifactPath),
    candidateGroundingDraft: (artifactPath) =>
      readCandidateGroundingDraft(outputRoot, artifactPath),
    candidateAwareCheckpoint: (artifactPath) =>
      readCandidateAwareCheckpoint(outputRoot, artifactPath),
    evidenceMapDraft: (artifactPath) => readEvidenceMapDraft(outputRoot, artifactPath),
    sourcePostureDraft: (artifactPath) => readSourcePostureDraft(outputRoot, artifactPath),
    contextOverflowLedger: (artifactPath) => readContextOverflowLedger(outputRoot, artifactPath),
    evidenceMapRecoveryLeaf: (artifactPath) =>
      readEvidenceMapRecoveryLeaf(outputRoot, artifactPath),
    sourcePostureRecoveryLeaf: (artifactPath) =>
      readSourcePostureRecoveryLeaf(outputRoot, artifactPath),
    candidateGroundingRecoveryLeaf: (artifactPath) =>
      readCandidateGroundingRecoveryLeaf(outputRoot, artifactPath),
  });
}

/**
 * Owns exact audit recovery reads and durable stage callback writes. The CLI
 * supplies immutable command identity; the audit core keeps lifecycle control.
 */
export function createAuditPersistenceAdapter(input: {
  privateWork: string;
  runId: string;
  plan: AttackPlan;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
}): Readonly<{
  loadSession: (input: {
    resume: boolean;
    retryUnfinished: boolean;
  }) => Promise<AuditPersistenceSession>;
}> {
  const bindings = createAuditPersistenceBindingFactory(input);
  const reader = createAuditArtifactReader(input.privateWork);

  return Object.freeze({
    loadSession: async ({ resume, retryUnfinished }) => {
      const priorVectorResults = resume
        ? await loadReusableAuditVectorResults({
            binding: bindings.base,
            plan: input.plan,
            retryUnfinished,
            reader: reader.vectorCheckpoint,
          })
        : [];
      const observedVectorResults = resume
        ? await loadObservedAuditVectorResults({
            binding: bindings.base,
            plan: input.plan,
            reader: reader.vectorCheckpoint,
          })
        : [];
      const priorCandidateGroundingDrafts = resume
        ? await loadReusableAuditCandidateGroundingDrafts({
            binding: bindings.base,
            candidateGroundingProtocolFingerprint: input.reviewWorkflowProtocolFingerprint,
            plan: input.plan,
            reader: reader.candidateGroundingDraft,
          })
        : [];
      const priorCandidateAwareCheckpoints = resume
        ? await loadReusableAuditCandidateAwareCheckpoints({
            binding: bindings.base,
            candidateGroundingProtocolFingerprint: input.reviewWorkflowProtocolFingerprint,
            plan: input.plan,
            drafts: priorCandidateGroundingDrafts,
            reader: reader.candidateAwareCheckpoint,
          })
        : [];
      const priorEvidenceMapDrafts = resume
        ? await loadReusableAuditEvidenceMapDrafts({
            binding: bindings.base,
            plan: input.plan,
            reader: reader.evidenceMapDraft,
          })
        : [];
      const priorSourcePostureDrafts = resume
        ? await loadReusableAuditSourcePostureDrafts({
            binding: bindings.base,
            plan: input.plan,
            reader: reader.sourcePostureDraft,
          })
        : [];
      const priorContextOverflowLedgers = resume
        ? await loadReusableAuditContextOverflowLedgers({
            binding: bindings.base,
            plan: input.plan,
            reader: reader.contextOverflowLedger,
          })
        : [];
      const priorEvidenceMapRecoveryLeaves = resume
        ? await loadReusableAuditEvidenceMapRecoveryLeaves({
            binding: bindings.base,
            plan: input.plan,
            ledgers: priorContextOverflowLedgers,
            reader: reader.evidenceMapRecoveryLeaf,
          })
        : [];
      const priorSourcePostureRecoveryLeaves = resume
        ? await loadReusableAuditSourcePostureRecoveryLeaves({
            binding: bindings.base,
            plan: input.plan,
            ledgers: priorContextOverflowLedgers,
            reader: reader.sourcePostureRecoveryLeaf,
          })
        : [];
      const priorCandidateGroundingRecoveryLeaves = resume
        ? await loadReusableAuditCandidateGroundingRecoveryLeaves({
            binding: bindings.base,
            plan: input.plan,
            ledgers: priorContextOverflowLedgers,
            reader: reader.candidateGroundingRecoveryLeaf,
          })
        : [];
      const ledgersByStage = new Map(
        priorContextOverflowLedgers.map((ledger) => [contextOverflowLedgerKey(ledger), ledger]),
      );

      return {
        resumeState: createAuditResumeState({
          vectorResults: priorVectorResults,
          candidateGroundingDrafts: priorCandidateGroundingDrafts,
          candidateAwareCheckpoints: priorCandidateAwareCheckpoints,
          evidenceMapDrafts: priorEvidenceMapDrafts,
          sourcePostureDrafts: priorSourcePostureDrafts,
          contextOverflowLedgers: priorContextOverflowLedgers,
          evidenceMapRecoveryLeaves: priorEvidenceMapRecoveryLeaves,
          sourcePostureRecoveryLeaves: priorSourcePostureRecoveryLeaves,
          candidateGroundingRecoveryLeaves: priorCandidateGroundingRecoveryLeaves,
        }),
        priorModelStages: resumedModelStages({
          priorVectorResults: observedVectorResults,
          priorCandidateGroundingDrafts,
          priorCandidateAwareCheckpoints,
          priorEvidenceMapDrafts,
          priorSourcePostureDrafts,
          priorContextOverflowLedgers,
        }),
        callbacks: createAuditPersistenceCallbacks({
          privateWork: input.privateWork,
          plan: input.plan,
          bindings,
          candidateGroundingProtocolFingerprint: input.reviewWorkflowProtocolFingerprint,
          contextOverflowLedgersByStage: ledgersByStage,
        }),
      };
    },
  });
}

/** Writes the exact source-minimal public report pair through the output jail. */
export async function writeAuditReportArtifacts(input: {
  publicArtifacts: string;
  report: PublicAuditReport;
  markdown: string;
}): Promise<void> {
  await writeJsonArtifact(
    input.publicArtifacts,
    `reports/${input.report.reportId}.json`,
    PublicAuditReportSchema,
    input.report,
  );
  await writeMarkdownArtifact(
    input.publicArtifacts,
    `reports/${input.report.reportId}.md`,
    input.markdown,
  );
}

function createAuditPersistenceCallbacks(input: {
  privateWork: string;
  plan: AttackPlan;
  bindings: ReturnType<typeof createAuditPersistenceBindingFactory>;
  candidateGroundingProtocolFingerprint: string;
  contextOverflowLedgersByStage: Map<string, AuditContextOverflowLedger>;
}): AuditPersistenceCallbacks {
  return {
    onEvidenceMapDraft: async (draft) => {
      const binding = input.bindings.forVector(draft.vectorId);
      await writeJsonArtifact(
        input.privateWork,
        auditEvidenceMapDraftPath(binding.runId, draft.vectorId),
        AuditEvidenceMapDraftSchema,
        createAuditEvidenceMapDraft({
          ...draft,
          binding,
          plan: input.plan,
          savedAt: new Date().toISOString(),
        }),
      );
    },
    onCandidateGroundingDraft: async (draft) => {
      const binding = input.bindings.forVector(draft.vectorId);
      await writeJsonArtifact(
        input.privateWork,
        auditCandidateGroundingDraftPath(binding.runId, draft.vectorId),
        AuditCandidateGroundingDraftSchema,
        createAuditCandidateGroundingDraft({
          ...draft,
          binding,
          plan: input.plan,
          candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
          savedAt: new Date().toISOString(),
        }),
      );
    },
    onCandidateAwareCheckpoint: async (update) => {
      const binding = input.bindings.forVector(update.vectorId);
      await writeJsonArtifact(
        input.privateWork,
        auditCandidateAwareCheckpointPath({
          runId: binding.runId,
          vectorId: update.vectorId,
          phase: update.phase,
          candidateOrdinal: update.candidateOrdinal,
        }),
        AuditCandidateAwareCheckpointSchema,
        createAuditCandidateAwareCheckpoint({
          ...update,
          binding,
          plan: input.plan,
          candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
          savedAt: new Date().toISOString(),
        }),
      );
    },
    onSourcePostureDraft: async (draft) => {
      const binding = input.bindings.forVector(draft.vectorId);
      await writeJsonArtifact(
        input.privateWork,
        auditSourcePostureDraftPath(binding.runId, draft.vectorId),
        AuditSourcePostureDraftSchema,
        createAuditSourcePostureDraft({
          ...draft,
          binding,
          plan: input.plan,
          savedAt: new Date().toISOString(),
        }),
      );
    },
    onContextOverflowTransition: async (update) => {
      const key = contextOverflowLedgerKey(update);
      const current = input.contextOverflowLedgersByStage.get(key);
      const events = [
        ...(current?.events ?? []),
        {
          ordinal: (current?.events.length ?? 0) + 1,
          ...update.event,
          savedAt: new Date().toISOString(),
        },
      ];
      const binding = input.bindings.forVector(update.vectorId);
      const ledger = createAuditContextOverflowLedger({
        ...update,
        binding,
        plan: input.plan,
        events,
      });
      input.contextOverflowLedgersByStage.set(key, ledger);
      await writeJsonArtifact(
        input.privateWork,
        auditContextOverflowLedgerPath({
          runId: binding.runId,
          vectorId: update.vectorId,
          phase: update.phase,
        }),
        AuditContextOverflowLedgerSchema,
        ledger,
      );
    },
    onEvidenceMapRecoveryLeaf: async (update) => {
      const binding = input.bindings.forVector(update.vectorId);
      const leaf = createAuditEvidenceMapRecoveryLeaf({
        ...update,
        binding,
        plan: input.plan,
        savedAt: new Date().toISOString(),
      });
      await writeJsonArtifact(
        input.privateWork,
        auditEvidenceMapRecoveryLeafPath({
          runId: binding.runId,
          vectorId: update.vectorId,
          phase: update.phase,
          phaseInputFingerprint: update.phaseInputFingerprint,
          scopeFingerprint: update.scopeFingerprint,
        }),
        AuditEvidenceMapRecoveryLeafSchema,
        leaf,
      );
    },
    onSourcePostureRecoveryLeaf: async (update) => {
      const binding = input.bindings.forVector(update.vectorId);
      const leaf = createAuditSourcePostureRecoveryLeaf({
        ...update,
        binding,
        plan: input.plan,
        savedAt: new Date().toISOString(),
      });
      await writeJsonArtifact(
        input.privateWork,
        auditSourcePostureRecoveryLeafPath({
          runId: binding.runId,
          vectorId: update.vectorId,
          phaseInputFingerprint: update.phaseInputFingerprint,
          scopeFingerprint: update.scopeFingerprint,
        }),
        AuditSourcePostureRecoveryLeafSchema,
        leaf,
      );
    },
    onCandidateGroundingRecoveryLeaf: async (update) => {
      const binding = input.bindings.forVector(update.vectorId);
      const leaf = createAuditCandidateGroundingRecoveryLeaf({
        ...update,
        binding,
        plan: input.plan,
        savedAt: new Date().toISOString(),
      });
      await writeJsonArtifact(
        input.privateWork,
        auditCandidateGroundingRecoveryLeafPath({
          runId: binding.runId,
          vectorId: update.vectorId,
          phaseInputFingerprint: update.phaseInputFingerprint,
          scopeFingerprint: update.scopeFingerprint,
        }),
        AuditCandidateGroundingRecoveryLeafSchema,
        leaf,
      );
    },
    onVectorResult: async (result) => {
      const durableResult = materializeAuditVectorResultForPersistence(result);
      const binding = input.bindings.forVector(durableResult.coverage.vectorId);
      await writeJsonArtifact(
        input.privateWork,
        auditCheckpointPath(binding.runId, durableResult.coverage.vectorId),
        AuditVectorCheckpointSchema,
        createAuditVectorCheckpoint({
          binding,
          plan: input.plan,
          result: durableResult,
          savedAt: new Date().toISOString(),
        }),
      );
    },
  };
}

function contextOverflowLedgerKey(input: { vectorId: string; phase: string }): string {
  return `${input.vectorId}\0${input.phase}`;
}

/** Retains each reusable stage exactly once before a resumed cost ceiling dispatches work. */
function resumedModelStages(input: {
  priorVectorResults: readonly AuditVectorResult[];
  priorCandidateGroundingDrafts: readonly AuditCandidateGroundingDraft[];
  priorCandidateAwareCheckpoints: readonly AuditCandidateAwareCheckpoint[];
  priorEvidenceMapDrafts: readonly AuditEvidenceMapDraft[];
  priorSourcePostureDrafts: readonly AuditSourcePostureDraft[];
  priorContextOverflowLedgers: readonly AuditContextOverflowLedger[];
}): readonly ModelStageObservation[] {
  const terminalVectorIds = new Set(
    input.priorVectorResults.map((result) => result.coverage.vectorId),
  );
  const stages = [
    ...modelStagesForAudit(input.priorVectorResults.map((result) => result.coverage)),
    ...input.priorEvidenceMapDrafts.flatMap((draft) =>
      terminalVectorIds.has(draft.vectorId)
        ? []
        : (modelObservationForAuditCheckpointExecution(draft.execution) ?? []),
    ),
    ...input.priorSourcePostureDrafts.flatMap((draft) =>
      terminalVectorIds.has(draft.vectorId)
        ? []
        : (modelObservationForAuditCheckpointExecution(draft.execution) ?? []),
    ),
    ...input.priorCandidateGroundingDrafts.flatMap((draft) =>
      terminalVectorIds.has(draft.vectorId)
        ? []
        : [draft.discoveryObservation, draft.modelObservation].filter(
            (stage): stage is ModelStageObservation => stage !== undefined,
          ),
    ),
    ...input.priorCandidateAwareCheckpoints.flatMap((checkpoint) => {
      if (terminalVectorIds.has(checkpoint.vectorId)) return [];
      if (checkpoint.result !== undefined)
        return modelObservationForAuditCheckpointExecution(checkpoint.result.execution) ?? [];
      return (
        checkpoint.contextOverflowTopology?.events.flatMap((event) =>
          event.execution?.kind === 'provider' ? [event.execution.modelObservation] : [],
        ) ?? []
      );
    }),
    ...reusableContextOverflowModelStages({
      ledgers: input.priorContextOverflowLedgers,
      terminalVectorResults: input.priorVectorResults,
      evidenceMapDrafts: input.priorEvidenceMapDrafts,
      sourcePostureDrafts: input.priorSourcePostureDrafts,
      candidateGroundingDrafts: input.priorCandidateGroundingDrafts,
    }),
  ];
  const byIdentity = new Map<string, ModelStageObservation>();
  for (const stage of stages) {
    const identity = `${stage.route}\0${stage.stage}\0${stage.stageId}`;
    const existing = byIdentity.get(identity);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(stage)) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'Reusable audit artifacts contain conflicting model-stage observations.',
      );
    }
    byIdentity.set(identity, stage);
  }
  return [...byIdentity.values()];
}

function readVectorCheckpoint(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditVectorCheckpointSchema);
}

function readCandidateGroundingDraft(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditCandidateGroundingDraftSchema);
}

function readCandidateAwareCheckpoint(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditCandidateAwareCheckpointSchema);
}

function readEvidenceMapDraft(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditEvidenceMapDraftSchema);
}

function readSourcePostureDraft(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditSourcePostureDraftSchema);
}

function readContextOverflowLedger(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditContextOverflowLedgerSchema);
}

function readEvidenceMapRecoveryLeaf(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditEvidenceMapRecoveryLeafSchema);
}

function readSourcePostureRecoveryLeaf(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(outputRoot, artifactPath, AuditSourcePostureRecoveryLeafSchema);
}

function readCandidateGroundingRecoveryLeaf(outputRoot: string, artifactPath: string) {
  return readOptionalJsonArtifact(
    outputRoot,
    artifactPath,
    AuditCandidateGroundingRecoveryLeafSchema,
  );
}
