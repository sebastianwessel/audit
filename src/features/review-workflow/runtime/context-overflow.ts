import { isHarnessError } from '@purista/harness';

import { sha256 } from '../../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../../shared/errors/security-reviewer-error.js';
import type { ModelStageObservation } from '../../model-operations/model-operations.schema.js';
import type { ContextDocument } from '../../target-inventory/inventory.schema.js';

export type SourceLineRange = Readonly<{
  path: string;
  startLine: number;
  endLine: number;
}>;

export type ContextRecoveryScope = Readonly<{
  sourcePaths: readonly string[];
  lineRanges: readonly SourceLineRange[];
  /** Applicable advisory context, retained only in memory while a stage recovers. */
  context: readonly ContextDocument[];
}>;

export type ContextRecoveryLeaf<Result> = Readonly<{
  scope: ContextRecoveryScope;
  output: Result;
}>;

/**
 * A phase-owned, already validated recovery result. The shared coordinator
 * knows only its opaque scope identity and must never persist or interpret its
 * contents.
 */
export type ContextOverflowRecoveredLeaf<Result> = Readonly<{
  childKey: string;
  scopeFingerprint: string;
  output: Result;
}>;

export type ContextOverflowTopologyState =
  | 'pending'
  | 'running'
  | 'overflowed'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Source-free recovery progress; the matching scope remains in the snapshot. */
export type ContextOverflowTopologyEvent = Readonly<{
  childKey: string;
  attempt: number;
  scopeFingerprint: string;
  state: ContextOverflowTopologyState;
  errorCode: string | null;
  /** Content-free per-scope telemetry supplied by the shared stage lifecycle. */
  modelObservation?: ModelStageObservation;
}>;

export type ContextOverflowTopology = Readonly<{
  recoveryProtocolFingerprint: string;
  rootScopeFingerprint: string;
  events: readonly ContextOverflowTopologyEvent[];
}>;

/** Bump only with a deliberate breaking change to deterministic scope splitting. */
export const contextOverflowRecoveryProtocolFingerprint = sha256(
  'security-reviewer-context-overflow-topology-v2',
);

type ContextSelector = (
  context: readonly ContextDocument[],
  sourcePaths: readonly string[],
) => readonly ContextDocument[];

export type ContextOverflowRecoveryInput<Result> = Readonly<{
  sourcePaths: readonly string[];
  context?: readonly ContextDocument[];
  selectContext?: ContextSelector;
  invoke: (scope: ContextRecoveryScope, attempt: number) => Promise<Result>;
  reduce: (leaves: readonly ContextRecoveryLeaf<Result>[]) => Result;
  splitSingleton?: (
    path: string,
  ) => Promise<readonly [ContextRecoveryScope, ContextRecoveryScope] | undefined>;
  /**
   * A stage may reject context-only partitioning when one output needs every
   * applicable context document to remain a single, lossless decision basis.
   */
  allowContextSplitting?: boolean;
  onRecoveredFailure?: (error: unknown) => void;
  /** Exact prior topology may skip only a provider-confirmed overflowing parent. */
  priorTopology?: ContextOverflowTopology;
  /**
   * Exact phase-owned artifacts for successfully completed children. Their
   * shape is validated by the owning phase before this generic lifecycle sees
   * it; raw model output is never supplied here.
   */
  priorRecoveredLeaves?: readonly ContextOverflowRecoveredLeaf<Result>[];
  /**
   * Called before the completed topology event so a crash cannot claim a
   * reusable child whose validated artifact was not durably written.
   */
  onRecoveredLeafCompleted?: (input: {
    childKey: string;
    attempt: number;
    scope: ContextRecoveryScope;
    scopeFingerprint: string;
    output: Result;
  }) => Promise<void>;
  /** Persisted by the caller as source-free work progress before the next transition. */
  onTopologyTransition?: (event: ContextOverflowTopologyEvent) => Promise<void>;
  /** Maps non-overflow terminal errors without reading provider error text. */
  errorCode?: (error: unknown) => string;
}>;

/** Routes only Purista's provider-neutral context-window error into recovery. */
export function isContextLengthExceeded(error: unknown): boolean {
  return (
    isHarnessError(error) &&
    error.category === 'model' &&
    error.meta?.reason === 'context_length_exceeded'
  );
}

/**
 * Runs the full approved scope first. It partitions only after the provider has
 * explicitly rejected that request for its context length; no token estimate is
 * consulted. It partitions source paths, then source lines, then applicable
 * context documents/body lines. A successful recovered output therefore never
 * omits approved source or advisory context merely to fit a provider window.
 */
export async function recoverFromContextOverflow<Result>(
  input: ContextOverflowRecoveryInput<Result>,
): Promise<Result> {
  const scope = createPathScope(input.sourcePaths, input.context ?? [], input.selectContext);
  const rootScopeFingerprint = contextRecoveryScopeFingerprint(scope);
  assertPriorTopology(input.priorTopology, rootScopeFingerprint);
  const rootPreviouslyOverflowed = latestState(input.priorTopology, 'root') === 'overflowed';
  const leaves = await collectRecoveredLeaves(scope, input, 1, 'root', rootScopeFingerprint);
  if (!rootPreviouslyOverflowed && leaves.length === 1 && leaves[0]?.scope === scope) {
    const leaf = leaves[0];
    if (leaf === undefined) throw topologyMismatch();
    return leaf.output;
  }
  return input.reduce(leaves);
}

async function collectRecoveredLeaves<Result>(
  scope: ContextRecoveryScope,
  input: ContextOverflowRecoveryInput<Result>,
  attempt: number,
  childKey: string,
  expectedScopeFingerprint: string,
): Promise<readonly ContextRecoveryLeaf<Result>[]> {
  const scopeFingerprint = contextRecoveryScopeFingerprint(scope);
  if (scopeFingerprint !== expectedScopeFingerprint) throw topologyMismatch();
  assertRecordedScopeFingerprint(input.priorTopology, childKey, scopeFingerprint);
  const previousOverflow = latestState(input.priorTopology, childKey) === 'overflowed';
  const previousCompletion = latestState(input.priorTopology, childKey) === 'completed';
  const reusableLeaf = reusableRecoveredLeaf(
    input.priorRecoveredLeaves,
    childKey,
    scopeFingerprint,
  );
  if (reusableLeaf !== undefined) {
    if (!previousCompletion) throw topologyMismatch();
    return [{ scope, output: reusableLeaf.output }];
  }
  if (!previousOverflow) {
    const dispatchAttempt = nextAttempt(input.priorTopology, childKey);
    await emitTopologyTransition(input, {
      childKey,
      attempt: dispatchAttempt,
      scopeFingerprint,
      state: 'pending',
      errorCode: null,
    });
    await emitTopologyTransition(input, {
      childKey,
      attempt: dispatchAttempt,
      scopeFingerprint,
      state: 'running',
      errorCode: null,
    });
    try {
      const output = await input.invoke(scope, attempt);
      await input.onRecoveredLeafCompleted?.({
        childKey,
        attempt: dispatchAttempt,
        scope,
        scopeFingerprint,
        output,
      });
      await emitTopologyTransition(input, {
        childKey,
        attempt: dispatchAttempt,
        scopeFingerprint,
        state: 'completed',
        errorCode: null,
      });
      return [{ scope, output }];
    } catch (error) {
      if (!isContextLengthExceeded(error)) {
        const errorCode = input.errorCode?.(error) ?? 'provider-failure';
        await emitTopologyTransition(input, {
          childKey,
          attempt: dispatchAttempt,
          scopeFingerprint,
          state: errorCode === 'provider-cancelled' ? 'cancelled' : 'failed',
          errorCode,
        });
        throw error;
      }
      input.onRecoveredFailure?.(error);
      await emitTopologyTransition(input, {
        childKey,
        attempt: dispatchAttempt,
        scopeFingerprint,
        state: 'overflowed',
        errorCode: 'provider-context-overflow',
      });
    }
  }
  const partitions = await splitScope(scope, input);
  if (partitions === undefined) {
    throw new SecurityReviewerError(
      'provider-context-overflow',
      'The provider context window was exceeded for an indivisible approved source and context scope.',
    );
  }
  const left = partitions[0];
  const right = partitions[1];
  if (left === undefined || right === undefined) throw topologyMismatch();
  return [
    ...(await collectRecoveredLeaves(
      left,
      input,
      attempt + 1,
      `${childKey}/left`,
      contextRecoveryScopeFingerprint(left),
    )),
    ...(await collectRecoveredLeaves(
      right,
      input,
      attempt + 1,
      `${childKey}/right`,
      contextRecoveryScopeFingerprint(right),
    )),
  ];
}

function reusableRecoveredLeaf<Result>(
  leaves: readonly ContextOverflowRecoveredLeaf<Result>[] | undefined,
  childKey: string,
  scopeFingerprint: string,
): ContextOverflowRecoveredLeaf<Result> | undefined {
  const matches = (leaves ?? []).filter((leaf) => leaf.childKey === childKey);
  if (matches.some((leaf) => leaf.scopeFingerprint !== scopeFingerprint)) throw topologyMismatch();
  if (matches.length > 1) throw topologyMismatch();
  return matches[0];
}

/** Stable opaque identity for an in-memory recovery scope. */
export function contextRecoveryScopeFingerprint(scope: ContextRecoveryScope): string {
  return sha256(
    JSON.stringify({
      sourcePaths: [...scope.sourcePaths].sort((left, right) => left.localeCompare(right)),
      lineRanges: [...scope.lineRanges]
        .sort((left, right) =>
          `${left.path}\0${String(left.startLine)}\0${String(left.endLine)}`.localeCompare(
            `${right.path}\0${String(right.startLine)}\0${String(right.endLine)}`,
          ),
        )
        .map(({ path, startLine, endLine }) => ({ path, startLine, endLine })),
      contextDigests: scope.context
        .map((document) => document.digest)
        .sort((left, right) => left.localeCompare(right)),
    }),
  );
}

/** Computes the exact opaque root identity used by context-overflow recovery. */
export function contextRecoveryRootScopeFingerprint(input: {
  sourcePaths: readonly string[];
  context: readonly ContextDocument[];
  selectContext?: ContextSelector;
}): string {
  return contextRecoveryScopeFingerprint(
    createPathScope(input.sourcePaths, input.context, input.selectContext),
  );
}

function assertPriorTopology(
  topology: ContextOverflowTopology | undefined,
  rootScopeFingerprint: string,
): void {
  if (topology === undefined) return;
  if (
    topology.recoveryProtocolFingerprint !== contextOverflowRecoveryProtocolFingerprint ||
    topology.rootScopeFingerprint !== rootScopeFingerprint
  ) {
    throw topologyMismatch();
  }
}

function latestState(
  topology: ContextOverflowTopology | undefined,
  childKey: string,
): ContextOverflowTopologyState | undefined {
  return [...(topology?.events ?? [])].reverse().find((event) => event.childKey === childKey)
    ?.state;
}

function assertRecordedScopeFingerprint(
  topology: ContextOverflowTopology | undefined,
  childKey: string,
  scopeFingerprint: string,
): void {
  if (
    topology?.events.some(
      (event) => event.childKey === childKey && event.scopeFingerprint !== scopeFingerprint,
    ) === true
  ) {
    throw topologyMismatch();
  }
}

function nextAttempt(topology: ContextOverflowTopology | undefined, childKey: string): number {
  return (
    Math.max(
      0,
      ...(topology?.events ?? [])
        .filter((event) => event.childKey === childKey)
        .map((event) => event.attempt),
    ) + 1
  );
}

async function emitTopologyTransition<Result>(
  input: ContextOverflowRecoveryInput<Result>,
  event: ContextOverflowTopologyEvent,
): Promise<void> {
  await input.onTopologyTransition?.(event);
}

function topologyMismatch(): SecurityReviewerError {
  return new SecurityReviewerError(
    'artifact-invalid',
    'The persisted context-overflow topology does not match the current recovery scope.',
  );
}

function createPathScope(
  sourcePaths: readonly string[],
  context: readonly ContextDocument[],
  selectContext: ContextSelector | undefined,
): ContextRecoveryScope {
  const canonicalPaths = canonicalSourcePaths(sourcePaths);
  return {
    sourcePaths: canonicalPaths,
    lineRanges: [],
    context: selectContext === undefined ? context : selectContext(context, canonicalPaths),
  };
}

function canonicalSourcePaths(sourcePaths: readonly string[]): readonly string[] {
  return [...new Set(sourcePaths)].sort((left, right) => left.localeCompare(right));
}

async function splitScope<Result>(
  scope: ContextRecoveryScope,
  input: ContextOverflowRecoveryInput<Result>,
): Promise<readonly [ContextRecoveryScope, ContextRecoveryScope] | undefined> {
  if (scope.sourcePaths.length >= 2) {
    const midpoint = Math.ceil(scope.sourcePaths.length / 2);
    return [
      createPathScope(scope.sourcePaths.slice(0, midpoint), scope.context, input.selectContext),
      createPathScope(scope.sourcePaths.slice(midpoint), scope.context, input.selectContext),
    ];
  }
  const sourcePath = scope.sourcePaths[0];
  if (sourcePath === undefined) return undefined;
  const range = scope.lineRanges.find((candidate) => candidate.path === sourcePath);
  if (range !== undefined) {
    const linePartitions = splitLineRange(range, scope.context);
    if (linePartitions !== undefined) return linePartitions;
  }
  const sourcePartitions = await input.splitSingleton?.(sourcePath);
  if (sourcePartitions !== undefined) {
    const [left, right] = sourcePartitions;
    return [
      { ...left, context: scope.context },
      { ...right, context: scope.context },
    ];
  }
  return input.allowContextSplitting === false
    ? undefined
    : splitContext(scope.context, scope.sourcePaths, scope.lineRanges);
}

function splitLineRange(
  range: SourceLineRange,
  context: readonly ContextDocument[],
): readonly [ContextRecoveryScope, ContextRecoveryScope] | undefined {
  if (range.startLine >= range.endLine) return undefined;
  const midpoint = Math.floor((range.startLine + range.endLine) / 2);
  return [
    {
      sourcePaths: [range.path],
      lineRanges: [{ path: range.path, startLine: range.startLine, endLine: midpoint }],
      context,
    },
    {
      sourcePaths: [range.path],
      lineRanges: [{ path: range.path, startLine: midpoint + 1, endLine: range.endLine }],
      context,
    },
  ];
}

function splitContext(
  context: readonly ContextDocument[],
  sourcePaths: readonly string[],
  lineRanges: readonly SourceLineRange[],
): readonly [ContextRecoveryScope, ContextRecoveryScope] | undefined {
  if (context.length >= 2) {
    const midpoint = Math.ceil(context.length / 2);
    return [
      { sourcePaths, lineRanges, context: context.slice(0, midpoint) },
      { sourcePaths, lineRanges, context: context.slice(midpoint) },
    ];
  }
  const document = context[0];
  if (document === undefined) return undefined;
  const lines = splitContextBody(document.body);
  if (lines.length < 2) return undefined;
  const midpoint = Math.floor(lines.length / 2);
  return [
    {
      sourcePaths,
      lineRanges,
      context: [createContextChunk(document, lines.slice(0, midpoint).join(''))],
    },
    {
      sourcePaths,
      lineRanges,
      context: [createContextChunk(document, lines.slice(midpoint).join(''))],
    },
  ];
}

function createContextChunk(document: ContextDocument, body: string): ContextDocument {
  return {
    ...document,
    body,
    digest: sha256(
      `${document.path}\0${document.title}\0${document.kind}\0${document.sensitivity}\0${document.appliesTo.join('\0')}\0${body}`,
    ),
  };
}

/** Splits physical lines while retaining their original line terminators. */
function splitContextBody(body: string): readonly string[] {
  return body.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+/gu) ?? [];
}
