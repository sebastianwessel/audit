import type { ModelProvider } from '@purista/harness';
import { ZodError } from 'zod';
import {
  createAuditHarnessWithExecution,
  type HarnessExecutionConfiguration,
} from '../../../platform/harness/audit-harness.js';
import { sha256 } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import type { AuditCheckpointExecution } from '../../audit-execution/audit.schema.js';
import {
  combineToolUsage,
  createModelStageTraceRecorder,
  createProviderUsageRecorder,
  type EvaluatorFailureDiagnosticSink,
  hasSuccessfulScopedSourceInspection,
  type ModelPricing,
  type ModelRoute,
  type ModelStage,
  type ModelStageObservation,
  type ModelStageTraceEvent,
  observeModelStage,
  type ProviderRequestUsage,
  type ToolUsage,
  writeEvaluatorFailureDiagnostic,
} from '../../model-operations/model-operations.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';
import type { SourceRepository } from '../../target-inventory/source-snapshot.js';
import {
  type ContextOverflowRecoveredLeaf,
  type ContextOverflowTopology,
  type ContextOverflowTopologyEvent,
  type ContextRecoveryLeaf,
  type ContextRecoveryScope,
  contextRecoveryScopeFingerprint,
  recoverFromContextOverflow,
} from '../runtime/context-overflow.js';
import { invokeWithStageRetry, stageErrorCode } from '../runtime/invocation.js';
import {
  ModelOutputValidationError,
  type ModelRetryGuidance,
  outputValidationGuidanceForPaths,
  validationRetryGuidanceForError,
} from '../runtime/retry-guidance.js';
import { createReviewSourceTools, selectApplicableContext } from '../runtime/source-tools.js';
import { createObservedReviewToolset } from '../tools/operations.js';

export type { EvaluatorFailureDiagnosticSink } from '../../model-operations/model-operations.js';

type AuditHarness = ReturnType<typeof createAuditHarnessWithExecution>;
type AuditSession = Awaited<ReturnType<AuditHarness['getSession']>>;

/**
 * Runs deterministic projection of a provider response while the scoped stage
 * still owns its terminal observation. Projection code must convert any
 * model-output contract violation to a stable, content-free error before it
 * can leave the stage lifecycle.
 */
export function projectScopedModelOutput<Result>(project: () => Result): Result {
  try {
    return project();
  } catch (error) {
    if (isZodProjectionError(error)) {
      const labels = error.issues
        .map((issue) =>
          issue.path.map((segment) => (typeof segment === 'string' ? segment : 'item')).join('.'),
        )
        .filter((path) => path.length > 0);
      throw new ModelOutputValidationError(
        outputValidationGuidanceForPaths(labels.length === 0 ? ['output'] : labels),
      );
    }
    throw error;
  }
}

function isZodProjectionError(error: unknown): error is ZodError {
  if (error instanceof ZodError) return true;
  if (typeof error !== 'object' || error === null || !('issues' in error)) return false;
  const issues = error.issues;
  return (
    Array.isArray(issues) &&
    issues.every(
      (issue) =>
        typeof issue === 'object' &&
        issue !== null &&
        'path' in issue &&
        Array.isArray(issue.path) &&
        issue.path.every(
          (segment: unknown) => typeof segment === 'string' || typeof segment === 'number',
        ),
    )
  );
}

export type ScopedModelStageCompleted<Result> = Readonly<{
  status: 'completed';
  output: Result;
  modelObservation: ModelStageObservation;
  toolUsage: ToolUsage;
}>;

export type ScopedModelStageFailed = Readonly<{
  status: 'failed';
  errorCode: string;
  modelObservation: ModelStageObservation;
  toolUsage: ToolUsage;
}>;

/**
 * The feature-owned stage contract may extend this base with its validated
 * recovery leaf shape, but every scoped stage shares this exact durable
 * topology binding.
 */
export type ScopedModelStageOverflowTopologyBase = Readonly<{
  phaseInputFingerprint: string;
  prior?: ContextOverflowTopology;
  onTransition: (event: ContextOverflowTopologyEvent) => Promise<void>;
}>;

export type ScopedModelStageOverflowTopology<Result> = ScopedModelStageOverflowTopologyBase &
  Readonly<{
    /** Phase-owned validated output artifacts that may be reused by exact scope. */
    priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<Result>[];
    onRecoveredLeafCompleted?: (input: {
      childKey: string;
      attempt: number;
      scope: ContextRecoveryScope;
      scopeFingerprint: string;
      execution: AuditCheckpointExecution;
      output: Result;
    }) => Promise<void>;
  }>;

/**
 * Runs the invariant, content-free lifecycle shared by scoped audit model stages.
 * Stage modules retain their workflow call and any stage-specific admission policy.
 */
export async function runScopedModelStage<Result, RawOutput = Result>(input: {
  stage: ModelStage;
  route: ModelRoute;
  stageId: string;
  modelProvider: ModelProvider;
  filesystem: SourceRepository;
  availableSourcePaths: readonly string[];
  context: readonly ContextDocument[];
  sessionId: string;
  modelName: string | undefined;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  cacheRoutingEnabled: boolean;
  /**
   * Tool-guided, source-deciding phases may require an actual scoped source
   * read or search. This is protocol integrity only: it neither interprets
   * source text nor decides a security conclusion.
   */
  requireScopedSourceInspection?: boolean;
  /**
   * An owning stage may declare that a recovered child has no bounded work.
   * Such a child performs no model dispatch and must return the stage-owned
   * empty output; it is never treated as a completed source inspection.
   */
  hasModelWorkInScope?: (scope: ContextRecoveryScope) => boolean;
  emptyScopeOutput?: (scope: ContextRecoveryScope) => Result;
  /** Disables context-only splitting for stages without a lossless context merger. */
  allowContextSplitting?: boolean;
  /** Disables all child splitting when no lossless stage reducer exists. */
  allowScopeSplitting?: boolean;
  /**
   * Optional application-owned durable recovery topology. The shared stage
   * emits source-free transitions but never persists or interprets them.
   */
  overflowTopology?: ScopedModelStageOverflowTopology<Result>;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
  /**
   * In-memory notification emitted after the complete, content-free stage
   * observation exists and before this lifecycle returns to an owning
   * workflow. It deliberately receives no output, source, prompt, tool data,
   * or raw model response.
   */
  onCompletedModelObservation?: (observation: ModelStageObservation) => void;
  invoke: (
    session: AuditSession,
    attempt: number,
    scope: ContextRecoveryScope,
    retryGuidance: ModelRetryGuidance,
  ) => Promise<RawOutput>;
  /** Feature-owned conversion of raw model output before stage completion. */
  projectOutput: (output: RawOutput, scope: ContextRecoveryScope) => Result;
  reduceRecoveredOutputs?: (leaves: readonly ContextRecoveryLeaf<Result>[]) => Result;
}): Promise<ScopedModelStageCompleted<Result> | ScopedModelStageFailed> {
  const trace = createModelStageTraceRecorder({ pricing: input.modelPricing });
  const recorder = createProviderUsageRecorder(input.modelProvider, {
    onResponse: trace.recordModelResponse,
  });
  const toolUsages: ToolUsage[] = [];
  const reusedScopeObservations = reusableLeafObservations(input.overflowTopology);
  const scopeObservations = new Map<string, ModelStageObservation>();
  let invocationOrdinal = 0;
  const started = performance.now();
  const recoveredErrorCodes: string[] = [];
  try {
    const output = await recoverFromContextOverflow<Result>({
      phaseInputFingerprint:
        input.overflowTopology?.phaseInputFingerprint ?? sha256(`${input.stage}\0${input.stageId}`),
      sourcePaths: input.availableSourcePaths,
      context: input.context,
      selectContext: selectApplicableContext,
      invoke: async (scope, recoveryAttempt) => {
        if (input.hasModelWorkInScope?.(scope) === false) {
          if (input.emptyScopeOutput === undefined) {
            throw new AuditRuntimeError(
              'artifact-invalid',
              'A scoped model stage declared empty recovery work without an owned empty output.',
            );
          }
          return input.emptyScopeOutput(scope);
        }
        const scopeStarted = performance.now();
        const requestsBefore = recorder.requests().length;
        const traceBefore = trace.events().length;
        const scopeToolUsages: ToolUsage[] = [];
        const scopeRecoveredErrorCodes: string[] = [];
        const scopeFingerprint = contextRecoveryScopeFingerprint(scope);
        let lastAttemptOrdinal = 1;
        try {
          const output = await invokeWithStageRetry(
            input.harnessExecution,
            async (retryAttempt) => {
              lastAttemptOrdinal = retryAttempt.ordinal;
              invocationOrdinal += 1;
              const observedToolset = createObservedReviewToolset(
                createReviewSourceTools(
                  input.filesystem,
                  new Set(scope.sourcePaths),
                  new Map(scope.lineRanges.map((range) => [range.path, range])),
                ),
                trace,
              );
              const harness = createAuditHarnessWithExecution(
                recorder.provider,
                observedToolset.toolset,
                input.modelName,
                input.harnessExecution,
                input.modelCacheRoutingKey,
              );
              const session = await harness.getSession(
                `${input.sessionId}-recovery-${recoveryAttempt}-invocation-${invocationOrdinal}-attempt-${retryAttempt.ordinal}`,
              );
              try {
                const output = await input.invoke(
                  session,
                  retryAttempt.ordinal,
                  scope,
                  retryAttempt.guidance,
                );
                if (
                  input.requireScopedSourceInspection === true &&
                  scope.sourcePaths.length > 0 &&
                  !hasSuccessfulScopedSourceInspection(observedToolset.usage())
                ) {
                  throw new AuditRuntimeError(
                    'coverage-incomplete',
                    'A tool-guided source-deciding stage completed without inspecting scoped source.',
                  );
                }
                return input.projectOutput(output, scope);
              } finally {
                await session.close();
                const toolUsage = observedToolset.usage();
                toolUsages.push(toolUsage);
                scopeToolUsages.push(toolUsage);
                await harness.shutdown();
              }
            },
            {
              onRecoverableFailure: (error) => {
                const errorCode = stageErrorCode(error);
                recoveredErrorCodes.push(errorCode);
                scopeRecoveredErrorCodes.push(errorCode);
              },
            },
          );
          scopeObservations.set(
            scopeFingerprint,
            observeScopeModelStage({
              configuration: input,
              scopeFingerprint,
              status: 'completed',
              errorCode: null,
              startedAt: scopeStarted,
              requests: recorder.requests().slice(requestsBefore),
              trace: reindexScopeTrace(trace.events().slice(traceBefore)),
              toolUsage: combineToolUsage(scopeToolUsages),
              recoveredErrorCodes: scopeRecoveredErrorCodes,
            }),
          );
          return output;
        } catch (error) {
          const errorCode = stageErrorCode(error);
          const durationMs = performance.now() - scopeStarted;
          scopeObservations.set(
            scopeFingerprint,
            observeScopeModelStage({
              configuration: input,
              scopeFingerprint,
              status: 'failed',
              errorCode,
              startedAt: scopeStarted,
              requests: recorder.requests().slice(requestsBefore),
              trace: reindexScopeTrace(trace.events().slice(traceBefore)),
              toolUsage: combineToolUsage(scopeToolUsages),
              recoveredErrorCodes: scopeRecoveredErrorCodes,
            }),
          );
          await writeEvaluatorFailureDiagnostic(input.evaluatorFailureDiagnosticSink, {
            stage: input.stage,
            route: input.route,
            stageId: input.stageId,
            attemptOrdinal: lastAttemptOrdinal,
            durationMs,
            scopeFingerprint,
            errorCode,
            validationRetryGuidance: validationRetryGuidanceForError(error),
            error,
          });
          throw error;
        }
      },
      reduce: (leaves) => {
        if (input.reduceRecoveredOutputs === undefined) {
          throw new AuditRuntimeError(
            'provider-context-overflow',
            'The stage cannot losslessly recover a provider context overflow.',
          );
        }
        return input.reduceRecoveredOutputs(leaves);
      },
      splitSingleton: async (path) => splitSingleSource(input.filesystem, path),
      ...(input.allowContextSplitting === undefined
        ? {}
        : { allowContextSplitting: input.allowContextSplitting }),
      ...(input.allowScopeSplitting === undefined
        ? {}
        : { allowScopeSplitting: input.allowScopeSplitting }),
      ...(input.overflowTopology === undefined
        ? {}
        : {
            ...(input.overflowTopology.prior === undefined
              ? {}
              : { priorTopology: input.overflowTopology.prior }),
            ...(input.overflowTopology.priorRecoveredLeaves === undefined
              ? {}
              : { priorRecoveredLeaves: input.overflowTopology.priorRecoveredLeaves }),
            ...(input.overflowTopology.onRecoveredLeafCompleted === undefined
              ? {}
              : {
                  onRecoveredLeafCompleted: async (leaf) =>
                    input.overflowTopology?.onRecoveredLeafCompleted?.({
                      ...leaf,
                      execution: executionForRecoveredScope(
                        scopeObservations.get(leaf.scopeFingerprint),
                      ),
                    }),
                }),
            onTopologyTransition: async (event) =>
              input.overflowTopology?.onTransition({
                ...event,
                ...(event.state === 'completed' ||
                event.state === 'failed' ||
                event.state === 'cancelled' ||
                event.state === 'overflowed'
                  ? {
                      execution: executionForRecoveredScope(
                        scopeObservations.get(event.scopeFingerprint),
                      ),
                    }
                  : {}),
              }),
          }),
      errorCode: stageErrorCode,
      onRecoveredFailure: (error) => {
        recoveredErrorCodes.push(stageErrorCode(error));
      },
    });
    const toolUsage = combineToolUsage([
      ...reusedScopeObservations.map((observation) => observation.toolUsage),
      ...toolUsages,
    ]);
    const modelObservation = observeModelStage({
      stage: input.stage,
      route: input.route,
      stageId: input.stageId,
      status: 'completed',
      durationMs:
        performance.now() -
        started +
        reusedScopeObservations.reduce((total, observation) => total + observation.durationMs, 0),
      errorCode: null,
      recoveredErrorCodes: [
        ...reusedScopeObservations.flatMap((observation) => observation.recoveredErrorCodes),
        ...recoveredErrorCodes,
      ],
      requests: [
        ...reusedScopeObservations.flatMap((observation) => observation.requests),
        ...recorder.requests(),
      ],
      pricing: input.modelPricing,
      toolUsage,
      trace: reindexScopeTrace([
        ...reusedScopeObservations.flatMap((observation) => observation.trace),
        ...trace.events(),
      ]),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    input.onCompletedModelObservation?.(modelObservation);
    return {
      status: 'completed',
      output,
      toolUsage,
      modelObservation,
    };
  } catch (error) {
    const toolUsage = combineToolUsage([
      ...reusedScopeObservations.map((observation) => observation.toolUsage),
      ...toolUsages,
    ]);
    const errorCode = stageErrorCode(error);
    return {
      status: 'failed',
      errorCode,
      toolUsage,
      modelObservation: observeModelStage({
        stage: input.stage,
        route: input.route,
        stageId: input.stageId,
        status: 'failed',
        durationMs:
          performance.now() -
          started +
          reusedScopeObservations.reduce((total, observation) => total + observation.durationMs, 0),
        errorCode,
        recoveredErrorCodes: [
          ...reusedScopeObservations.flatMap((observation) => observation.recoveredErrorCodes),
          ...recoveredErrorCodes,
        ],
        requests: [
          ...reusedScopeObservations.flatMap((observation) => observation.requests),
          ...recorder.requests(),
        ],
        pricing: input.modelPricing,
        toolUsage,
        trace: reindexScopeTrace([
          ...reusedScopeObservations.flatMap((observation) => observation.trace),
          ...trace.events(),
        ]),
        cacheRoutingEnabled: input.cacheRoutingEnabled,
      }),
    };
  }
}

/** Only validated phase artifacts may promote a child observation into resumed stage accounting. */
function reusableLeafObservations<Result>(
  topology:
    | Readonly<{
        prior?: ContextOverflowTopology;
        priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<Result>[];
      }>
    | undefined,
): readonly ModelStageObservation[] {
  if (topology?.prior === undefined || topology.priorRecoveredLeaves === undefined) return [];
  const reusedScopes = new Set(topology.priorRecoveredLeaves.map((leaf) => leaf.scopeFingerprint));
  return topology.prior.events.flatMap((event) =>
    event.state === 'completed' &&
    reusedScopes.has(event.scopeFingerprint) &&
    event.execution?.kind === 'provider'
      ? [event.execution.modelObservation]
      : [],
  );
}

function executionForRecoveredScope(
  observation: ModelStageObservation | undefined,
): AuditCheckpointExecution {
  return observation === undefined
    ? { kind: 'deterministic' }
    : { kind: 'provider', modelObservation: observation };
}

function observeScopeModelStage(input: {
  configuration: Readonly<{
    stage: ModelStage;
    route: ModelRoute;
    stageId: string;
    modelPricing: ModelPricing;
    cacheRoutingEnabled: boolean;
  }>;
  scopeFingerprint: string;
  status: 'completed' | 'failed';
  errorCode: string | null;
  startedAt: number;
  requests: readonly ProviderRequestUsage[];
  trace: readonly ModelStageTraceEvent[];
  toolUsage: ToolUsage;
  recoveredErrorCodes: readonly string[];
}): ModelStageObservation {
  return observeModelStage({
    stage: input.configuration.stage,
    route: input.configuration.route,
    stageId: `${input.configuration.stageId}:${input.scopeFingerprint.slice(0, 16)}`,
    status: input.status,
    durationMs: performance.now() - input.startedAt,
    errorCode: input.errorCode,
    recoveredErrorCodes: input.recoveredErrorCodes,
    requests: input.requests,
    pricing: input.configuration.modelPricing,
    toolUsage: input.toolUsage,
    trace: input.trace,
    cacheRoutingEnabled: input.configuration.cacheRoutingEnabled,
  });
}

/** A child observation is self-contained, so its trace restarts at ordinal one. */
function reindexScopeTrace(
  trace: readonly ModelStageTraceEvent[],
): readonly ModelStageTraceEvent[] {
  let requestOrdinal = 0;
  return trace.map((event, index) => {
    if (event.kind === 'model-response') {
      requestOrdinal += 1;
      return { ...event, ordinal: index + 1, requestOrdinal };
    }
    return { ...event, ordinal: index + 1 };
  });
}

async function splitSingleSource(
  filesystem: SourceRepository,
  path: string,
): Promise<readonly [ContextRecoveryScope, ContextRecoveryScope] | undefined> {
  const source = await filesystem.readFile({
    root: 'target',
    relativePath: path,
    startLine: 1,
  });
  if (source.endLine < 2) {
    return undefined;
  }
  const midpoint = Math.floor(source.endLine / 2);
  return [
    {
      sourcePaths: [path],
      lineRanges: [{ path, startLine: 1, endLine: midpoint }],
      context: [],
    },
    {
      sourcePaths: [path],
      lineRanges: [{ path, startLine: midpoint + 1, endLine: source.endLine }],
      context: [],
    },
  ];
}
