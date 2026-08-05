import type { ModelProvider } from '@purista/harness';
import type {
  PlanModelOutput,
  PlanModelRequest,
} from '../../src/features/attack-planning/index.js';
import {
  assertPlanIsSealed,
  PlanModelRequestSchema,
} from '../../src/features/attack-planning/index.js';
import { runPlanningStage } from '../../src/features/attack-planning/planner/stage/index.js';
import type { AuditReport } from '../../src/features/audit-execution/audit.schema.js';
import type {
  CandidateGroundingRequest,
  CandidateGroundingStageOutput,
} from '../../src/features/audit-execution/candidate-grounding/contract.js';
import { CandidateGroundingRequestSchema } from '../../src/features/audit-execution/candidate-grounding/contract.js';
import { runCandidateGroundingStage } from '../../src/features/audit-execution/candidate-grounding/stage/index.js';
import type { EvidenceMap } from '../../src/features/audit-execution/evidence-map/contract.js';
import { runEvidenceMapStage } from '../../src/features/audit-execution/evidence-map/stage/index.js';
import type {
  HypothesisSeed,
  InvestigationObligationClosure,
} from '../../src/features/audit-execution/investigation/contract.js';
import { runInvestigationStage } from '../../src/features/audit-execution/investigation/stage/index.js';
import { modelStagesForAudit } from '../../src/features/audit-execution/model-stage-observations.js';
import type {
  AuditInvestigationRequest,
  EvidenceMapRequest,
  SourceDocument,
  SourcePostureRequest,
} from '../../src/features/audit-execution/phase-input/contract.js';
import {
  AuditInvestigationRequestSchema,
  EvidenceMapRequestSchema,
  SourceDocumentSchema,
  SourcePostureRequestSchema,
} from '../../src/features/audit-execution/phase-input/contract.js';
import type { SourcePosture } from '../../src/features/audit-execution/source-posture/contract.js';
import { runSourcePostureStage } from '../../src/features/audit-execution/source-posture/stage/index.js';
import type { AuditVerificationRequest } from '../../src/features/audit-execution/verification/contract.js';
import { AuditVerificationRequestSchema } from '../../src/features/audit-execution/verification/contract.js';
import { runVerificationStage } from '../../src/features/audit-execution/verification/stage/index.js';
import {
  combineToolUsage,
  type EvaluatorFailureDiagnosticSink,
  emptyToolUsage,
  type ModelCostCeiling,
  type ModelPricing,
  type ModelStageObservation,
  summarizeModelStages,
} from '../../src/features/model-operations/model-operations.js';
import type { ModelRoute } from '../../src/features/model-operations/model-operations.schema.js';
import { stageErrorCode } from '../../src/features/review-workflow/runtime/invocation.js';
import { createReviewService } from '../../src/features/review-workflow/service.js';
import { ContextDocumentSchema } from '../../src/features/target-inventory/inventory.schema.js';
import type { JailedReadOnlyFilesystem } from '../../src/platform/filesystem/index.js';
import {
  assertLiveHarnessStructuredOutputCompatibility,
  auditWorkflowStructuredOutputRegistry,
  type HarnessExecutionConfiguration,
} from '../../src/platform/harness/audit-harness.js';
import { canonicalJson, sha256 } from '../../src/shared/contracts/core.js';
import {
  type StageIsolatedEvaluationStage,
  type StageIsolatedEvaluationStageForensicResult,
  StageIsolatedEvaluationStageForensicResultSchema,
  type StageIsolatedEvaluationStagePack,
  StageIsolatedEvaluationStagePackSchema,
  type StageIsolatedEvaluationStagePublicResult,
  StageIsolatedEvaluationStagePublicResultSchema,
  type StageIsolatedFullReviewedPlanAuditCanonicalInput,
  StageIsolatedFullReviewedPlanAuditCanonicalInputSchema,
  type StageIsolatedToolInspection,
} from './stage-isolated.schema.js';
import {
  type StageIsolatedExpectedOutcomeRubric,
  validateStageIsolatedAdjudicationResponse,
} from './stage-isolated-adjudication-agent.contract.js';
import { adjudicateIsolatedStage } from './stage-isolated-adjudication-agent.js';
import { projectStageIsolatedProductResult } from './stage-isolated-projection.js';
import { stageIsolatedStructuredOutputRegistry } from './structured-output-registry.js';

type SupportedStage =
  | 'planning'
  | 'evidence-mapping'
  | 'source-posture'
  | 'investigation-grounding'
  | 'verification'
  | 'full-reviewed-plan-audit';
type UnsupportedStage = Exclude<StageIsolatedEvaluationStage, SupportedStage>;
export type StageIsolatedProductOutput =
  | PlanModelOutput
  | EvidenceMap
  | SourcePosture
  | Readonly<{
      investigation: Readonly<{
        seeds: readonly HypothesisSeed[];
        closures: readonly InvestigationObligationClosure[];
      }>;
      grounding: CandidateGroundingStageOutput;
    }>
  | Awaited<ReturnType<typeof runVerificationStage>>
  | AuditReport;

/** Stable local-library code: no provider is constructed or called for these stages. */
export const StageIsolatedUnsupportedStageErrorCode = 'stage-isolated-stage-unsupported' as const;

export class StageIsolatedUnsupportedStageError extends Error {
  public readonly code = StageIsolatedUnsupportedStageErrorCode;

  public constructor(stage: UnsupportedStage) {
    super(`Stage-isolated evaluation does not yet support the ${stage} stage.`);
    this.name = 'StageIsolatedUnsupportedStageError';
  }
}

/** Stable local-library code for an evaluator-owned input that does not match its sealed pack. */
export const StageIsolatedInputBindingErrorCode = 'stage-isolated-input-binding-invalid' as const;

export class StageIsolatedInputBindingError extends Error {
  public readonly code = StageIsolatedInputBindingErrorCode;

  public constructor() {
    super('Stage-isolated canonical input does not match its sealed evaluator pack.');
    this.name = 'StageIsolatedInputBindingError';
  }
}

/** Evaluator-only no-tools route. It is distinct from the product-stage route. */
export type StageIsolatedSemanticEvaluator = Readonly<{
  rubric: StageIsolatedExpectedOutcomeRubric;
  modelProvider: ModelProvider;
  providerIdentity: string;
  modelName: string;
  route: ModelRoute;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  cacheRoutingEnabled: boolean;
  evaluatorFailureDiagnosticSink?: EvaluatorFailureDiagnosticSink;
}>;

type StageIsolatedCanonicalInputBase = Readonly<{
  targetFingerprint: string;
  contextDigest: string;
}>;

export type StageIsolatedPlanningCanonicalInput = StageIsolatedCanonicalInputBase &
  Readonly<{
    stage: 'planning';
    request: PlanModelRequest;
  }>;

export type StageIsolatedEvidenceMappingCanonicalInput = StageIsolatedCanonicalInputBase &
  Readonly<{
    stage: 'evidence-mapping';
    request: EvidenceMapRequest;
    context: Parameters<typeof runEvidenceMapStage>[0]['context'];
  }>;

export type StageIsolatedSourcePostureCanonicalInput = StageIsolatedCanonicalInputBase &
  Readonly<{
    stage: 'source-posture';
    request: SourcePostureRequest;
    context: Parameters<typeof runSourcePostureStage>[0]['context'];
  }>;

/**
 * The live investigator and grounder deliberately receive separately sealed
 * predecessors. Grounding never consumes the live investigator output: its
 * seed binding is evaluator-owned so either stage can be measured in isolation.
 */
export type StageIsolatedInvestigationGroundingCanonicalInput = StageIsolatedCanonicalInputBase &
  Readonly<{
    stage: 'investigation-grounding';
    investigationRequest: AuditInvestigationRequest;
    investigationContext: Parameters<typeof runInvestigationStage>[0]['context'];
    groundingRequest: CandidateGroundingRequest;
    groundingSources: readonly SourceDocument[];
    groundingContext: Parameters<typeof runCandidateGroundingStage>[0]['context'];
  }>;

/**
 * Verification receives an evaluator-owned canonical candidate and its exact
 * map/posture predecessors. The source snapshot binds the fixture but never
 * enters the verifier prompt; source access remains through the target jail.
 */
export type StageIsolatedVerificationCanonicalInput = StageIsolatedCanonicalInputBase &
  Readonly<{
    stage: 'verification';
    request: AuditVerificationRequest;
    sources: readonly SourceDocument[];
    context: Parameters<typeof runVerificationStage>[0]['context'];
  }>;

export type StageIsolatedCanonicalInput =
  | StageIsolatedPlanningCanonicalInput
  | StageIsolatedEvidenceMappingCanonicalInput
  | StageIsolatedSourcePostureCanonicalInput
  | StageIsolatedInvestigationGroundingCanonicalInput
  | StageIsolatedVerificationCanonicalInput
  | StageIsolatedFullReviewedPlanAuditCanonicalInput;

/** Provider-neutral dependencies shared by each isolated stage dispatch. */
export type StageIsolatedEvaluationRunInput = Readonly<{
  pack: StageIsolatedEvaluationStagePack;
  modelProvider: ModelProvider;
  /** Explicit provider identity prevents a sealed pack being dispatched to another provider route. */
  providerIdentity: string;
  /** A jail is required even for evaluator-owned in-memory canonical inputs. */
  filesystem: JailedReadOnlyFilesystem;
  sessionId: string;
  modelName: string;
  harnessExecution: HarnessExecutionConfiguration;
  modelCacheRoutingKey: string | undefined;
  modelPricing: ModelPricing;
  modelCostCeiling?: ModelCostCeiling;
  cacheRoutingEnabled: boolean;
  canonicalInput: StageIsolatedCanonicalInput;
  semanticEvaluator: StageIsolatedSemanticEvaluator;
}>;

/** Strictly parses evaluator-owned product inputs and derives their only binding fingerprint. */
export function buildStageIsolatedCanonicalInput(input: StageIsolatedCanonicalInput): Readonly<{
  input: StageIsolatedCanonicalInput;
  fingerprint: string;
}> {
  try {
    switch (input.stage) {
      case 'planning': {
        const request = PlanModelRequestSchema.parse(input.request);
        return canonicalInputResult({ ...input, request });
      }
      case 'evidence-mapping': {
        const request = EvidenceMapRequestSchema.parse(input.request);
        const context = ContextDocumentSchema.array().parse(input.context);
        return canonicalInputResult({ ...input, request, context });
      }
      case 'source-posture': {
        const request = SourcePostureRequestSchema.parse(input.request);
        const context = ContextDocumentSchema.array().parse(input.context);
        return canonicalInputResult({ ...input, request, context });
      }
      case 'investigation-grounding': {
        const predecessors = validateInvestigationGroundingPredecessors(input);
        return canonicalInputResult({ ...input, ...predecessors });
      }
      case 'verification': {
        const request = AuditVerificationRequestSchema.parse(input.request);
        const sources = SourceDocumentSchema.array().parse(input.sources);
        const context = ContextDocumentSchema.array().parse(input.context);
        assertVerificationBinding(request, sources);
        return canonicalInputResult({ ...input, request, sources, context });
      }
      case 'full-reviewed-plan-audit': {
        const reviewedPlanAudit =
          StageIsolatedFullReviewedPlanAuditCanonicalInputSchema.parse(input);
        assertPlanIsSealed(reviewedPlanAudit.plan);
        return canonicalInputResult(reviewedPlanAudit);
      }
    }
    throw new StageIsolatedInputBindingError();
  } catch {
    throw new StageIsolatedInputBindingError();
  }
}

function canonicalInputResult(input: StageIsolatedCanonicalInput): Readonly<{
  input: StageIsolatedCanonicalInput;
  fingerprint: string;
}> {
  const payload =
    input.stage === 'evidence-mapping' || input.stage === 'source-posture'
      ? { ...input, context: [...input.context] }
      : input.stage === 'investigation-grounding'
        ? {
            ...input,
            investigationContext: [...input.investigationContext],
            groundingSources: [...input.groundingSources],
            groundingContext: [...input.groundingContext],
          }
        : input.stage === 'verification'
          ? { ...input, sources: [...input.sources], context: [...input.context] }
          : input;
  return { input, fingerprint: sha256(canonicalJson(payload)) };
}

/**
 * Dispatches one evaluator-owned stage pack through the real production
 * wrapper. Expectations are bound and retained outside product model input.
 */
export async function runStageIsolatedEvaluation(
  input: StageIsolatedEvaluationRunInput,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  assertLiveHarnessStructuredOutputCompatibility({
    provider: input.providerIdentity,
    registry: auditWorkflowStructuredOutputRegistry,
  });
  assertLiveHarnessStructuredOutputCompatibility({
    provider: input.semanticEvaluator.providerIdentity,
    registry: stageIsolatedStructuredOutputRegistry,
  });
  const pack = StageIsolatedEvaluationStagePackSchema.parse(input.pack);
  const canonical = buildStageIsolatedCanonicalInput(input.canonicalInput);
  assertBindings(input, pack, canonical);

  switch (pack.stage) {
    case 'planning':
      return runPlanning(input, pack, canonical.input);
    case 'evidence-mapping':
      return runEvidenceMapping(input, pack, canonical.input);
    case 'source-posture':
      return runSourcePosture(input, pack, canonical.input);
    case 'investigation-grounding':
      return runInvestigationGrounding(input, pack, canonical.input);
    case 'verification':
      return runVerification(input, pack, canonical.input);
    case 'full-reviewed-plan-audit':
      return runFullReviewedPlanAudit(input, pack, canonical.input);
  }
}

async function runPlanning(
  input: StageIsolatedEvaluationRunInput,
  pack: StageIsolatedEvaluationStagePack,
  canonicalInput: StageIsolatedCanonicalInput,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  if (canonicalInput.stage !== 'planning') throw new StageIsolatedInputBindingError();
  if (
    canonicalInput.request.targetFingerprint !== pack.targetFingerprint ||
    canonicalInput.request.contextDigest !== pack.contextDigest
  ) {
    throw new StageIsolatedInputBindingError();
  }
  try {
    const result = await runPlanningStage({
      modelProvider: input.modelProvider,
      filesystem: input.filesystem,
      request: canonicalInput.request,
      sessionId: input.sessionId,
      modelName: input.modelName,
      harnessExecution: input.harnessExecution,
      modelCacheRoutingKey: input.modelCacheRoutingKey,
      modelPricing: input.modelPricing,
      ...(input.modelCostCeiling === undefined ? {} : { modelCostCeiling: input.modelCostCeiling }),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    if (result.status === 'failed') {
      return failedResult({
        pack,
        sourcePaths: canonicalInput.request.sourcePaths,
        observation: result.modelObservation,
        errorCode: result.errorCode,
      });
    }
    return completedResult({
      pack,
      sourcePaths: canonicalInput.request.sourcePaths,
      observation: result.modelObservation,
      output: result.output,
      semanticEvaluator: input.semanticEvaluator,
      modelPricing: input.modelPricing,
    });
  } catch (error) {
    return failedResult({
      pack,
      sourcePaths: canonicalInput.request.sourcePaths,
      errorCode: stageErrorCode(error),
    });
  }
}

async function runEvidenceMapping(
  input: StageIsolatedEvaluationRunInput,
  pack: StageIsolatedEvaluationStagePack,
  canonicalInput: StageIsolatedCanonicalInput,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  if (canonicalInput.stage !== 'evidence-mapping') throw new StageIsolatedInputBindingError();
  try {
    const result = await runEvidenceMapStage({
      modelProvider: input.modelProvider,
      filesystem: input.filesystem,
      sources: await sourceDocumentsFor(
        input.filesystem,
        canonicalInput.request.availableSourcePaths,
      ),
      request: canonicalInput.request,
      context: canonicalInput.context,
      sessionId: input.sessionId,
      modelName: input.modelName,
      harnessExecution: input.harnessExecution,
      modelCacheRoutingKey: input.modelCacheRoutingKey,
      modelPricing: input.modelPricing,
      ...(input.modelCostCeiling === undefined ? {} : { modelCostCeiling: input.modelCostCeiling }),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    if (result.status === 'failed') {
      return failedResult({
        pack,
        sourcePaths: canonicalInput.request.availableSourcePaths,
        observation: result.modelObservation,
        errorCode: result.errorCode,
      });
    }
    return completedResult({
      pack,
      sourcePaths: canonicalInput.request.availableSourcePaths,
      observation: result.modelObservation,
      output: result.output,
      semanticEvaluator: input.semanticEvaluator,
      modelPricing: input.modelPricing,
    });
  } catch (error) {
    return failedResult({
      pack,
      sourcePaths: canonicalInput.request.availableSourcePaths,
      errorCode: stageErrorCode(error),
    });
  }
}

/** Builds the evaluator-only immutable source projection required for map canonicalization. */
async function sourceDocumentsFor(
  filesystem: JailedReadOnlyFilesystem,
  paths: readonly string[],
): Promise<readonly SourceDocument[]> {
  return Promise.all(
    paths.map(async (path) => {
      const source = await filesystem.readFile({
        root: 'target',
        relativePath: path,
        startLine: 1,
      });
      return SourceDocumentSchema.parse({
        path: source.relativePath,
        content: source.text,
        languageHint: null,
      });
    }),
  );
}

async function runSourcePosture(
  input: StageIsolatedEvaluationRunInput,
  pack: StageIsolatedEvaluationStagePack,
  canonicalInput: StageIsolatedCanonicalInput,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  if (canonicalInput.stage !== 'source-posture') throw new StageIsolatedInputBindingError();
  try {
    const result = await runSourcePostureStage({
      modelProvider: input.modelProvider,
      filesystem: input.filesystem,
      request: canonicalInput.request,
      context: canonicalInput.context,
      sessionId: input.sessionId,
      modelName: input.modelName,
      harnessExecution: input.harnessExecution,
      modelCacheRoutingKey: input.modelCacheRoutingKey,
      modelPricing: input.modelPricing,
      ...(input.modelCostCeiling === undefined ? {} : { modelCostCeiling: input.modelCostCeiling }),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    if (result.status === 'failed') {
      return failedResult({
        pack,
        sourcePaths: canonicalInput.request.availableSourcePaths,
        observation: result.modelObservation,
        errorCode: result.errorCode,
      });
    }
    return completedResult({
      pack,
      sourcePaths: canonicalInput.request.availableSourcePaths,
      observation: result.modelObservation,
      output: result.output,
      semanticEvaluator: input.semanticEvaluator,
      modelPricing: input.modelPricing,
    });
  } catch (error) {
    return failedResult({
      pack,
      sourcePaths: canonicalInput.request.availableSourcePaths,
      errorCode: stageErrorCode(error),
    });
  }
}

async function runInvestigationGrounding(
  input: StageIsolatedEvaluationRunInput,
  pack: StageIsolatedEvaluationStagePack,
  canonicalInput: StageIsolatedCanonicalInput,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  if (canonicalInput.stage !== 'investigation-grounding') {
    throw new StageIsolatedInputBindingError();
  }
  const predecessors = validateInvestigationGroundingPredecessors(canonicalInput);

  const observations: ModelStageObservation[] = [];
  let investigation:
    | Readonly<{
        seeds: readonly HypothesisSeed[];
        closures: readonly InvestigationObligationClosure[];
      }>
    | undefined;
  let grounding: CandidateGroundingStageOutput | undefined;
  let errorCode: string | undefined;

  try {
    const result = await runInvestigationStage({
      modelProvider: input.modelProvider,
      filesystem: input.filesystem,
      request: predecessors.investigationRequest,
      context: predecessors.investigationContext,
      sessionId: input.sessionId,
      modelName: input.modelName,
      harnessExecution: input.harnessExecution,
      modelCacheRoutingKey: input.modelCacheRoutingKey,
      modelPricing: input.modelPricing,
      ...(input.modelCostCeiling === undefined ? {} : { modelCostCeiling: input.modelCostCeiling }),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    observations.push(result.modelObservation);
    if (result.modelObservation.status === 'completed') {
      investigation = { seeds: result.seeds, closures: result.closures };
    } else {
      errorCode = result.modelObservation.errorCode ?? 'provider-failure';
    }
  } catch (error) {
    errorCode = stageErrorCode(error);
  }

  if (errorCode !== undefined || investigation === undefined) {
    return failedResult({
      pack,
      sourcePaths: predecessors.investigationRequest.availableSourcePaths,
      observations,
      errorCode: errorCode ?? 'stage-isolated-wrapper-failed',
      modelPricing: input.modelPricing,
    });
  }

  try {
    const result = await runCandidateGroundingStage({
      modelProvider: input.modelProvider,
      filesystem: input.filesystem,
      request: predecessors.groundingRequest,
      sources: predecessors.groundingSources,
      context: predecessors.groundingContext,
      sessionId: input.sessionId,
      modelName: input.modelName,
      harnessExecution: input.harnessExecution,
      modelCacheRoutingKey: input.modelCacheRoutingKey,
      modelPricing: input.modelPricing,
      ...(input.modelCostCeiling === undefined ? {} : { modelCostCeiling: input.modelCostCeiling }),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    observations.push(result.modelObservation);
    if (result.status === 'completed') {
      grounding = result.output;
    } else if (errorCode === undefined) {
      errorCode = result.errorCode;
    }
  } catch (error) {
    if (errorCode === undefined) errorCode = stageErrorCode(error);
  }

  if (errorCode !== undefined || investigation === undefined || grounding === undefined) {
    return failedResult({
      pack,
      sourcePaths: predecessors.investigationRequest.availableSourcePaths,
      observations,
      errorCode: errorCode ?? 'stage-isolated-wrapper-failed',
      modelPricing: input.modelPricing,
    });
  }
  return completedResult({
    pack,
    sourcePaths: predecessors.investigationRequest.availableSourcePaths,
    observations,
    output: { investigation, grounding },
    semanticEvaluator: input.semanticEvaluator,
    modelPricing: input.modelPricing,
  });
}

async function runVerification(
  input: StageIsolatedEvaluationRunInput,
  pack: StageIsolatedEvaluationStagePack,
  canonicalInput: StageIsolatedCanonicalInput,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  if (canonicalInput.stage !== 'verification') throw new StageIsolatedInputBindingError();
  let request: AuditVerificationRequest;
  let sources: readonly SourceDocument[];
  let context: Parameters<typeof runVerificationStage>[0]['context'];
  try {
    request = AuditVerificationRequestSchema.parse(canonicalInput.request);
    sources = SourceDocumentSchema.array().parse(canonicalInput.sources);
    context = ContextDocumentSchema.array().parse(canonicalInput.context);
    assertVerificationBinding(request, sources);
  } catch {
    throw new StageIsolatedInputBindingError();
  }
  try {
    const result = await runVerificationStage({
      modelProvider: input.modelProvider,
      filesystem: input.filesystem,
      request,
      context,
      sessionId: input.sessionId,
      modelName: input.modelName,
      harnessExecution: input.harnessExecution,
      modelCacheRoutingKey: input.modelCacheRoutingKey,
      modelPricing: input.modelPricing,
      ...(input.modelCostCeiling === undefined ? {} : { modelCostCeiling: input.modelCostCeiling }),
      cacheRoutingEnabled: input.cacheRoutingEnabled,
    });
    if (result.modelObservation.status === 'failed') {
      return failedResult({
        pack,
        sourcePaths: request.availableSourcePaths,
        observation: result.modelObservation,
        errorCode: result.modelObservation.errorCode ?? 'provider-failure',
        modelPricing: input.modelPricing,
      });
    }
    return completedResult({
      pack,
      sourcePaths: request.availableSourcePaths,
      observation: result.modelObservation,
      output: result,
      semanticEvaluator: input.semanticEvaluator,
      modelPricing: input.modelPricing,
    });
  } catch (error) {
    return failedResult({
      pack,
      sourcePaths: request.availableSourcePaths,
      errorCode: stageErrorCode(error),
      modelPricing: input.modelPricing,
    });
  }
}

/**
 * Measures the actual reviewed-plan audit entrypoint. The audit service owns
 * inventory capture, sealed-plan validation, scoped tools, recovery, and all
 * stage sequencing; this evaluator wrapper only seals its input and projects
 * the service's source-free accounting after work has finished.
 */
async function runFullReviewedPlanAudit(
  input: StageIsolatedEvaluationRunInput,
  pack: StageIsolatedEvaluationStagePack,
  canonicalInput: StageIsolatedCanonicalInput,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  if (canonicalInput.stage !== 'full-reviewed-plan-audit') {
    throw new StageIsolatedInputBindingError();
  }
  const canonical = StageIsolatedFullReviewedPlanAuditCanonicalInputSchema.parse(canonicalInput);
  const configuredCostCeiling = input.modelCostCeiling?.state().configuredUsd;
  const service = createReviewService(input.modelProvider, input.modelName, {
    maxParallelVectors: 1,
    harnessExecution: input.harnessExecution,
    modelPricing: input.modelPricing,
    ...(input.modelCacheRoutingKey === undefined
      ? {}
      : { modelCacheRoutingKey: input.modelCacheRoutingKey }),
    ...(configuredCostCeiling === null || configuredCostCeiling === undefined
      ? {}
      : { maxEstimatedCostUsd: configuredCostCeiling }),
  });
  try {
    const audited = await service.audit({
      targetRoot: canonical.targetRoot,
      ...(canonical.contextRoot === null ? {} : { contextRoot: canonical.contextRoot }),
      targetDisplayName: canonical.targetDisplayName,
      plan: canonical.plan,
      runId: canonical.runId,
      generatedAt: canonical.generatedAt,
      sessionId: canonical.sessionId,
    });
    const observations = modelStagesForAudit(audited.report);
    const inspection = fullAuditToolInspection(audited.report, observations);
    const terminal = fullAuditTerminalState(audited.report);
    if (terminal.status === 'completed') {
      return completedResult({
        pack,
        sourcePaths: [],
        inspection,
        observations,
        output: audited.report,
        semanticEvaluator: input.semanticEvaluator,
        modelPricing: input.modelPricing,
      });
    }
    return failedResult({
      pack,
      sourcePaths: [],
      inspection,
      observations,
      errorCode: terminal.errorCode ?? 'coverage-incomplete',
      status: terminal.status,
      modelPricing: input.modelPricing,
    });
  } catch (error) {
    return failedResult({
      pack,
      sourcePaths: [],
      errorCode: stageErrorCode(error),
      modelPricing: input.modelPricing,
    });
  }
}

function fullAuditToolInspection(
  report: AuditReport,
  observations: readonly ModelStageObservation[],
): StageIsolatedToolInspection {
  const usage = combineToolUsage(observations.map((observation) => observation.toolUsage));
  const scopedManifestEntryCount = report.coverage.reduce(
    (total, coverage) => total + coverage.matchedSourcePaths,
    0,
  );
  return {
    scopedManifestEntryCount,
    inspectionRequired: scopedManifestEntryCount > 0,
    inspectedWithReadOrGrep:
      usage.successfulReadFileCallCount > 0 || usage.successfulGrepFilesCallCount > 0,
    usage,
  };
}

function fullAuditTerminalState(report: AuditReport): Readonly<{
  status: 'completed' | 'incomplete' | 'failed' | 'cancelled';
  errorCode: string | null;
}> {
  const terminalCoverage = report.coverage.filter((coverage) => coverage.errorCode !== null);
  const firstError = terminalCoverage[0]?.errorCode;
  if (report.coverage.some((coverage) => coverage.outcome === 'cancelled')) {
    return { status: 'cancelled', errorCode: firstError ?? 'provider-cancelled' };
  }
  if (report.coverage.some((coverage) => coverage.outcome === 'failed')) {
    return { status: 'failed', errorCode: firstError ?? 'provider-failure' };
  }
  if (report.coverage.some((coverage) => coverage.outcome === 'incomplete')) {
    return { status: 'incomplete', errorCode: firstError ?? 'coverage-incomplete' };
  }
  return { status: 'completed', errorCode: null };
}

function assertVerificationBinding(
  request: AuditVerificationRequest,
  sources: readonly SourceDocument[],
): void {
  if (
    request.hypothesis.vectorId !== request.vector.vectorId ||
    !samePathSet(
      request.availableSourcePaths,
      sources.map((source) => source.path),
    ) ||
    request.hypothesis.evidenceMapFactIds.some(
      (factId) => !request.evidenceMap.facts.some((fact) => fact.factId === factId),
    ) ||
    request.hypothesis.sourcePostureAssessmentIds.some(
      (assessmentId) =>
        !request.sourcePosture.assessments.some(
          (assessment) => assessment.assessmentId === assessmentId,
        ),
    )
  ) {
    throw new StageIsolatedInputBindingError();
  }
}

function validateInvestigationGroundingPredecessors(
  input: StageIsolatedInvestigationGroundingCanonicalInput,
): Readonly<{
  investigationRequest: AuditInvestigationRequest;
  investigationContext: Parameters<typeof runInvestigationStage>[0]['context'];
  groundingRequest: CandidateGroundingRequest;
  groundingSources: readonly SourceDocument[];
  groundingContext: Parameters<typeof runCandidateGroundingStage>[0]['context'];
}> {
  let investigation: AuditInvestigationRequest;
  let investigationContext: Parameters<typeof runInvestigationStage>[0]['context'];
  let grounding: CandidateGroundingRequest;
  let groundingSources: readonly SourceDocument[];
  let groundingContext: Parameters<typeof runCandidateGroundingStage>[0]['context'];
  try {
    investigation = AuditInvestigationRequestSchema.parse(input.investigationRequest);
    investigationContext = ContextDocumentSchema.array().parse(input.investigationContext);
    grounding = CandidateGroundingRequestSchema.parse(input.groundingRequest);
    groundingSources = SourceDocumentSchema.array().parse(input.groundingSources);
    groundingContext = ContextDocumentSchema.array().parse(input.groundingContext);
  } catch {
    throw new StageIsolatedInputBindingError();
  }
  if (
    JSON.stringify(investigation.vector) !== JSON.stringify(grounding.vector) ||
    JSON.stringify(investigation.evidenceMap) !== JSON.stringify(grounding.evidenceMap) ||
    JSON.stringify(investigation.sourcePosture) !== JSON.stringify(grounding.sourcePosture) ||
    !samePathSet(investigation.availableSourcePaths, grounding.availableSourcePaths) ||
    !samePathSet(
      grounding.availableSourcePaths,
      input.groundingSources.map((source) => source.path),
    )
  ) {
    throw new StageIsolatedInputBindingError();
  }
  return {
    investigationRequest: investigation,
    investigationContext,
    groundingRequest: grounding,
    groundingSources,
    groundingContext,
  };
}

function samePathSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((path) => right.includes(path))
  );
}

function assertBindings(
  input: StageIsolatedEvaluationRunInput,
  pack: StageIsolatedEvaluationStagePack,
  canonical: Readonly<{ input: StageIsolatedCanonicalInput; fingerprint: string }>,
): void {
  if (
    pack.route !== 'primary' ||
    pack.provider !== input.providerIdentity ||
    pack.model !== input.modelName ||
    pack.stage !== canonical.input.stage ||
    pack.productInput.fingerprint !== canonical.fingerprint ||
    pack.targetFingerprint !== canonical.input.targetFingerprint ||
    pack.contextDigest !== canonical.input.contextDigest ||
    pack.expectedOutcome.privateReferenceId !== input.semanticEvaluator.rubric.rubricId ||
    pack.expectedOutcome.fingerprint !== input.semanticEvaluator.rubric.rubricFingerprint
  ) {
    throw new StageIsolatedInputBindingError();
  }
}

async function completedResult(
  input: Readonly<{
    pack: StageIsolatedEvaluationStagePack;
    sourcePaths: readonly string[];
    observation?: ModelStageObservation;
    observations?: readonly ModelStageObservation[];
    inspection?: StageIsolatedToolInspection;
    output: StageIsolatedProductOutput;
    semanticEvaluator: StageIsolatedSemanticEvaluator;
    modelPricing: ModelPricing;
  }>,
): Promise<StageIsolatedEvaluationStageForensicResult> {
  try {
    const observations = resolvedObservations(input);
    const productProjection = projectStageIsolatedProductResult({
      stage: input.pack.stage,
      stageResultId: input.pack.productInput.referenceId,
      semanticClaims: semanticClaimsForProductOutput(input.output),
    });
    assertSemanticEvaluatorBinding(input.pack, input.semanticEvaluator, productProjection);
    const adjudication = await adjudicateIsolatedStage({
      provider: input.semanticEvaluator.providerIdentity,
      modelProvider: input.semanticEvaluator.modelProvider,
      modelName: input.semanticEvaluator.modelName,
      execution: input.semanticEvaluator.harnessExecution,
      sessionId: `stage-semantic-${input.pack.packId}`,
      request: {
        expectedOutcomeRubric: input.semanticEvaluator.rubric,
        productStageOutput: productProjection,
      },
      route: input.semanticEvaluator.route,
      stageId: input.pack.packId,
      modelPricing: input.semanticEvaluator.modelPricing,
      cacheRoutingEnabled: input.semanticEvaluator.cacheRoutingEnabled,
      scopeFingerprint: productProjection.stageResultFingerprint,
      ...(input.semanticEvaluator.evaluatorFailureDiagnosticSink === undefined
        ? {}
        : {
            evaluatorFailureDiagnosticSink: input.semanticEvaluator.evaluatorFailureDiagnosticSink,
          }),
      ...(input.semanticEvaluator.modelCacheRoutingKey === undefined
        ? {}
        : { modelCacheRoutingKey: input.semanticEvaluator.modelCacheRoutingKey }),
    });
    if (adjudication.status !== 'completed') {
      return semanticIncompleteResult({
        pack: input.pack,
        sourcePaths: input.sourcePaths,
        observations,
        inspection: input.inspection,
        productProjectionFingerprint: productProjection.stageResultFingerprint,
        rubricFingerprint: input.semanticEvaluator.rubric.rubricFingerprint,
        evaluatorObservation: adjudication.modelObservation,
        errorCode: adjudication.errorCode,
        modelPricing: input.modelPricing,
      });
    }
    const response = validateStageIsolatedAdjudicationResponse({
      request: {
        expectedOutcomeRubric: input.semanticEvaluator.rubric,
        productStageOutput: productProjection,
      },
      response: adjudication.output,
    });
    const matched = response.expectedOutcomes.filter((entry) => entry.disposition === 'matched');
    const missing = response.expectedOutcomes.filter((entry) => entry.disposition === 'missing');
    const notApplicable = response.expectedOutcomes.filter(
      (entry) => entry.disposition === 'not-applicable',
    );
    return StageIsolatedEvaluationStageForensicResultSchema.parse({
      schemaVersion: 3,
      pack: input.pack,
      completion: { status: 'completed', errorCode: null },
      validation: {
        input: { status: 'passed', errorCodes: [] },
        output: { status: 'passed', errorCodes: [] },
      },
      toolInspection: input.inspection ?? toolInspection(input.sourcePaths, observations),
      telemetry: telemetry(observations, input.modelPricing),
      modelObservations: observations,
      productProjectionFingerprint: productProjection.stageResultFingerprint,
      rubricFingerprint: input.semanticEvaluator.rubric.rubricFingerprint,
      evaluatorObservation: adjudication.modelObservation,
      semanticOutcome: {
        status: matched.length > 0 ? 'matched-expected-outcome' : 'missing-expected-outcome',
        matchedExpectedOutcomeIds: matched.map((entry) => entry.expectedOutcomeId),
        missingExpectedOutcomeIds: missing.map((entry) => entry.expectedOutcomeId),
        notApplicableExpectedOutcomeIds: notApplicable.map((entry) => entry.expectedOutcomeId),
        unexpectedOutcomeIds: response.unexpectedProductOutputIds,
      },
      evidenceRoleBundles: matched.map((entry) => ({
        expectedOutcomeId: entry.expectedOutcomeId,
        roles: entry.roleLocalizations.map((role) => ({
          role: role.role,
          localizationIds: role.localizationIds,
        })),
      })),
    });
  } catch {
    return failedResult({
      pack: input.pack,
      sourcePaths: input.sourcePaths,
      observations:
        input.observations ?? (input.observation === undefined ? [] : [input.observation]),
      errorCode: 'stage-isolated-semantic-evaluation-failed',
      modelPricing: input.modelPricing,
    });
  }
}

function failedResult(
  input: Readonly<{
    pack: StageIsolatedEvaluationStagePack;
    sourcePaths: readonly string[];
    observation?: ModelStageObservation;
    observations?: readonly ModelStageObservation[];
    inspection?: StageIsolatedToolInspection;
    errorCode: string;
    status?: 'incomplete' | 'failed' | 'cancelled';
    modelPricing?: ModelPricing;
  }>,
): StageIsolatedEvaluationStageForensicResult {
  const observations =
    input.observations ?? (input.observation === undefined ? [] : [input.observation]);
  const toolUsage =
    observations.length === 0
      ? emptyToolUsage()
      : combineToolUsage(observations.map((observation) => observation.toolUsage));
  const status =
    input.errorCode === 'provider-cancelled' ? 'cancelled' : (input.status ?? 'failed');
  return StageIsolatedEvaluationStageForensicResultSchema.parse({
    schemaVersion: 3,
    pack: input.pack,
    completion: { status, errorCode: input.errorCode },
    validation: {
      input: { status: 'passed', errorCodes: [] },
      output: { status: 'failed', errorCodes: [input.errorCode] },
    },
    toolInspection: input.inspection ?? {
      scopedManifestEntryCount: input.sourcePaths.length,
      inspectionRequired: input.sourcePaths.length > 0,
      inspectedWithReadOrGrep:
        toolUsage.successfulReadFileCallCount > 0 || toolUsage.successfulGrepFilesCallCount > 0,
      usage: toolUsage,
    },
    telemetry:
      observations.length === 0
        ? {
            latencyMs: 0,
            usage: {
              modelCallCount: 0,
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              reasoningTokens: 0,
            },
            cost: { totalTokens: 0, estimatedCostUsd: null, source: 'unavailable' },
            trace: [],
          }
        : telemetry(observations, input.modelPricing ?? {}),
    modelObservations: observations,
    productProjectionFingerprint: null,
    rubricFingerprint: input.pack.expectedOutcome.fingerprint,
    evaluatorObservation: null,
    semanticOutcome: {
      status: 'inconclusive',
      matchedExpectedOutcomeIds: [],
      missingExpectedOutcomeIds: [],
      notApplicableExpectedOutcomeIds: [],
      unexpectedOutcomeIds: [],
    },
    evidenceRoleBundles: [],
  });
}

function semanticIncompleteResult(
  input: Readonly<{
    pack: StageIsolatedEvaluationStagePack;
    sourcePaths: readonly string[];
    observations: readonly ModelStageObservation[];
    inspection: StageIsolatedToolInspection | undefined;
    productProjectionFingerprint: string;
    rubricFingerprint: string;
    evaluatorObservation: ModelStageObservation;
    errorCode: string;
    modelPricing: ModelPricing;
  }>,
): StageIsolatedEvaluationStageForensicResult {
  return StageIsolatedEvaluationStageForensicResultSchema.parse({
    schemaVersion: 3,
    pack: input.pack,
    completion: { status: 'completed', errorCode: null },
    validation: {
      input: { status: 'passed', errorCodes: [] },
      output: { status: 'passed', errorCodes: [] },
    },
    toolInspection: input.inspection ?? toolInspection(input.sourcePaths, input.observations),
    telemetry: telemetry(input.observations, input.modelPricing),
    modelObservations: input.observations,
    productProjectionFingerprint: input.productProjectionFingerprint,
    rubricFingerprint: input.rubricFingerprint,
    evaluatorObservation: input.evaluatorObservation,
    semanticOutcome: {
      status: 'inconclusive',
      matchedExpectedOutcomeIds: [],
      missingExpectedOutcomeIds: [],
      notApplicableExpectedOutcomeIds: [],
      unexpectedOutcomeIds: [],
    },
    evidenceRoleBundles: [],
  });
}

function assertSemanticEvaluatorBinding(
  pack: StageIsolatedEvaluationStagePack,
  evaluator: StageIsolatedSemanticEvaluator,
  projection: Readonly<{ stage: StageIsolatedEvaluationStage; stageResultFingerprint: string }>,
): void {
  if (
    evaluator.rubric.rubricId !== pack.expectedOutcome.privateReferenceId ||
    evaluator.rubric.rubricFingerprint !== pack.expectedOutcome.fingerprint ||
    evaluator.rubric.stage !== pack.stage ||
    evaluator.providerIdentity !== pack.evaluatorProvider ||
    evaluator.modelName !== pack.evaluatorModel ||
    evaluator.route !== pack.evaluatorRoute ||
    projection.stage !== pack.stage
  ) {
    throw new StageIsolatedInputBindingError();
  }
}

function semanticClaimsForProductOutput(output: StageIsolatedProductOutput): readonly Readonly<{
  claim: string;
  roles: readonly ('operation' | 'unsafe-condition')[];
}>[] {
  if ('vectors' in output) {
    return output.vectors.map((vector) => ({
      claim: [
        vector.title,
        vector.rationale,
        ...vector.reviewObligations.map((entry) => entry.riskStatement),
      ].join(' '),
      roles: [],
    }));
  }
  if ('facts' in output) {
    return output.facts.map((fact) => ({
      claim: `Validated neutral ${fact.role} map fact for approved obligations ${fact.planObligations
        .map((obligation) => obligation.obligationId)
        .sort((left, right) => left.localeCompare(right))
        .join(', ')}.`,
      roles: fact.role === 'operation' ? ['operation'] : [],
    }));
  }
  if ('assessments' in output) {
    return output.assessments.map((assessment) => ({
      claim: `${assessment.conclusion} assessment for approved obligation ${assessment.obligationId}.`,
      roles: [],
    }));
  }
  if ('investigation' in output) {
    return [
      ...output.investigation.seeds.map((seed) => ({ claim: seed.hypothesis, roles: [] as const })),
      ...output.grounding.groundings.map((grounding) => ({
        claim:
          grounding.disposition === 'grounded'
            ? `Canonical grounded hypothesis for vector ${grounding.hypothesis.vectorId}.`
            : `Grounding ${grounding.seedId} closed without a candidate.`,
        roles:
          grounding.disposition === 'grounded' ? (['operation', 'unsafe-condition'] as const) : [],
      })),
    ];
  }
  if ('decision' in output) {
    return [
      {
        claim: `Validated verifier result recorded reason code ${output.reasonCode}.`,
        roles:
          output.claimEvidenceBundles === null
            ? []
            : output.claimEvidenceBundles.map((bundle) => bundle.role),
      },
    ];
  }
  return output.coverage.map((coverage) => ({
    claim: `Validated audit coverage reached ${coverage.outcome}.`,
    roles: [],
  }));
}

function resolvedObservations(
  input: Readonly<{
    observation?: ModelStageObservation;
    observations?: readonly ModelStageObservation[];
  }>,
): readonly ModelStageObservation[] {
  const observations =
    input.observations ?? (input.observation === undefined ? [] : [input.observation]);
  if (observations.length === 0) throw new StageIsolatedInputBindingError();
  return observations;
}

function toolInspection(
  sourcePaths: readonly string[],
  observations: readonly ModelStageObservation[],
) {
  const usage = combineToolUsage(observations.map((observation) => observation.toolUsage));
  return {
    scopedManifestEntryCount: sourcePaths.length,
    inspectionRequired: sourcePaths.length > 0,
    inspectedWithReadOrGrep:
      usage.successfulReadFileCallCount > 0 || usage.successfulGrepFilesCallCount > 0,
    usage,
  };
}

function telemetry(observations: readonly ModelStageObservation[], modelPricing: ModelPricing) {
  const run = summarizeModelStages(observations, modelPricing);
  return {
    latencyMs: observations.reduce((total, observation) => total + observation.durationMs, 0),
    usage: run.usage,
    cost: run.cost,
    trace: mergeTraces(observations),
  };
}

function mergeTraces(observations: readonly ModelStageObservation[]) {
  if (observations.some((observation) => observation.trace.length === 0)) return [];
  let ordinal = 0;
  let requestOrdinal = 0;
  return observations.flatMap((observation) =>
    observation.trace.map((event) => {
      ordinal += 1;
      if (event.kind === 'model-response') {
        requestOrdinal += 1;
        return { ...event, ordinal, requestOrdinal };
      }
      return { ...event, ordinal };
    }),
  );
}

/** Deterministically removes evaluator-private IDs and source localization from a forensic result. */
export function projectStageIsolatedPublicResult(
  forensic: StageIsolatedEvaluationStageForensicResult,
): StageIsolatedEvaluationStagePublicResult {
  const result = StageIsolatedEvaluationStageForensicResultSchema.parse(forensic);
  const localization = result.evidenceRoleBundles;
  return StageIsolatedEvaluationStagePublicResultSchema.parse({
    schemaVersion: 3,
    pack: {
      schemaVersion: result.pack.schemaVersion,
      packId: result.pack.packId,
      stage: result.pack.stage,
      corpusPackId: result.pack.corpusPackId,
      corpusPackVersion: result.pack.corpusPackVersion,
      corpusManifestFingerprint: result.pack.corpusManifestFingerprint,
      caseId: result.pack.caseId,
      variant: result.pack.variant,
      repetition: result.pack.repetition,
      planProfile: result.pack.planProfile,
      corpusSourceDigest: result.pack.corpusSourceDigest,
      targetFingerprint: result.pack.targetFingerprint,
      contextDigest: result.pack.contextDigest,
      workflowProtocolFingerprint: result.pack.workflowProtocolFingerprint,
      stageProtocolFingerprint: result.pack.stageProtocolFingerprint,
      evaluatorProtocolFingerprint: result.pack.evaluatorProtocolFingerprint,
      provider: result.pack.provider,
      model: result.pack.model,
      route: result.pack.route,
      evaluatorProvider: result.pack.evaluatorProvider,
      evaluatorModel: result.pack.evaluatorModel,
      evaluatorRoute: result.pack.evaluatorRoute,
      expectedOutcomeCount: result.pack.expectedOutcome.expectedOutcomeCount,
    },
    completion: result.completion,
    validation: result.validation,
    toolInspection: result.toolInspection,
    telemetry: result.telemetry,
    modelObservations: result.modelObservations,
    evaluatorObservation: result.evaluatorObservation,
    semanticOutcome: {
      matchedExpectedOutcomeCount: result.semanticOutcome.matchedExpectedOutcomeIds.length,
      missingExpectedOutcomeCount: result.semanticOutcome.missingExpectedOutcomeIds.length,
      notApplicableExpectedOutcomeCount:
        result.semanticOutcome.notApplicableExpectedOutcomeIds.length,
      unexpectedOutcomeCount: result.semanticOutcome.unexpectedOutcomeIds.length,
    },
    localization: {
      matchedExpectedOutcomeWithRoleBundleCount: localization.length,
      roleBundleCount: localization.length,
      roleCount: localization.reduce((total, bundle) => total + bundle.roles.length, 0),
      locationCount: localization.reduce(
        (total, bundle) =>
          total +
          bundle.roles.reduce((roleTotal, role) => roleTotal + role.localizationIds.length, 0),
        0,
      ),
    },
  });
}
