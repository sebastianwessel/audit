import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import type { AttackPlan } from '../attack-planning/plan.schema.js';
import type { ModelStageObservation } from '../model-operations/model-operations.schema.js';
import {
  type AuditCandidateAwareCheckpoint,
  AuditCandidateAwareCheckpointSchema,
  type AuditCandidateGroundingDraft,
  AuditCandidateGroundingDraftSchema,
  type AuditCandidateGroundingRecoveryLeaf,
  AuditCandidateGroundingRecoveryLeafSchema,
  type AuditCheckpointBinding,
  AuditCheckpointBindingSchema,
  type AuditContextOverflowLedger,
  AuditContextOverflowLedgerSchema,
  type AuditEvidenceMapDraft,
  AuditEvidenceMapDraftSchema,
  type AuditEvidenceMapRecoveryLeaf,
  AuditEvidenceMapRecoveryLeafSchema,
  type AuditSourcePostureDraft,
  AuditSourcePostureDraftSchema,
  type AuditSourcePostureRecoveryLeaf,
  AuditSourcePostureRecoveryLeafSchema,
  type AuditVectorCheckpoint,
  AuditVectorCheckpointSchema,
  type AuditVectorResult,
  type CandidateAwareContextOverflowTopology,
} from './audit.schema.js';
import { candidateAwareFingerprint } from './candidate-aware-identity.js';
import type { VerifiableHypothesis } from './verification/contract.js';

/** The platform adapter returns undefined only when a checkpoint does not exist. */
export type AuditCheckpointReader = (
  artifactPath: string,
) => Promise<
  | AuditVectorCheckpoint
  | AuditCandidateAwareCheckpoint
  | AuditCandidateGroundingDraft
  | AuditCandidateGroundingRecoveryLeaf
  | AuditEvidenceMapDraft
  | AuditEvidenceMapRecoveryLeaf
  | AuditSourcePostureDraft
  | AuditSourcePostureRecoveryLeaf
  | AuditContextOverflowLedger
  | undefined
>;

export type AuditCheckpointBaseBinding = Omit<
  AuditCheckpointBinding,
  'planDigest' | 'vectorId' | 'vectorDigest'
>;

/** Derives every sealed identity from the one supplied executable plan. */
export function createAuditCheckpointBinding(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  vectorId: string;
}): AuditCheckpointBinding {
  const vector = planVector(input.plan, input.vectorId);
  if (input.binding.planId !== input.plan.planId) throw incompatibleCheckpoint();
  return AuditCheckpointBindingSchema.parse({
    ...input.binding,
    planDigest: input.plan.planDigest,
    vectorId: vector.vectorId,
    vectorDigest: vector.vectorDigest,
  });
}

export function auditCheckpointPath(runId: string, vectorId: string): string {
  return `checkpoints/${runId}/${vectorId}.json`;
}

export function auditCandidateGroundingDraftPath(runId: string, vectorId: string): string {
  return `checkpoints/${runId}/${vectorId}.candidate-grounding.json`;
}

export function auditCandidateAwareCheckpointPath(input: {
  runId: string;
  vectorId: string;
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.candidate-${input.candidateOrdinal}.${input.phase}.json`;
}

export function auditEvidenceMapDraftPath(runId: string, vectorId: string): string {
  return `checkpoints/${runId}/${vectorId}.evidence-map.json`;
}

export function auditSourcePostureDraftPath(runId: string, vectorId: string): string {
  return `checkpoints/${runId}/${vectorId}.source-posture.json`;
}

export function auditContextOverflowLedgerPath(input: {
  runId: string;
  vectorId: string;
  phase: AuditContextOverflowLedger['phase'];
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.context-overflow.${input.phase}.json`;
}

export function auditEvidenceMapRecoveryLeafPath(input: {
  runId: string;
  vectorId: string;
  scopeFingerprint: string;
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.evidence-map-recovery.${input.scopeFingerprint}.json`;
}

export function auditSourcePostureRecoveryLeafPath(input: {
  runId: string;
  vectorId: string;
  scopeFingerprint: string;
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.source-posture-recovery.${input.scopeFingerprint}.json`;
}

export function auditCandidateGroundingRecoveryLeafPath(input: {
  runId: string;
  vectorId: string;
  scopeFingerprint: string;
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.candidate-grounding-recovery.${input.scopeFingerprint}.json`;
}

/** Creates an exact-bound source-free recovery topology ledger. */
export function createAuditContextOverflowLedger(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  phase: AuditContextOverflowLedger['phase'];
  parentStageId: AuditContextOverflowLedger['parentStageId'];
  recoveryProtocolFingerprint: AuditContextOverflowLedger['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditContextOverflowLedger['rootScopeFingerprint'];
  events: AuditContextOverflowLedger['events'];
}): AuditContextOverflowLedger {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditContextOverflowLedgerSchema.parse({
    schemaVersion: 1,
    ...binding,
    phase: input.phase,
    parentStageId: input.parentStageId,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    events: input.events,
  });
}

/** Creates one exact-bound, validated evidence-map recovery leaf. */
export function createAuditEvidenceMapRecoveryLeaf(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  parentStageId: AuditEvidenceMapRecoveryLeaf['parentStageId'];
  recoveryProtocolFingerprint: AuditEvidenceMapRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditEvidenceMapRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditEvidenceMapRecoveryLeaf['childKey'];
  scopeFingerprint: AuditEvidenceMapRecoveryLeaf['scopeFingerprint'];
  evidenceMap: AuditEvidenceMapRecoveryLeaf['evidenceMap'];
  savedAt: string;
}): AuditEvidenceMapRecoveryLeaf {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditEvidenceMapRecoveryLeafSchema.parse({
    schemaVersion: 1,
    phase: 'evidence-mapping',
    ...binding,
    parentStageId: input.parentStageId,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    childKey: input.childKey,
    scopeFingerprint: input.scopeFingerprint,
    evidenceMap: input.evidenceMap,
    savedAt: input.savedAt,
  });
}

/** Creates one exact-bound, validated candidate-blind posture recovery leaf. */
export function createAuditSourcePostureRecoveryLeaf(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  parentStageId: AuditSourcePostureRecoveryLeaf['parentStageId'];
  recoveryProtocolFingerprint: AuditSourcePostureRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditSourcePostureRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditSourcePostureRecoveryLeaf['childKey'];
  scopeFingerprint: AuditSourcePostureRecoveryLeaf['scopeFingerprint'];
  sourcePosture: AuditSourcePostureRecoveryLeaf['sourcePosture'];
  savedAt: string;
}): AuditSourcePostureRecoveryLeaf {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditSourcePostureRecoveryLeafSchema.parse({
    schemaVersion: 1,
    phase: 'source-posture',
    ...binding,
    parentStageId: input.parentStageId,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    childKey: input.childKey,
    scopeFingerprint: input.scopeFingerprint,
    sourcePosture: input.sourcePosture,
    savedAt: input.savedAt,
  });
}

/** Creates one exact-bound canonical candidate-grounding recovery leaf. */
export function createAuditCandidateGroundingRecoveryLeaf(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  parentStageId: AuditCandidateGroundingRecoveryLeaf['parentStageId'];
  recoveryProtocolFingerprint: AuditCandidateGroundingRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditCandidateGroundingRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditCandidateGroundingRecoveryLeaf['childKey'];
  scopeFingerprint: AuditCandidateGroundingRecoveryLeaf['scopeFingerprint'];
  groundings: AuditCandidateGroundingRecoveryLeaf['groundings'];
  savedAt: string;
}): AuditCandidateGroundingRecoveryLeaf {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditCandidateGroundingRecoveryLeafSchema.parse({
    schemaVersion: 1,
    phase: 'candidate-grounding',
    ...binding,
    parentStageId: input.parentStageId,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    childKey: input.childKey,
    scopeFingerprint: input.scopeFingerprint,
    groundings: input.groundings,
    savedAt: input.savedAt,
  });
}

export function createAuditEvidenceMapDraft(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  evidenceMap: AuditEvidenceMapDraft['evidenceMap'];
  modelObservation?: AuditEvidenceMapDraft['modelObservation'];
  savedAt: string;
}): AuditEvidenceMapDraft {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditEvidenceMapDraftSchema.parse({
    schemaVersion: 1,
    phase: 'evidence-mapping',
    ...binding,
    savedAt: input.savedAt,
    evidenceMap: input.evidenceMap,
    ...(input.modelObservation === undefined ? {} : { modelObservation: input.modelObservation }),
  });
}

export function createAuditCandidateGroundingDraft(input: {
  binding: AuditCheckpointBinding;
  candidateGroundingProtocolFingerprint: string;
  plan: AttackPlan;
  findings: AuditCandidateGroundingDraft['findings'];
  closures: AuditCandidateGroundingDraft['closures'];
  hypothesisGroundingFunnel: AuditCandidateGroundingDraft['hypothesisGroundingFunnel'];
  candidateIntegrityRejections: AuditCandidateGroundingDraft['candidateIntegrityRejections'];
  discoveryObservation?: AuditCandidateGroundingDraft['discoveryObservation'];
  modelObservation?: AuditCandidateGroundingDraft['modelObservation'];
  savedAt: string;
}): AuditCandidateGroundingDraft {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditCandidateGroundingDraftSchema.parse({
    schemaVersion: 4,
    phase: 'candidate-grounding',
    candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
    ...binding,
    savedAt: input.savedAt,
    findings: input.findings,
    closures: input.closures,
    hypothesisGroundingFunnel: input.hypothesisGroundingFunnel,
    candidateIntegrityRejections: input.candidateIntegrityRejections,
    ...(input.discoveryObservation === undefined
      ? {}
      : { discoveryObservation: input.discoveryObservation }),
    ...(input.modelObservation === undefined ? {} : { modelObservation: input.modelObservation }),
  });
}

/** Persists one state transition for exact candidate-aware verifier work. */
export function createAuditCandidateAwareCheckpoint(input: {
  binding: AuditCheckpointBinding;
  candidateGroundingProtocolFingerprint: string;
  plan: AttackPlan;
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
  candidate: VerifiableHypothesis;
  state: AuditCandidateAwareCheckpoint['state'];
  result?: AuditCandidateAwareCheckpoint['result'];
  contextOverflowTopology?: CandidateAwareContextOverflowTopology;
  savedAt: string;
}): AuditCandidateAwareCheckpoint {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  if (input.candidate.vectorId !== binding.vectorId) throw incompatibleCheckpoint();
  return AuditCandidateAwareCheckpointSchema.parse({
    schemaVersion: 2,
    phase: input.phase,
    candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
    ...binding,
    candidateOrdinal: input.candidateOrdinal,
    candidateFingerprint: candidateAwareFingerprint(input.candidate),
    state: input.state,
    savedAt: input.savedAt,
    ...(input.result === undefined ? {} : { result: input.result }),
    ...(input.contextOverflowTopology === undefined
      ? {}
      : { contextOverflowTopology: input.contextOverflowTopology }),
  });
}

export function createAuditSourcePostureDraft(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  sourcePosture: AuditSourcePostureDraft['sourcePosture'];
  modelObservation?: AuditSourcePostureDraft['modelObservation'];
  savedAt: string;
}): AuditSourcePostureDraft {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditSourcePostureDraftSchema.parse({
    schemaVersion: 1,
    phase: 'source-posture',
    ...binding,
    savedAt: input.savedAt,
    sourcePosture: input.sourcePosture,
    ...(input.modelObservation === undefined ? {} : { modelObservation: input.modelObservation }),
  });
}

export function createAuditVectorCheckpoint(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  result: AuditVectorResult;
  savedAt: string;
}): AuditVectorCheckpoint {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  if (input.result.coverage.vectorId !== binding.vectorId) throw incompatibleCheckpoint();
  return AuditVectorCheckpointSchema.parse({
    schemaVersion: 13,
    ...binding,
    savedAt: input.savedAt,
    result: input.result,
  });
}

async function loadBoundAuditVectorResults(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  reader: AuditCheckpointReader;
  includeUnfinished: boolean;
}): Promise<AuditVectorResult[]> {
  const results: AuditVectorResult[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const vector of input.plan.vectors) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: vector.vectorId,
    });
    const checkpoint = await input.reader(auditCheckpointPath(binding.runId, binding.vectorId));
    if (checkpoint === undefined) continue;
    const parsed = AuditVectorCheckpointSchema.parse(checkpoint);
    assertCompatibleCheckpoint(parsed, binding, input.plan);
    if (!input.includeUnfinished && isUnfinishedVectorOutcome(parsed.result.coverage.outcome))
      continue;
    results.push(parsed.result);
  }
  return results;
}

/** Loads only checkpoints that are safe to reuse as execution state. */
export async function loadReusableAuditVectorResults(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  reader: AuditCheckpointReader;
  /** Explicit recovery opts into restarting every non-terminal vector from its safest predecessor. */
  retryUnfinished: boolean;
}): Promise<AuditVectorResult[]> {
  return loadBoundAuditVectorResults({
    ...input,
    includeUnfinished: !input.retryUnfinished,
  });
}

/**
 * Loads every compatible terminal result for source-free cost accounting.
 * Callers must not pass these results back to audit execution when retrying.
 */
export async function loadObservedAuditVectorResults(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  reader: AuditCheckpointReader;
}): Promise<AuditVectorResult[]> {
  return loadBoundAuditVectorResults({ ...input, includeUnfinished: true });
}

/** Loads canonical grounded candidates only when every immutable binding matches. */
export async function loadReusableAuditCandidateGroundingDrafts(input: {
  binding: AuditCheckpointBaseBinding;
  candidateGroundingProtocolFingerprint: string;
  plan: AttackPlan;
  reader: AuditCheckpointReader;
}): Promise<AuditCandidateGroundingDraft[]> {
  const reusable: AuditCandidateGroundingDraft[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const vector of input.plan.vectors) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: vector.vectorId,
    });
    const checkpoint = await input.reader(
      auditCandidateGroundingDraftPath(binding.runId, binding.vectorId),
    );
    if (checkpoint === undefined) continue;
    const parsed = AuditCandidateGroundingDraftSchema.parse(checkpoint);
    assertCompatibleCheckpointBinding(parsed, binding, input.plan);
    if (
      parsed.candidateGroundingProtocolFingerprint !== input.candidateGroundingProtocolFingerprint
    )
      throw incompatibleCheckpoint();
    reusable.push(parsed);
  }
  return reusable;
}

/**
 * Loads only completed, exact candidate-aware work. Pending and running records
 * prove an interrupted dispatch and are intentionally rescheduled.
 */
export async function loadReusableAuditCandidateAwareCheckpoints(input: {
  binding: AuditCheckpointBaseBinding;
  candidateGroundingProtocolFingerprint: string;
  plan: AttackPlan;
  drafts: readonly AuditCandidateGroundingDraft[];
  reader: AuditCheckpointReader;
  retryUnfinished: boolean;
}): Promise<AuditCandidateAwareCheckpoint[]> {
  const reusable: AuditCandidateAwareCheckpoint[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const draft of input.drafts) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: draft.vectorId,
    });
    for (const [index, candidate] of draft.findings.entries()) {
      for (const phase of ['verification', 'countercheck'] as const) {
        const checkpoint = await input.reader(
          auditCandidateAwareCheckpointPath({
            runId: binding.runId,
            vectorId: binding.vectorId,
            phase,
            candidateOrdinal: index + 1,
          }),
        );
        if (checkpoint === undefined) continue;
        const parsed = AuditCandidateAwareCheckpointSchema.parse(checkpoint);
        assertCompatibleCheckpointBinding(parsed, binding, input.plan);
        if (
          parsed.candidateGroundingProtocolFingerprint !==
            input.candidateGroundingProtocolFingerprint ||
          parsed.phase !== phase ||
          parsed.candidateOrdinal !== index + 1
        ) {
          throw incompatibleCheckpoint();
        }
        if (
          phase === 'verification' &&
          parsed.candidateFingerprint !== candidateAwareFingerprint(candidate)
        ) {
          throw incompatibleCheckpoint();
        }
        if (
          parsed.state !== 'completed' ||
          parsed.result === undefined ||
          (input.retryUnfinished && parsed.result.decision === 'incomplete')
        )
          continue;
        reusable.push(parsed);
      }
    }
  }
  return reusable;
}

/** Loads validated map drafts only when their source/model/protocol binding matches exactly. */
export async function loadReusableAuditEvidenceMapDrafts(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  reader: AuditCheckpointReader;
}): Promise<AuditEvidenceMapDraft[]> {
  const reusable: AuditEvidenceMapDraft[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const vector of input.plan.vectors) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: vector.vectorId,
    });
    const checkpoint = await input.reader(
      auditEvidenceMapDraftPath(binding.runId, binding.vectorId),
    );
    if (checkpoint === undefined) continue;
    const parsed = AuditEvidenceMapDraftSchema.parse(checkpoint);
    assertCompatibleCheckpointBinding(parsed, binding, input.plan);
    reusable.push(parsed);
  }
  return reusable;
}

/** Loads validated candidate-blind posture drafts only under their exact binding. */
export async function loadReusableAuditSourcePostureDrafts(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  reader: AuditCheckpointReader;
}): Promise<AuditSourcePostureDraft[]> {
  const reusable: AuditSourcePostureDraft[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const vector of input.plan.vectors) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: vector.vectorId,
    });
    const checkpoint = await input.reader(
      auditSourcePostureDraftPath(binding.runId, binding.vectorId),
    );
    if (checkpoint === undefined) continue;
    const parsed = AuditSourcePostureDraftSchema.parse(checkpoint);
    assertCompatibleCheckpointBinding(parsed, binding, input.plan);
    reusable.push(parsed);
  }
  return reusable;
}

/**
 * Loads only source-free recovery topology whose run/vector binding matches.
 * The stage additionally validates its root-scope and recovery-protocol hashes
 * immediately before it decides whether an already-overflowed parent is skipped.
 */
export async function loadReusableAuditContextOverflowLedgers(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  reader: AuditCheckpointReader;
}): Promise<AuditContextOverflowLedger[]> {
  const reusable: AuditContextOverflowLedger[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const vector of input.plan.vectors) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: vector.vectorId,
    });
    for (const phase of [
      'evidence-mapping',
      'source-posture',
      'investigation',
      'candidate-grounding',
    ] as const) {
      const checkpoint = await input.reader(
        auditContextOverflowLedgerPath({ runId: binding.runId, vectorId: binding.vectorId, phase }),
      );
      if (checkpoint === undefined) continue;
      const parsed = AuditContextOverflowLedgerSchema.parse(checkpoint);
      assertCompatibleCheckpointBinding(parsed, binding, input.plan);
      if (parsed.phase !== phase) throw incompatibleCheckpoint();
      reusable.push(parsed);
    }
  }
  return reusable;
}

/**
 * Loads only recovery leaves whose topology completed the same exact scope.
 * Leaves are phase-owned validated data; topology itself is deliberately
 * content-free and proves the durable handoff ordering.
 */
export async function loadReusableAuditEvidenceMapRecoveryLeaves(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  ledgers: readonly AuditContextOverflowLedger[];
  reader: AuditCheckpointReader;
}): Promise<AuditEvidenceMapRecoveryLeaf[]> {
  const reusable: AuditEvidenceMapRecoveryLeaf[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const ledger of input.ledgers.filter((entry) => entry.phase === 'evidence-mapping')) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: ledger.vectorId,
    });
    for (const event of ledger.events.filter((entry) => entry.state === 'completed')) {
      const checkpoint = await input.reader(
        auditEvidenceMapRecoveryLeafPath({
          runId: binding.runId,
          vectorId: binding.vectorId,
          scopeFingerprint: event.scopeFingerprint,
        }),
      );
      if (checkpoint === undefined) continue;
      const parsed = AuditEvidenceMapRecoveryLeafSchema.parse(checkpoint);
      assertCompatibleCheckpointBinding(parsed, binding, input.plan);
      if (
        parsed.parentStageId !== ledger.parentStageId ||
        parsed.recoveryProtocolFingerprint !== ledger.recoveryProtocolFingerprint ||
        parsed.rootScopeFingerprint !== ledger.rootScopeFingerprint ||
        parsed.childKey !== event.childKey ||
        parsed.scopeFingerprint !== event.scopeFingerprint
      ) {
        throw incompatibleCheckpoint();
      }
      reusable.push(parsed);
    }
  }
  return reusable;
}

/** Loads source-posture leaves only when their completed topology handoff matches exactly. */
export async function loadReusableAuditSourcePostureRecoveryLeaves(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  ledgers: readonly AuditContextOverflowLedger[];
  reader: AuditCheckpointReader;
}): Promise<AuditSourcePostureRecoveryLeaf[]> {
  const reusable: AuditSourcePostureRecoveryLeaf[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const ledger of input.ledgers.filter((entry) => entry.phase === 'source-posture')) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: ledger.vectorId,
    });
    for (const event of ledger.events.filter((entry) => entry.state === 'completed')) {
      const checkpoint = await input.reader(
        auditSourcePostureRecoveryLeafPath({
          runId: binding.runId,
          vectorId: binding.vectorId,
          scopeFingerprint: event.scopeFingerprint,
        }),
      );
      if (checkpoint === undefined) continue;
      const parsed = AuditSourcePostureRecoveryLeafSchema.parse(checkpoint);
      assertCompatibleCheckpointBinding(parsed, binding, input.plan);
      if (
        parsed.parentStageId !== ledger.parentStageId ||
        parsed.recoveryProtocolFingerprint !== ledger.recoveryProtocolFingerprint ||
        parsed.rootScopeFingerprint !== ledger.rootScopeFingerprint ||
        parsed.childKey !== event.childKey ||
        parsed.scopeFingerprint !== event.scopeFingerprint
      )
        throw incompatibleCheckpoint();
      reusable.push(parsed);
    }
  }
  return reusable;
}

/** Loads canonical grounding leaves only after the matching child is durably completed. */
export async function loadReusableAuditCandidateGroundingRecoveryLeaves(input: {
  binding: AuditCheckpointBaseBinding;
  plan: AttackPlan;
  ledgers: readonly AuditContextOverflowLedger[];
  reader: AuditCheckpointReader;
}): Promise<AuditCandidateGroundingRecoveryLeaf[]> {
  const reusable: AuditCandidateGroundingRecoveryLeaf[] = [];
  const baseBinding = AuditCheckpointBindingSchema.omit({
    planDigest: true,
    vectorId: true,
    vectorDigest: true,
  }).parse(input.binding);
  for (const ledger of input.ledgers.filter((entry) => entry.phase === 'candidate-grounding')) {
    const binding = createAuditCheckpointBinding({
      binding: baseBinding,
      plan: input.plan,
      vectorId: ledger.vectorId,
    });
    for (const event of ledger.events.filter((entry) => entry.state === 'completed')) {
      const checkpoint = await input.reader(
        auditCandidateGroundingRecoveryLeafPath({
          runId: binding.runId,
          vectorId: binding.vectorId,
          scopeFingerprint: event.scopeFingerprint,
        }),
      );
      if (checkpoint === undefined) continue;
      const parsed = AuditCandidateGroundingRecoveryLeafSchema.parse(checkpoint);
      assertCompatibleCheckpointBinding(parsed, binding, input.plan);
      if (
        parsed.parentStageId !== ledger.parentStageId ||
        parsed.recoveryProtocolFingerprint !== ledger.recoveryProtocolFingerprint ||
        parsed.rootScopeFingerprint !== ledger.rootScopeFingerprint ||
        parsed.childKey !== event.childKey ||
        parsed.scopeFingerprint !== event.scopeFingerprint
      ) {
        throw incompatibleCheckpoint();
      }
      reusable.push(parsed);
    }
  }
  return reusable;
}

/**
 * Retains observed child-call cost only while no validated phase successor has
 * already retained the same work. This is shared by product and evaluation
 * resume paths so their cost ceilings cannot drift.
 */
export function reusableContextOverflowModelStages(input: {
  ledgers: readonly AuditContextOverflowLedger[];
  terminalVectorResults: readonly AuditVectorResult[];
  evidenceMapDrafts: readonly AuditEvidenceMapDraft[];
  sourcePostureDrafts: readonly AuditSourcePostureDraft[];
  candidateGroundingDrafts: readonly AuditCandidateGroundingDraft[];
}): readonly ModelStageObservation[] {
  const terminalVectorIds = new Set(
    input.terminalVectorResults.map((result) => result.coverage.vectorId),
  );
  return input.ledgers.flatMap((ledger) => {
    if (
      terminalVectorIds.has(ledger.vectorId) ||
      hasReusablePhaseBoundary(input, ledger.vectorId, ledger.phase)
    )
      return [];
    return ledger.events.flatMap((event) =>
      event.modelObservation === undefined ? [] : [event.modelObservation],
    );
  });
}

function hasReusablePhaseBoundary(
  input: Pick<
    Parameters<typeof reusableContextOverflowModelStages>[0],
    'evidenceMapDrafts' | 'sourcePostureDrafts' | 'candidateGroundingDrafts'
  >,
  vectorId: string,
  phase: AuditContextOverflowLedger['phase'],
): boolean {
  if (
    phase === 'evidence-mapping' &&
    input.evidenceMapDrafts.some((draft) => draft.vectorId === vectorId)
  )
    return true;
  if (
    phase === 'source-posture' &&
    input.sourcePostureDrafts.some((draft) => draft.vectorId === vectorId)
  )
    return true;
  return (
    (phase === 'investigation' || phase === 'candidate-grounding') &&
    input.candidateGroundingDrafts.some((draft) => draft.vectorId === vectorId)
  );
}

function assertCompatibleCheckpoint(
  checkpoint: AuditVectorCheckpoint,
  binding: AuditCheckpointBinding,
  plan: AttackPlan,
): void {
  const parsed = AuditVectorCheckpointSchema.parse(checkpoint);
  assertCompatibleCheckpointBinding(parsed, binding, plan);
}

function assertCompatibleCheckpointBinding(
  checkpoint: AuditCheckpointBinding,
  binding: AuditCheckpointBinding,
  plan: AttackPlan,
): void {
  const vector = assertBindingMatchesPlan(binding, plan);
  if (
    checkpoint.runId !== binding.runId ||
    checkpoint.planId !== binding.planId ||
    checkpoint.planDigest !== binding.planDigest ||
    checkpoint.targetFingerprint !== binding.targetFingerprint ||
    checkpoint.provider !== binding.provider ||
    checkpoint.model !== binding.model ||
    checkpoint.verificationRouteFingerprint !== binding.verificationRouteFingerprint ||
    checkpoint.evidenceMapProtocolFingerprint !== binding.evidenceMapProtocolFingerprint ||
    checkpoint.reviewWorkflowProtocolFingerprint !== binding.reviewWorkflowProtocolFingerprint ||
    checkpoint.vectorId !== binding.vectorId ||
    checkpoint.vectorDigest !== binding.vectorDigest ||
    binding.planId !== plan.planId ||
    binding.planDigest !== plan.planDigest ||
    binding.vectorDigest !== vector.vectorDigest
  ) {
    throw incompatibleCheckpoint();
  }
}

function assertBindingMatchesPlan(
  binding: AuditCheckpointBinding,
  plan: AttackPlan,
): AttackPlan['vectors'][number] {
  const vector = planVector(plan, binding.vectorId);
  if (
    binding.planId !== plan.planId ||
    binding.planDigest !== plan.planDigest ||
    binding.vectorDigest !== vector.vectorDigest
  ) {
    throw incompatibleCheckpoint();
  }
  return vector;
}

function planVector(plan: AttackPlan, vectorId: string): AttackPlan['vectors'][number] {
  const vector = plan.vectors.find((candidate) => candidate.vectorId === vectorId);
  if (vector === undefined) throw incompatibleCheckpoint();
  return vector;
}

function isUnfinishedVectorOutcome(
  outcome: AuditVectorResult['coverage']['outcome'],
): outcome is 'incomplete' | 'failed' | 'cancelled' {
  return outcome === 'incomplete' || outcome === 'failed' || outcome === 'cancelled';
}

function incompatibleCheckpoint(): SecurityReviewerError {
  return new SecurityReviewerError(
    'artifact-invalid',
    'The audit checkpoint does not match the executable plan or provider configuration.',
  );
}
