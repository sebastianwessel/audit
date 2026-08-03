import type { ModelProvider } from '@purista/harness';
import {
  createSecurityReviewerHarnessWithExecution,
  type HarnessExecutionConfiguration,
} from '../../../platform/harness/security-reviewer-harness.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import {
  combineToolUsage,
  createModelStageTraceRecorder,
  createProviderUsageRecorder,
  hasSuccessfulScopedSourceInspection,
  type ModelCostCeiling,
  type ModelPricing,
  type ModelRoute,
  type ModelStage,
  type ModelStageObservation,
  type ModelStageTraceEvent,
  observeModelStage,
  type ProviderRequestUsage,
  type ToolUsage,
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
import { createReviewSourceTools, selectApplicableContext } from '../runtime/source-tools.js';
import { createObservedReviewToolset } from '../tools/operations.js';

type SecurityReviewerHarness = ReturnType<typeof createSecurityReviewerHarnessWithExecution>;
type SecurityReviewerSession = Awaited<ReturnType<SecurityReviewerHarness['getSession']>>;

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
 * Runs the invariant, content-free lifecycle shared by scoped audit model stages.
 * Stage modules retain their workflow call and any stage-specific admission policy.
 */
export async function runScopedModelStage<Result>(input: {
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
  modelCostCeiling?: ModelCostCeiling;
  cacheRoutingEnabled: boolean;
  /**
   * Tool-guided, source-deciding phases may require an actual scoped source
   * read or search. This is protocol integrity only: it neither interprets
   * source text nor decides a security conclusion.
   */
  requireScopedSourceInspection?: boolean;
  /**
   * Optional application-owned durable recovery topology. The shared stage
   * emits source-free transitions but never persists or interprets them.
   */
  overflowTopology?: Readonly<{
    prior?: ContextOverflowTopology;
    /** Phase-owned validated output artifacts that may be reused by exact scope. */
    priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<Result>[];
    onTransition: (event: ContextOverflowTopologyEvent) => Promise<void>;
    onRecoveredLeafCompleted?: (input: {
      childKey: string;
      attempt: number;
      scope: ContextRecoveryScope;
      scopeFingerprint: string;
      output: Result;
    }) => Promise<void>;
  }>;
  invoke: (
    session: SecurityReviewerSession,
    attempt: number,
    scope: ContextRecoveryScope,
  ) => Promise<Result>;
  reduceRecoveredOutputs?: (leaves: readonly ContextRecoveryLeaf<Result>[]) => Result;
}): Promise<ScopedModelStageCompleted<Result> | ScopedModelStageFailed> {
  const trace = createModelStageTraceRecorder({ pricing: input.modelPricing });
  const recorder = createProviderUsageRecorder(input.modelProvider, {
    ...(input.modelCostCeiling === undefined ? {} : { costCeiling: input.modelCostCeiling }),
    pricing: input.modelPricing,
    onResponse: trace.recordModelResponse,
  });
  const toolUsages: ToolUsage[] = [];
  const reusedScopeObservations = reusableLeafObservations(input.overflowTopology);
  const scopeObservations = new Map<string, ModelStageObservation>();
  let invocationOrdinal = 0;
  const started = performance.now();
  const recoveredErrorCodes: string[] = [];
  try {
    const output = await recoverFromContextOverflow({
      sourcePaths: input.availableSourcePaths,
      context: input.context,
      selectContext: selectApplicableContext,
      invoke: async (scope, recoveryAttempt) => {
        const scopeStarted = performance.now();
        const requestsBefore = recorder.requests().length;
        const traceBefore = trace.events().length;
        const scopeToolUsages: ToolUsage[] = [];
        const scopeRecoveredErrorCodes: string[] = [];
        const scopeFingerprint = contextRecoveryScopeFingerprint(scope);
        try {
          const output = await invokeWithStageRetry(
            input.harnessExecution,
            async (attempt) => {
              invocationOrdinal += 1;
              const observedToolset = createObservedReviewToolset(
                createReviewSourceTools(
                  input.filesystem,
                  new Set(scope.sourcePaths),
                  new Map(scope.lineRanges.map((range) => [range.path, range])),
                ),
                trace,
              );
              const harness = createSecurityReviewerHarnessWithExecution(
                recorder.provider,
                observedToolset.toolset,
                input.modelName,
                input.harnessExecution,
                input.modelCacheRoutingKey,
              );
              const session = await harness.getSession(
                `${input.sessionId}-recovery-${recoveryAttempt}-invocation-${invocationOrdinal}-attempt-${attempt}`,
              );
              try {
                const output = await input.invoke(session, attempt, scope);
                if (
                  input.requireScopedSourceInspection === true &&
                  scope.sourcePaths.length > 0 &&
                  !hasSuccessfulScopedSourceInspection(observedToolset.usage())
                ) {
                  throw new SecurityReviewerError(
                    'coverage-incomplete',
                    'A tool-guided source-deciding stage completed without inspecting scoped source.',
                  );
                }
                return output;
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
          scopeObservations.set(
            scopeFingerprint,
            observeScopeModelStage({
              configuration: input,
              scopeFingerprint,
              status: 'failed',
              errorCode: stageErrorCode(error),
              startedAt: scopeStarted,
              requests: recorder.requests().slice(requestsBefore),
              trace: reindexScopeTrace(trace.events().slice(traceBefore)),
              toolUsage: combineToolUsage(scopeToolUsages),
              recoveredErrorCodes: scopeRecoveredErrorCodes,
            }),
          );
          throw error;
        }
      },
      reduce: (leaves) => {
        if (input.reduceRecoveredOutputs === undefined) {
          throw new SecurityReviewerError(
            'provider-context-overflow',
            'The stage cannot losslessly recover a provider context overflow.',
          );
        }
        return input.reduceRecoveredOutputs(leaves);
      },
      splitSingleton: async (path) => splitSingleSource(input.filesystem, path),
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
              : { onRecoveredLeafCompleted: input.overflowTopology.onRecoveredLeafCompleted }),
            onTopologyTransition: async (event) =>
              input.overflowTopology?.onTransition({
                ...event,
                ...(event.state === 'completed' ||
                event.state === 'failed' ||
                event.state === 'cancelled'
                  ? (() => {
                      const modelObservation = scopeObservations.get(event.scopeFingerprint);
                      return modelObservation === undefined ? {} : { modelObservation };
                    })()
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
    return {
      status: 'completed',
      output,
      toolUsage,
      modelObservation: observeModelStage({
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
      }),
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
    event.modelObservation !== undefined
      ? [event.modelObservation]
      : [],
  );
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
