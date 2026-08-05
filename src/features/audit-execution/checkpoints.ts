import { canonicalJson } from '../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../shared/errors/audit-runtime-error.js';
import type { AttackPlan } from '../attack-planning/index.js';
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
  type AuditCheckpointExecution,
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
  modelObservationForAuditCheckpointExecution,
} from './audit.schema.js';
import { candidateAwareFingerprint } from './candidate-aware-identity.js';
import { groundedHypotheses } from './candidate-grounding/identity.js';
import { evidenceMapFingerprint } from './evidence-map/repair.js';
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

/** Already-loaded, validated artifacts from one immutable audit resume boundary. */
export type AuditResumeArtifacts = Readonly<{
  vectorResults?: readonly AuditVectorResult[];
  candidateGroundingDrafts?: readonly AuditCandidateGroundingDraft[];
  candidateAwareCheckpoints?: readonly AuditCandidateAwareCheckpoint[];
  evidenceMapDrafts?: readonly AuditEvidenceMapDraft[];
  sourcePostureDrafts?: readonly AuditSourcePostureDraft[];
  contextOverflowLedgers?: readonly AuditContextOverflowLedger[];
  evidenceMapRecoveryLeaves?: readonly AuditEvidenceMapRecoveryLeaf[];
  sourcePostureRecoveryLeaves?: readonly AuditSourcePostureRecoveryLeaf[];
  candidateGroundingRecoveryLeaves?: readonly AuditCandidateGroundingRecoveryLeaf[];
}>;

/**
 * The only resume input accepted by the audit core. It centralizes duplicate
 * rejection and exact artifact selection after the external loader has
 * validated every persisted schema and binding.
 */
export class AuditResumeState {
  readonly #vectorResults: ReadonlyMap<string, AuditVectorResult>;
  readonly #candidateGroundingDrafts: ReadonlyMap<string, AuditCandidateGroundingDraft>;
  readonly #candidateAwareCheckpoints: ReadonlyMap<string, AuditCandidateAwareCheckpoint>;
  readonly #evidenceMapDrafts: ReadonlyMap<string, AuditEvidenceMapDraft>;
  readonly #sourcePostureDrafts: ReadonlyMap<string, AuditSourcePostureDraft>;
  readonly #contextOverflowLedgers: ReadonlyMap<string, AuditContextOverflowLedger>;
  readonly #evidenceMapRecoveryLeaves: ReadonlyMap<string, readonly AuditEvidenceMapRecoveryLeaf[]>;
  readonly #sourcePostureRecoveryLeaves: ReadonlyMap<
    string,
    readonly AuditSourcePostureRecoveryLeaf[]
  >;
  readonly #candidateGroundingRecoveryLeaves: ReadonlyMap<
    string,
    readonly AuditCandidateGroundingRecoveryLeaf[]
  >;

  public constructor(input: AuditResumeArtifacts = {}) {
    this.#vectorResults = uniqueIndex(
      input.vectorResults ?? [],
      (result) => result.coverage.vectorId,
    );
    this.#candidateGroundingDrafts = uniqueIndex(
      input.candidateGroundingDrafts ?? [],
      (draft) => draft.vectorId,
    );
    this.#candidateAwareCheckpoints = uniqueIndex(
      input.candidateAwareCheckpoints ?? [],
      (checkpoint) =>
        `${checkpoint.vectorId}\0${checkpoint.phase}\0${checkpoint.candidateOrdinal}\0${checkpoint.candidateFingerprint}\0${checkpoint.evidenceMapFingerprint}\0${checkpoint.sourcePostureFingerprint}`,
    );
    this.#evidenceMapDrafts = uniqueIndex(input.evidenceMapDrafts ?? [], (draft) => draft.vectorId);
    this.#sourcePostureDrafts = uniqueIndex(
      input.sourcePostureDrafts ?? [],
      (draft) => draft.vectorId,
    );
    this.#contextOverflowLedgers = uniqueIndex(
      input.contextOverflowLedgers ?? [],
      (ledger) => `${ledger.vectorId}\0${ledger.phase}`,
    );
    this.#evidenceMapRecoveryLeaves = groupedUniqueIndex(
      input.evidenceMapRecoveryLeaves ?? [],
      (leaf) => `${leaf.vectorId}\0${leaf.phase}`,
      (leaf) => leaf.scopeFingerprint,
    );
    this.#sourcePostureRecoveryLeaves = groupedUniqueIndex(
      input.sourcePostureRecoveryLeaves ?? [],
      (leaf) => leaf.vectorId,
      (leaf) => leaf.scopeFingerprint,
    );
    this.#candidateGroundingRecoveryLeaves = groupedUniqueIndex(
      input.candidateGroundingRecoveryLeaves ?? [],
      (leaf) => leaf.vectorId,
      (leaf) => leaf.scopeFingerprint,
    );
  }

  public vectorResult(vectorId: string): AuditVectorResult | undefined {
    return this.#vectorResults.get(vectorId);
  }

  public evidenceMapDraft(vectorId: string): AuditEvidenceMapDraft | undefined {
    return this.#evidenceMapDrafts.get(vectorId);
  }

  public sourcePostureDraft(vectorId: string): AuditSourcePostureDraft | undefined {
    return this.#sourcePostureDrafts.get(vectorId);
  }

  public candidateGroundingDraft(vectorId: string): AuditCandidateGroundingDraft | undefined {
    return this.#candidateGroundingDrafts.get(vectorId);
  }

  public candidateAwareCheckpoint(input: {
    vectorId: string;
    phase: AuditCandidateAwareCheckpoint['phase'];
    candidateOrdinal: number;
    candidate: VerifiableHypothesis;
    evidenceMapFingerprint: string;
    sourcePostureFingerprint: string;
  }): AuditCandidateAwareCheckpoint | undefined {
    return this.#candidateAwareCheckpoints.get(
      `${input.vectorId}\0${input.phase}\0${input.candidateOrdinal}\0${candidateAwareFingerprint(input.candidate)}\0${input.evidenceMapFingerprint}\0${input.sourcePostureFingerprint}`,
    );
  }

  public scopedArtifacts(input: {
    vectorId: string;
    phase: AuditContextOverflowLedger['phase'];
  }): Readonly<{
    contextOverflowLedger?: AuditContextOverflowLedger;
    evidenceMapRecoveryLeaves?: readonly AuditEvidenceMapRecoveryLeaf[];
    sourcePostureRecoveryLeaves?: readonly AuditSourcePostureRecoveryLeaf[];
    candidateGroundingRecoveryLeaves?: readonly AuditCandidateGroundingRecoveryLeaf[];
  }> {
    const contextOverflowLedger = this.#contextOverflowLedgers.get(
      `${input.vectorId}\0${input.phase}`,
    );
    const evidenceMapRecoveryLeaves =
      input.phase === 'evidence-mapping' || input.phase === 'evidence-map-repair'
        ? this.#evidenceMapRecoveryLeaves.get(`${input.vectorId}\0${input.phase}`)
        : undefined;
    const sourcePostureRecoveryLeaves =
      input.phase === 'source-posture'
        ? this.#sourcePostureRecoveryLeaves.get(input.vectorId)
        : undefined;
    const candidateGroundingRecoveryLeaves =
      input.phase === 'candidate-grounding'
        ? this.#candidateGroundingRecoveryLeaves.get(input.vectorId)
        : undefined;
    return {
      ...(contextOverflowLedger === undefined ? {} : { contextOverflowLedger }),
      ...(evidenceMapRecoveryLeaves === undefined ? {} : { evidenceMapRecoveryLeaves }),
      ...(sourcePostureRecoveryLeaves === undefined ? {} : { sourcePostureRecoveryLeaves }),
      ...(candidateGroundingRecoveryLeaves === undefined
        ? {}
        : { candidateGroundingRecoveryLeaves }),
    };
  }
}

/** Builds one opaque resume state after external artifact reads and validation. */
export function createAuditResumeState(input: AuditResumeArtifacts = {}): AuditResumeState {
  return new AuditResumeState(input);
}

function uniqueIndex<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
): ReadonlyMap<string, Value> {
  const indexed = new Map<string, Value>();
  for (const value of values) {
    const identity = key(value);
    if (indexed.has(identity)) throw incompatibleCheckpoint();
    indexed.set(identity, value);
  }
  return indexed;
}

function groupedUniqueIndex<Value>(
  values: readonly Value[],
  group: (value: Value) => string,
  identity: (value: Value) => string,
): ReadonlyMap<string, readonly Value[]> {
  const indexed = new Map<string, Value[]>();
  for (const value of values) {
    const groupKey = group(value);
    const existing = indexed.get(groupKey) ?? [];
    if (existing.some((candidate) => identity(candidate) === identity(value))) {
      throw incompatibleCheckpoint();
    }
    indexed.set(groupKey, [...existing, value]);
  }
  return indexed;
}

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
  phase: Extract<AuditEvidenceMapRecoveryLeaf['phase'], 'evidence-mapping' | 'evidence-map-repair'>;
  phaseInputFingerprint: string;
  scopeFingerprint: string;
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.evidence-map-recovery.${input.phase}.${input.phaseInputFingerprint}.${input.scopeFingerprint}.json`;
}

export function auditSourcePostureRecoveryLeafPath(input: {
  runId: string;
  vectorId: string;
  phaseInputFingerprint: string;
  scopeFingerprint: string;
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.source-posture-recovery.${input.phaseInputFingerprint}.${input.scopeFingerprint}.json`;
}

export function auditCandidateGroundingRecoveryLeafPath(input: {
  runId: string;
  vectorId: string;
  phaseInputFingerprint: string;
  scopeFingerprint: string;
}): string {
  return `checkpoints/${input.runId}/${input.vectorId}.candidate-grounding-recovery.${input.phaseInputFingerprint}.${input.scopeFingerprint}.json`;
}

/** Creates an exact-bound source-free recovery topology ledger. */
export function createAuditContextOverflowLedger(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  phase: AuditContextOverflowLedger['phase'];
  parentStageId: AuditContextOverflowLedger['parentStageId'];
  phaseInputFingerprint: AuditContextOverflowLedger['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditContextOverflowLedger['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditContextOverflowLedger['rootScopeFingerprint'];
  events: AuditContextOverflowLedger['events'];
}): AuditContextOverflowLedger {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditContextOverflowLedgerSchema.parse({
    schemaVersion: 3,
    ...binding,
    phase: input.phase,
    parentStageId: input.parentStageId,
    phaseInputFingerprint: input.phaseInputFingerprint,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    events: input.events,
  });
}

/** Creates one exact-bound, validated evidence-map recovery leaf. */
export function createAuditEvidenceMapRecoveryLeaf(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  phase: AuditEvidenceMapRecoveryLeaf['phase'];
  parentStageId: AuditEvidenceMapRecoveryLeaf['parentStageId'];
  phaseInputFingerprint: AuditEvidenceMapRecoveryLeaf['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditEvidenceMapRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditEvidenceMapRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditEvidenceMapRecoveryLeaf['childKey'];
  scopeFingerprint: AuditEvidenceMapRecoveryLeaf['scopeFingerprint'];
  execution: AuditEvidenceMapRecoveryLeaf['execution'];
  evidenceMap: AuditEvidenceMapRecoveryLeaf['evidenceMap'];
  savedAt: string;
}): AuditEvidenceMapRecoveryLeaf {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditEvidenceMapRecoveryLeafSchema.parse({
    schemaVersion: 4,
    phase: input.phase,
    ...binding,
    parentStageId: input.parentStageId,
    phaseInputFingerprint: input.phaseInputFingerprint,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    childKey: input.childKey,
    scopeFingerprint: input.scopeFingerprint,
    recoveryState: 'partial',
    execution: input.execution,
    evidenceMap: input.evidenceMap,
    savedAt: input.savedAt,
  });
}

/** Creates one exact-bound, validated candidate-blind posture recovery leaf. */
export function createAuditSourcePostureRecoveryLeaf(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  parentStageId: AuditSourcePostureRecoveryLeaf['parentStageId'];
  phaseInputFingerprint: AuditSourcePostureRecoveryLeaf['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditSourcePostureRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditSourcePostureRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditSourcePostureRecoveryLeaf['childKey'];
  scopeFingerprint: AuditSourcePostureRecoveryLeaf['scopeFingerprint'];
  execution: AuditSourcePostureRecoveryLeaf['execution'];
  sourcePosture: AuditSourcePostureRecoveryLeaf['sourcePosture'];
  savedAt: string;
}): AuditSourcePostureRecoveryLeaf {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditSourcePostureRecoveryLeafSchema.parse({
    schemaVersion: 4,
    phase: 'source-posture',
    ...binding,
    parentStageId: input.parentStageId,
    phaseInputFingerprint: input.phaseInputFingerprint,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    childKey: input.childKey,
    scopeFingerprint: input.scopeFingerprint,
    recoveryState: 'partial',
    execution: input.execution,
    sourcePosture: input.sourcePosture,
    savedAt: input.savedAt,
  });
}

/** Creates one exact-bound canonical candidate-grounding recovery leaf. */
export function createAuditCandidateGroundingRecoveryLeaf(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  parentStageId: AuditCandidateGroundingRecoveryLeaf['parentStageId'];
  phaseInputFingerprint: AuditCandidateGroundingRecoveryLeaf['phaseInputFingerprint'];
  recoveryProtocolFingerprint: AuditCandidateGroundingRecoveryLeaf['recoveryProtocolFingerprint'];
  rootScopeFingerprint: AuditCandidateGroundingRecoveryLeaf['rootScopeFingerprint'];
  childKey: AuditCandidateGroundingRecoveryLeaf['childKey'];
  scopeFingerprint: AuditCandidateGroundingRecoveryLeaf['scopeFingerprint'];
  execution: AuditCandidateGroundingRecoveryLeaf['execution'];
  groundings: AuditCandidateGroundingRecoveryLeaf['groundings'];
  savedAt: string;
}): AuditCandidateGroundingRecoveryLeaf {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditCandidateGroundingRecoveryLeafSchema.parse({
    schemaVersion: 3,
    phase: 'candidate-grounding',
    ...binding,
    parentStageId: input.parentStageId,
    phaseInputFingerprint: input.phaseInputFingerprint,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    childKey: input.childKey,
    scopeFingerprint: input.scopeFingerprint,
    recoveryState: 'partial',
    execution: input.execution,
    groundings: input.groundings,
    savedAt: input.savedAt,
  });
}

export function createAuditEvidenceMapDraft(input: {
  binding: AuditCheckpointBinding;
  plan: AttackPlan;
  evidenceMap: AuditEvidenceMapDraft['evidenceMap'];
  repairAttempts: AuditEvidenceMapDraft['repairAttempts'];
  execution: AuditCheckpointExecution;
  savedAt: string;
}): AuditEvidenceMapDraft {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditEvidenceMapDraftSchema.parse({
    schemaVersion: 5,
    phase: 'evidence-mapping',
    ...binding,
    savedAt: input.savedAt,
    evidenceMap: input.evidenceMap,
    evidenceMapFingerprint: evidenceMapFingerprint(input.evidenceMap),
    repairAttempts: input.repairAttempts,
    execution: input.execution,
  });
}

export function createAuditCandidateGroundingDraft(input: {
  binding: AuditCheckpointBinding;
  candidateGroundingProtocolFingerprint: string;
  plan: AttackPlan;
  evidenceMapFingerprint: AuditCandidateGroundingDraft['evidenceMapFingerprint'];
  sourcePostureFingerprint: AuditCandidateGroundingDraft['sourcePostureFingerprint'];
  groundings: AuditCandidateGroundingDraft['groundings'];
  closures: AuditCandidateGroundingDraft['closures'];
  hypothesisGroundingFunnel: AuditCandidateGroundingDraft['hypothesisGroundingFunnel'];
  candidateIntegrityRejections: AuditCandidateGroundingDraft['candidateIntegrityRejections'];
  discoveryObservation: AuditCandidateGroundingDraft['discoveryObservation'];
  modelObservation: AuditCandidateGroundingDraft['modelObservation'];
  savedAt: string;
}): AuditCandidateGroundingDraft {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditCandidateGroundingDraftSchema.parse({
    schemaVersion: 10,
    phase: 'candidate-grounding',
    candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
    evidenceMapFingerprint: input.evidenceMapFingerprint,
    sourcePostureFingerprint: input.sourcePostureFingerprint,
    ...binding,
    savedAt: input.savedAt,
    groundings: input.groundings,
    closures: input.closures,
    hypothesisGroundingFunnel: input.hypothesisGroundingFunnel,
    candidateIntegrityRejections: input.candidateIntegrityRejections,
    discoveryObservation: input.discoveryObservation,
    modelObservation: input.modelObservation,
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
  evidenceMapFingerprint: string;
  sourcePostureFingerprint: string;
  state: AuditCandidateAwareCheckpoint['state'];
  result?: AuditCandidateAwareCheckpoint['result'];
  contextOverflowTopology?: CandidateAwareContextOverflowTopology;
  savedAt: string;
}): AuditCandidateAwareCheckpoint {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  if (input.candidate.vectorId !== binding.vectorId) throw incompatibleCheckpoint();
  return AuditCandidateAwareCheckpointSchema.parse({
    schemaVersion: 5,
    phase: input.phase,
    candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
    ...binding,
    candidateOrdinal: input.candidateOrdinal,
    candidateFingerprint: candidateAwareFingerprint(input.candidate),
    evidenceMapFingerprint: input.evidenceMapFingerprint,
    sourcePostureFingerprint: input.sourcePostureFingerprint,
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
  evidenceMapFingerprint: AuditSourcePostureDraft['evidenceMapFingerprint'];
  sourcePosture: AuditSourcePostureDraft['sourcePosture'];
  execution: AuditCheckpointExecution;
  savedAt: string;
}): AuditSourcePostureDraft {
  const binding = AuditCheckpointBindingSchema.parse(input.binding);
  assertBindingMatchesPlan(binding, input.plan);
  return AuditSourcePostureDraftSchema.parse({
    schemaVersion: 4,
    phase: 'source-posture',
    evidenceMapFingerprint: input.evidenceMapFingerprint,
    ...binding,
    savedAt: input.savedAt,
    sourcePosture: input.sourcePosture,
    execution: input.execution,
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
    schemaVersion: 17,
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
 * Loads every exact candidate-aware checkpoint. The audit core owns the only
 * decision whether a terminal result is reusable or must be retried; retaining
 * pending, running, and incomplete records lets it resume directly from a
 * completed grounding draft without repeating discovery or grounding.
 */
export async function loadReusableAuditCandidateAwareCheckpoints(input: {
  binding: AuditCheckpointBaseBinding;
  candidateGroundingProtocolFingerprint: string;
  plan: AttackPlan;
  drafts: readonly AuditCandidateGroundingDraft[];
  reader: AuditCheckpointReader;
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
    for (const [index, candidate] of groundedHypotheses(draft.groundings).entries()) {
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
          parsed.candidateOrdinal !== index + 1 ||
          parsed.evidenceMapFingerprint !== draft.evidenceMapFingerprint ||
          parsed.sourcePostureFingerprint !== draft.sourcePostureFingerprint
        ) {
          throw incompatibleCheckpoint();
        }
        if (parsed.candidateFingerprint !== candidateAwareFingerprint(candidate)) {
          throw incompatibleCheckpoint();
        }
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
      'evidence-map-repair',
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
  for (const ledger of input.ledgers.filter(isEvidenceMapRecoveryLedger)) {
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
          phase: ledger.phase,
          phaseInputFingerprint: ledger.phaseInputFingerprint,
          scopeFingerprint: event.scopeFingerprint,
        }),
      );
      if (checkpoint === undefined) continue;
      const parsed = AuditEvidenceMapRecoveryLeafSchema.parse(checkpoint);
      assertCompatibleCheckpointBinding(parsed, binding, input.plan);
      if (
        parsed.phase !== ledger.phase ||
        parsed.parentStageId !== ledger.parentStageId ||
        parsed.phaseInputFingerprint !== ledger.phaseInputFingerprint ||
        parsed.recoveryProtocolFingerprint !== ledger.recoveryProtocolFingerprint ||
        parsed.rootScopeFingerprint !== ledger.rootScopeFingerprint ||
        parsed.childKey !== event.childKey ||
        parsed.scopeFingerprint !== event.scopeFingerprint ||
        parsed.recoveryState !== 'partial' ||
        !sameRecoveredChildExecution(parsed.execution, event.execution)
      ) {
        throw incompatibleCheckpoint();
      }
      reusable.push(parsed);
    }
  }
  return reusable;
}

function isEvidenceMapRecoveryLedger(
  ledger: AuditContextOverflowLedger,
): ledger is AuditContextOverflowLedger & { phase: AuditEvidenceMapRecoveryLeaf['phase'] } {
  return ledger.phase === 'evidence-mapping' || ledger.phase === 'evidence-map-repair';
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
          phaseInputFingerprint: ledger.phaseInputFingerprint,
          scopeFingerprint: event.scopeFingerprint,
        }),
      );
      if (checkpoint === undefined) continue;
      const parsed = AuditSourcePostureRecoveryLeafSchema.parse(checkpoint);
      assertCompatibleCheckpointBinding(parsed, binding, input.plan);
      if (
        parsed.parentStageId !== ledger.parentStageId ||
        parsed.phaseInputFingerprint !== ledger.phaseInputFingerprint ||
        parsed.recoveryProtocolFingerprint !== ledger.recoveryProtocolFingerprint ||
        parsed.rootScopeFingerprint !== ledger.rootScopeFingerprint ||
        parsed.childKey !== event.childKey ||
        parsed.scopeFingerprint !== event.scopeFingerprint ||
        parsed.recoveryState !== 'partial' ||
        !sameRecoveredChildExecution(parsed.execution, event.execution)
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
          phaseInputFingerprint: ledger.phaseInputFingerprint,
          scopeFingerprint: event.scopeFingerprint,
        }),
      );
      if (checkpoint === undefined) continue;
      const parsed = AuditCandidateGroundingRecoveryLeafSchema.parse(checkpoint);
      assertCompatibleCheckpointBinding(parsed, binding, input.plan);
      if (
        parsed.parentStageId !== ledger.parentStageId ||
        parsed.phaseInputFingerprint !== ledger.phaseInputFingerprint ||
        parsed.recoveryProtocolFingerprint !== ledger.recoveryProtocolFingerprint ||
        parsed.rootScopeFingerprint !== ledger.rootScopeFingerprint ||
        parsed.childKey !== event.childKey ||
        parsed.scopeFingerprint !== event.scopeFingerprint ||
        parsed.recoveryState !== 'partial' ||
        !sameRecoveredChildExecution(parsed.execution, event.execution)
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
      event.execution === undefined
        ? []
        : (modelObservationForAuditCheckpointExecution(event.execution) ?? []),
    );
  });
}

/** Reuse requires the leaf and its completed topology transition to retain identical telemetry. */
function sameRecoveredChildExecution(
  leafExecution: AuditEvidenceMapRecoveryLeaf['execution'],
  eventExecution: AuditContextOverflowLedger['events'][number]['execution'],
): boolean {
  return (
    eventExecution !== undefined && canonicalJson(leafExecution) === canonicalJson(eventExecution)
  );
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
    phase === 'evidence-map-repair' &&
    input.evidenceMapDrafts.some(
      (draft) =>
        draft.vectorId === vectorId &&
        draft.repairAttempts.some(
          (attempt) => modelObservationForAuditCheckpointExecution(attempt.execution) !== undefined,
        ),
    )
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

function incompatibleCheckpoint(): AuditRuntimeError {
  return new AuditRuntimeError(
    'artifact-invalid',
    'The audit checkpoint does not match the executable plan or provider configuration.',
  );
}
