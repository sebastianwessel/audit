import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import type { AttackPlan } from '../../attack-planning/index.js';
import type { ModelStageObservation } from '../../model-operations/model-operations.schema.js';
import type {
  ContextOverflowTopology,
  ContextOverflowTopologyEvent,
} from '../../review-workflow/runtime/context-overflow.js';
import {
  type AuditCandidateAwareCheckpoint,
  type AuditError,
  type CandidateAwareContextOverflowTopology,
  isRetryableAuditErrorCode,
  materializeAuditErrorCode,
  modelObservationForAuditCheckpointExecution,
  type PersistedCandidateAwareResult,
} from '../audit.schema.js';
import type { CandidateAwareDispatchPool } from '../candidate-aware-dispatch.js';
import { candidateAwareFingerprint } from '../candidate-aware-identity.js';
import {
  auditCheckpointExecutionForModelObservation,
  isCheckpointPersistenceError,
  persistAuditCheckpoint,
} from '../checkpoint-persistence.js';
import type { AuditResumeState } from '../checkpoints.js';
import { recoveryPhaseInputFingerprint } from '../recovery-phase-input.js';
import {
  type AuditVerificationResult,
  AuditVerificationResultSchema,
  terminalLaneForVerificationDecision,
  type VerifiableHypothesis,
  type VerificationTerminalLane,
  VerificationTerminalLaneSchema,
} from '../verification/contract.js';

/** Exact candidate-bound recovery state for one verifier or countercheck dispatch. */
export type CandidateAwareModelStageContext = Readonly<{
  phaseInputFingerprint: string;
  /** In-memory, content-free retention for a completed verifier/countercheck stage. */
  onCompletedModelObservation?: (observation: ModelStageObservation) => void;
  priorContextOverflowTopology?: ContextOverflowTopology;
  onContextOverflowTransition?: (input: {
    phaseInputFingerprint: string;
    recoveryProtocolFingerprint: string;
    rootScopeFingerprint: string;
    event: ContextOverflowTopologyEvent;
  }) => Promise<void>;
}>;

export type AuditVerificationResultWithObservation = AuditVerificationResult &
  Readonly<{
    modelObservation?: ModelStageObservation;
    /** Optional only at external test ports; production stages always declare a lane. */
    terminalLane?: VerificationTerminalLane;
  }>;

export type CandidateAwareCheckpointUpdate = Readonly<{
  vectorId: string;
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
  candidate: VerifiableHypothesis;
  evidenceMapFingerprint: string;
  sourcePostureFingerprint: string;
  state: AuditCandidateAwareCheckpoint['state'];
  result?: PersistedCandidateAwareResult;
  contextOverflowTopology?: CandidateAwareContextOverflowTopology;
}>;

type NormalizedCandidateAwareResult = AuditVerificationResult &
  Readonly<{
    modelObservation?: ModelStageObservation;
    terminalLane: VerificationTerminalLane;
    /** In-memory terminal signal; never included in a persisted verdict. */
    checkpointPersistenceFailed?: true;
  }>;

/**
 * Runs exactly one candidate-aware unit through the audit-wide pool. Its
 * state transitions are durable when the caller supplies the output callback;
 * an interrupted pending/running unit is never mistaken for a model result.
 */
export async function runCandidateAwareStage(input: {
  resumeState?: AuditResumeState;
  retryUnfinished: boolean;
  onCheckpoint?: (update: CandidateAwareCheckpointUpdate) => Promise<void>;
  candidateAwareDispatchPool: CandidateAwareDispatchPool;
  vector: AttackPlan['vectors'][number];
  phase: AuditCandidateAwareCheckpoint['phase'];
  candidateOrdinal: number;
  hypothesis: VerifiableHypothesis;
  evidenceMapFingerprint: string;
  sourcePostureFingerprint: string;
  execute: (
    context: CandidateAwareModelStageContext,
  ) => Promise<AuditVerificationResultWithObservation>;
}): Promise<NormalizedCandidateAwareResult> {
  const phaseInputFingerprint = recoveryPhaseInputFingerprint({
    phase: input.phase,
    candidateFingerprint: candidateAwareFingerprint(input.hypothesis),
    evidenceMapFingerprint: input.evidenceMapFingerprint,
    sourcePostureFingerprint: input.sourcePostureFingerprint,
  });
  const priorCheckpoint = input.resumeState?.candidateAwareCheckpoint({
    vectorId: input.vector.vectorId,
    phase: input.phase,
    candidateOrdinal: input.candidateOrdinal,
    candidate: input.hypothesis,
    evidenceMapFingerprint: input.evidenceMapFingerprint,
    sourcePostureFingerprint: input.sourcePostureFingerprint,
  });
  const prior = reusableCandidateAwareResult({
    checkpoint: priorCheckpoint,
    retryUnfinished: input.retryUnfinished,
  });
  if (prior !== undefined) return prior;
  let contextOverflowTopology = priorCheckpoint?.contextOverflowTopology;
  if (
    contextOverflowTopology !== undefined &&
    contextOverflowTopology.phaseInputFingerprint !== phaseInputFingerprint
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The candidate-aware context-overflow topology is bound to a different phase input.',
    );
  }
  const update = async (
    state: AuditCandidateAwareCheckpoint['state'],
    result?: PersistedCandidateAwareResult,
  ): Promise<void> =>
    persistAuditCheckpoint(() =>
      input.onCheckpoint?.({
        vectorId: input.vector.vectorId,
        phase: input.phase,
        candidateOrdinal: input.candidateOrdinal,
        candidate: input.hypothesis,
        evidenceMapFingerprint: input.evidenceMapFingerprint,
        sourcePostureFingerprint: input.sourcePostureFingerprint,
        state,
        ...(result === undefined ? {} : { result }),
        ...(contextOverflowTopology === undefined ? {} : { contextOverflowTopology }),
      }),
    );
  try {
    await update('pending');
  } catch (error) {
    if (isCheckpointPersistenceError(error))
      return checkpointPersistenceFailedCandidateAwareResult();
    throw error;
  }
  return input.candidateAwareDispatchPool.run(async () => {
    try {
      await update('running');
    } catch (error) {
      if (isCheckpointPersistenceError(error))
        return checkpointPersistenceFailedCandidateAwareResult();
      throw error;
    }
    let completedModelObservation: ModelStageObservation | undefined;
    let result: NormalizedCandidateAwareResult;
    try {
      result = normalizeCandidateAwareResult(
        await input.execute({
          phaseInputFingerprint,
          onCompletedModelObservation: (observation) => {
            completedModelObservation = observation;
          },
          ...(contextOverflowTopology === undefined
            ? {}
            : {
                priorContextOverflowTopology:
                  runtimeContextOverflowTopology(contextOverflowTopology),
              }),
          onContextOverflowTransition: async (transition) => {
            contextOverflowTopology = appendCandidateAwareContextOverflowEvent(
              contextOverflowTopology,
              {
                ...transition,
                phaseInputFingerprint,
              },
            );
            await update('running');
          },
        }),
      );
    } catch (error) {
      if (isProviderCancelled(error)) {
        input.candidateAwareDispatchPool.cancel(error);
        throw error;
      }
      if (isCheckpointPersistenceError(error)) {
        return checkpointPersistenceFailedCandidateAwareResult();
      }
      result = incompleteCandidateAwareResult(
        'wrapper-contract-invalid',
        completedModelObservation,
      );
    }
    try {
      await update('completed', persistCandidateAwareResult(result));
    } catch (error) {
      if (isCheckpointPersistenceError(error)) {
        return checkpointPersistenceFailedCandidateAwareResult(result.modelObservation);
      }
      throw error;
    }
    if (result.modelObservation?.errorCode === 'provider-cancelled') {
      const error = new AuditRuntimeError(
        'provider-cancelled',
        'The candidate-aware model stage was cancelled by the provider.',
      );
      input.candidateAwareDispatchPool.cancel(error);
      throw error;
    }
    return result;
  });
}

/** Restores only an exact terminal result; its original model rationale stays discarded. */
function reusableCandidateAwareResult(input: {
  checkpoint: AuditCandidateAwareCheckpoint | undefined;
  retryUnfinished: boolean;
}): NormalizedCandidateAwareResult | undefined {
  const checkpoint = input.checkpoint;
  if (
    checkpoint?.result === undefined ||
    (input.retryUnfinished && checkpoint.result.decision === 'incomplete')
  ) {
    return undefined;
  }
  const { execution, ...result } = checkpoint.result;
  const modelObservation = modelObservationForAuditCheckpointExecution(execution);
  return { ...result, ...(modelObservation === undefined ? {} : { modelObservation }) };
}

function runtimeContextOverflowTopology(
  topology: CandidateAwareContextOverflowTopology,
): ContextOverflowTopology {
  return {
    phaseInputFingerprint: topology.phaseInputFingerprint,
    recoveryProtocolFingerprint: topology.recoveryProtocolFingerprint,
    rootScopeFingerprint: topology.rootScopeFingerprint,
    events: topology.events.map(({ ordinal: _ordinal, savedAt: _savedAt, ...event }) => event),
  };
}

function appendCandidateAwareContextOverflowEvent(
  previous: CandidateAwareContextOverflowTopology | undefined,
  input: Readonly<{
    phaseInputFingerprint: string;
    recoveryProtocolFingerprint: string;
    rootScopeFingerprint: string;
    event: ContextOverflowTopologyEvent;
  }>,
): CandidateAwareContextOverflowTopology {
  if (
    previous !== undefined &&
    (previous.phaseInputFingerprint !== input.phaseInputFingerprint ||
      previous.recoveryProtocolFingerprint !== input.recoveryProtocolFingerprint ||
      previous.rootScopeFingerprint !== input.rootScopeFingerprint)
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'Candidate-aware context-overflow topology changed its exact recovery binding.',
    );
  }
  return {
    phaseInputFingerprint: input.phaseInputFingerprint,
    recoveryProtocolFingerprint: input.recoveryProtocolFingerprint,
    rootScopeFingerprint: input.rootScopeFingerprint,
    events: [
      ...(previous?.events ?? []),
      {
        ordinal: (previous?.events.length ?? 0) + 1,
        ...input.event,
        savedAt: new Date().toISOString(),
      },
    ],
  };
}

/** Stores the already source-minimal canonical decision and telemetry. */
function persistCandidateAwareResult(
  result: NormalizedCandidateAwareResult,
): PersistedCandidateAwareResult {
  const { modelObservation, ...persisted } = result;
  return { ...persisted, execution: auditCheckpointExecutionForModelObservation(modelObservation) };
}

/** Waits for already-dispatched siblings to settle after cancellation. */
export async function collectCandidateAwareResults<
  Result extends Readonly<{ modelObservation?: ModelStageObservation }> | undefined,
>(
  work: readonly Promise<Result>[],
): Promise<
  Readonly<{
    results: readonly Result[];
    modelObservations: readonly ModelStageObservation[];
    error: Error | undefined;
  }>
> {
  const settled = await Promise.allSettled(work);
  const results = settled.flatMap((entry) => (entry.status === 'fulfilled' ? [entry.value] : []));
  const modelObservations = results.flatMap((result) =>
    result?.modelObservation === undefined ? [] : [result.modelObservation],
  );
  const rejection = settled.find((entry) => entry.status === 'rejected');
  return {
    results,
    modelObservations,
    error:
      rejection === undefined
        ? undefined
        : rejection.reason instanceof Error
          ? rejection.reason
          : new AuditRuntimeError(
              'provider-failure',
              'A candidate-aware stage rejected without an Error object.',
            ),
  };
}

function incompleteCandidateAwareResult(
  terminalLane: Extract<VerificationTerminalLane, 'wrapper-contract-invalid'>,
  modelObservation?: ModelStageObservation,
): NormalizedCandidateAwareResult {
  return {
    decision: 'incomplete',
    reasonCode: 'output-invalid',
    claimEvidenceBundles: null,
    contradictionEvidence: null,
    inspectedEvidence: [],
    verifiedPlanObligations: [],
    affectedPlanObligations: [],
    controlAssessment: null,
    obligationReconciliations: [],
    postureReconciliations: [],
    terminalLane,
    ...(modelObservation === undefined ? {} : { modelObservation }),
  };
}

function checkpointPersistenceFailedCandidateAwareResult(
  modelObservation?: ModelStageObservation,
): NormalizedCandidateAwareResult {
  return {
    ...incompleteCandidateAwareResult('wrapper-contract-invalid', modelObservation),
    checkpointPersistenceFailed: true,
  };
}

export function candidateAwareOperationalError(
  result: AuditVerificationResultWithObservation,
  phase: 'verification' | 'countercheck',
): AuditError | undefined {
  if (result.terminalLane === 'rejected' || result.terminalLane === 'model-incomplete') {
    return undefined;
  }
  const label = phase === 'verification' ? 'verifier' : 'countercheck';
  return {
    code: materializeAuditErrorCode(
      result.modelObservation?.status === 'failed' && result.modelObservation.errorCode !== null
        ? result.modelObservation.errorCode
        : `${label}-${result.terminalLane}`,
    ),
    stage: phase,
    retryable: isRetryableAuditErrorCode(
      materializeAuditErrorCode(result.modelObservation?.errorCode ?? ''),
    ),
  };
}

function normalizeCandidateAwareResult(
  value: AuditVerificationResultWithObservation,
): NormalizedCandidateAwareResult {
  const { modelObservation, terminalLane: declaredLane, ...verdict } = value;
  const parsedVerdict = AuditVerificationResultSchema.safeParse(verdict);
  if (!parsedVerdict.success)
    return incompleteCandidateAwareResult('wrapper-contract-invalid', modelObservation);
  const parsedLane = VerificationTerminalLaneSchema.safeParse(
    declaredLane ?? terminalLaneForVerificationDecision(parsedVerdict.data.decision),
  );
  if (
    !parsedLane.success ||
    !isCompatibleTerminalLane(parsedVerdict.data.decision, parsedLane.data)
  ) {
    return incompleteCandidateAwareResult('wrapper-contract-invalid', modelObservation);
  }
  return {
    ...parsedVerdict.data,
    terminalLane: parsedLane.data,
    ...(modelObservation === undefined ? {} : { modelObservation }),
  };
}

function isCompatibleTerminalLane(
  decision: AuditVerificationResult['decision'],
  terminalLane: VerificationTerminalLane,
): boolean {
  if (decision === 'accepted') return terminalLane === 'accepted';
  if (decision === 'rejected') return terminalLane === 'rejected';
  return terminalLane !== 'accepted' && terminalLane !== 'rejected';
}

function isProviderCancelled(error: unknown): error is AuditRuntimeError {
  return error instanceof AuditRuntimeError && error.code === 'provider-cancelled';
}
