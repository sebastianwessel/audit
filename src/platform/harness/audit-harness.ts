import { defineHarness, inMemorySandbox, type ModelProvider } from '@purista/harness';
import {
  AttackPlanSchema,
  createPlan,
  PlanModelInputSchema,
  PlanModelOutputSchema,
  PlanModelRequestSchema,
  planningAgentInstructions,
} from '../../features/attack-planning/index.js';
import {
  CandidateGroundingModelInputSchema,
  CandidateGroundingModelOutputSchema,
  candidateGroundingAgentInstructions,
} from '../../features/audit-execution/candidate-grounding/index.js';
import {
  CountercheckModelInputSchema,
  CountercheckModelOutputSchema,
  countercheckAgentInstructions,
} from '../../features/audit-execution/countercheck/index.js';
import {
  EvidenceMapModelInputSchema,
  EvidenceMapModelOutputSchema,
  EvidenceMapRepairModelInputSchema,
  EvidenceMapRepairModelOutputSchema,
  evidenceMapAgentInstructions,
  evidenceMapRepairAgentInstructions,
} from '../../features/audit-execution/evidence-map/index.js';
import {
  AuditModelOutputSchema,
  investigationAgentInstructions,
  VectorAuditModelInputSchema,
} from '../../features/audit-execution/investigation/index.js';
import {
  SourcePostureModelInputSchema,
  SourcePostureModelOutputSchema,
  sourcePostureAgentInstructions,
} from '../../features/audit-execution/source-posture/index.js';
import {
  VerificationModelInputSchema,
  VerificationModelOutputSchema,
  verificationAgentInstructions,
} from '../../features/audit-execution/verification/index.js';
import {
  DeveloperGuidanceModelInputSchema,
  DeveloperGuidanceModelOutputSchema,
  developerGuidanceAgentInstructions,
} from '../../features/developer-guidance/index.js';
import {
  RepoGrepToolInputSchema as GrepFilesInputSchema,
  RepoGrepToolOutputSchema as GrepFilesOutputSchema,
  RepoListToolInputSchema as ListFilesInputSchema,
  RepoListToolOutputSchema as ListFilesOutputSchema,
  RepoReadToolInputSchema as ReadFileInputSchema,
  RepoReadToolOutputSchema as ReadFileOutputSchema,
  ReviewRepositoryToolDescriptions,
  type ReviewRepositoryToolset,
  scopedInspectionRequirement,
} from '../../features/review-workflow/tools/index.js';
import {
  EffectivelyUnboundedHarnessAgentIterations,
  type HarnessExecutionConfiguration,
  HarnessExecutionConfigurationSchema,
} from '../../shared/contracts/harness-execution.js';

import { NoContentLogger } from './no-content-logger.js';
import {
  assertProviderStructuredOutputRegistryCompatibility,
  defineStructuredOutputContractRegistry,
  type StructuredOutputContractRegistry,
} from './structured-output-compatibility.js';

export {
  EffectivelyUnboundedHarnessAgentIterations,
  type HarnessExecutionConfiguration,
  HarnessExecutionConfigurationSchema,
  TimeoutMillisecondsOptionSchema,
  TimeoutMillisecondsSchema,
} from '../../shared/contracts/harness-execution.js';

export type ReviewToolset = ReviewRepositoryToolset;

/**
 * This is the complete product harness output set. Keep it next to the
 * `agent({ output })` declarations so a newly dispatchable workflow cannot
 * bypass provider transport validation.
 */
export const auditWorkflowStructuredOutputRegistry: StructuredOutputContractRegistry =
  defineStructuredOutputContractRegistry({
    registryId: 'audit-product-workflows',
    outputs: [
      { outputId: 'planning', schema: PlanModelOutputSchema },
      { outputId: 'investigation', schema: AuditModelOutputSchema },
      { outputId: 'evidence-map', schema: EvidenceMapModelOutputSchema },
      { outputId: 'evidence-map-repair', schema: EvidenceMapRepairModelOutputSchema },
      { outputId: 'source-posture', schema: SourcePostureModelOutputSchema },
      { outputId: 'verification', schema: VerificationModelOutputSchema },
      { outputId: 'countercheck', schema: CountercheckModelOutputSchema },
      { outputId: 'candidate-grounding', schema: CandidateGroundingModelOutputSchema },
      { outputId: 'developer-guidance', schema: DeveloperGuidanceModelOutputSchema },
    ],
  });

export const auditWorkflowStructuredOutputs = auditWorkflowStructuredOutputRegistry.outputs;

/**
 * The sole registry of model-output contracts that can reach a live harness.
 * A caller selects its exact dispatch groups; the platform still owns schema
 * serialization, profile validation, and compatibility identity.
 */
/** Validates an exact live output registry before a provider is constructed. */
export function assertLiveHarnessStructuredOutputCompatibility(input: {
  provider: string;
  registry: StructuredOutputContractRegistry;
}) {
  return assertProviderStructuredOutputRegistryCompatibility({
    provider: input.provider,
    registry: input.registry,
  });
}

/** The single product-workflow pre-dispatch compatibility gate. */
export function assertAuditWorkflowStructuredOutputCompatibility(provider: string) {
  return assertLiveHarnessStructuredOutputCompatibility({
    provider,
    registry: auditWorkflowStructuredOutputRegistry,
  });
}

/**
 * The harness owns transient provider retries, including Retry-After and
 * provider-neutral backoff. The application only repairs semantic output and
 * missing-inspection failures because those need new model guidance.
 */
export function harnessProviderRetry(
  modelRetry: HarnessExecutionConfiguration['modelRetry'],
): boolean {
  return modelRetry === 'default';
}

export function createAuditHarness(
  modelProvider: ModelProvider,
  toolset: ReviewToolset,
  modelName = 'audit-configured-model',
  modelCacheRoutingKey?: string,
) {
  const execution = HarnessExecutionConfigurationSchema.parse({});
  return createAuditHarnessWithExecution(
    modelProvider,
    toolset,
    modelName,
    execution,
    modelCacheRoutingKey,
  );
}

export function createAuditHarnessWithExecution(
  modelProvider: ModelProvider,
  toolset: ReviewToolset,
  modelName: string | undefined,
  execution: HarnessExecutionConfiguration,
  modelCacheRoutingKey?: string,
) {
  return defineHarness({ name: 'audit' })
    .logger(new NoContentLogger())
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .sandbox(inMemorySandbox())
    .defaults({
      // Source access is recovered from provider-signalled overflow. Harness
      // requires a finite integer, so use the shared effectively unbounded
      // transport value instead of its fixed default of 16.
      agentMaxIterations: EffectivelyUnboundedHarnessAgentIterations,
      maxParallelToolCalls: 2,
      runTimeoutMs: execution.runTimeoutMs,
      modelTimeoutMs: execution.modelTimeoutMs,
      // A complete approved source transaction cannot be cut off by a fixed
      // tool deadline.
      toolTimeoutMs: 0,
    })
    .models({
      reviewer: {
        provider: modelProvider,
        model: modelName ?? 'audit-configured-model',
        capabilities: ['object', 'tool_use'],
        retry: harnessProviderRetry(execution.modelRetry),
        ...(modelCacheRoutingKey === undefined
          ? {}
          : { defaults: { providerOptions: { prompt_cache_key: modelCacheRoutingKey } } }),
      },
    })
    .tools({
      repo_list: {
        description: ReviewRepositoryToolDescriptions.repo_list,
        input: ListFilesInputSchema,
        output: ListFilesOutputSchema,
        handler: async (context, input) => {
          context.signal.throwIfAborted();
          return toolset.listFiles(input);
        },
      },
      repo_read: {
        description: ReviewRepositoryToolDescriptions.repo_read,
        input: ReadFileInputSchema,
        output: ReadFileOutputSchema,
        handler: async (context, input) => {
          context.signal.throwIfAborted();
          return toolset.readFile(input);
        },
      },
      repo_grep: {
        description: ReviewRepositoryToolDescriptions.repo_grep,
        input: GrepFilesInputSchema,
        output: GrepFilesOutputSchema,
        handler: async (context, input) => {
          context.signal.throwIfAborted();
          return toolset.grepFiles(input);
        },
      },
    })
    .agents(({ agent }) => ({
      planner: agent({
        model: 'reviewer',
        input: PlanModelInputSchema,
        output: PlanModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: planningAgentInstructions,
      }),
      auditor: agent({
        model: 'reviewer',
        input: VectorAuditModelInputSchema,
        output: AuditModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: investigationAgentInstructions,
      }),
      evidenceMapper: agent({
        model: 'reviewer',
        input: EvidenceMapModelInputSchema,
        output: EvidenceMapModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: evidenceMapAgentInstructions,
      }),
      evidenceMapRepairer: agent({
        model: 'reviewer',
        input: EvidenceMapRepairModelInputSchema,
        output: EvidenceMapRepairModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: evidenceMapRepairAgentInstructions,
      }),
      sourcePostureAssessor: agent({
        model: 'reviewer',
        input: SourcePostureModelInputSchema,
        output: SourcePostureModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: sourcePostureAgentInstructions,
      }),
      verifier: agent({
        model: 'reviewer',
        input: VerificationModelInputSchema,
        output: VerificationModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: verificationAgentInstructions,
      }),
      counterchecker: agent({
        model: 'reviewer',
        input: CountercheckModelInputSchema,
        output: CountercheckModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: countercheckAgentInstructions,
      }),
      candidateGrounder: agent({
        model: 'reviewer',
        input: CandidateGroundingModelInputSchema,
        output: CandidateGroundingModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: candidateGroundingAgentInstructions,
      }),
      developerGuide: agent({
        model: 'reviewer',
        input: DeveloperGuidanceModelInputSchema,
        output: DeveloperGuidanceModelOutputSchema,
        builtinTools: false,
        tools: ['repo_list', 'repo_read', 'repo_grep'],
        instructions: developerGuidanceAgentInstructions,
      }),
    }))
    .workflows(({ workflow }) => ({
      create_plan: workflow({
        input: PlanModelRequestSchema,
        output: AttackPlanSchema,
        delegation: {
          agents: ['planner'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.plan.started');
          return context.metrics.duration('audit.plan.duration', undefined, async () => {
            const modelOutput = await context.agents.planner({
              ...context.input,
              inspectionRequirement: scopedInspectionRequirement(context.input.sourcePaths),
              retryGuidance: { kind: 'initial' },
            });
            const plan = createPlan({
              targetFingerprint: context.input.targetFingerprint,
              contextDigest: context.input.contextDigest,
              targetDisplayName: context.input.targetDisplayName,
              inventorySummary: context.input.inventorySummary,
              vectors: modelOutput.vectors,
              additionalObservations: modelOutput.additionalObservations,
              createdAt: context.input.createdAt,
            });
            context.metrics.counter('audit.plan.completed');
            return plan;
          });
        },
      }),
      review_vector: workflow({
        input: VectorAuditModelInputSchema,
        output: AuditModelOutputSchema,
        delegation: {
          agents: ['auditor'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.investigation.started', 1);
          return context.metrics.duration('audit.investigation.duration', undefined, async () => {
            const output = await context.agents.auditor(context.input);
            context.metrics.counter('audit.investigation.completed', 1);
            return output;
          });
        },
      }),
      map_vector_evidence: workflow({
        input: EvidenceMapModelInputSchema,
        output: EvidenceMapModelOutputSchema,
        delegation: {
          agents: ['evidenceMapper'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.evidence_mapping.started', 1);
          return context.metrics.duration(
            'audit.evidence_mapping.duration',
            undefined,
            async () => {
              const output = await context.agents.evidenceMapper(context.input);
              context.metrics.counter('audit.evidence_mapping.completed', 1);
              return output;
            },
          );
        },
      }),
      repair_vector_evidence: workflow({
        input: EvidenceMapRepairModelInputSchema,
        output: EvidenceMapRepairModelOutputSchema,
        delegation: {
          agents: ['evidenceMapRepairer'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.evidence_map_repair.started', 1);
          return context.metrics.duration(
            'audit.evidence_map_repair.duration',
            undefined,
            async () => {
              const output = await context.agents.evidenceMapRepairer(context.input);
              context.metrics.counter('audit.evidence_map_repair.completed', 1);
              return output;
            },
          );
        },
      }),
      assess_vector_source_posture: workflow({
        input: SourcePostureModelInputSchema,
        output: SourcePostureModelOutputSchema,
        delegation: {
          agents: ['sourcePostureAssessor'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.source_posture.started', 1);
          return context.metrics.duration('audit.source_posture.duration', undefined, async () => {
            const output = await context.agents.sourcePostureAssessor(context.input);
            context.metrics.counter('audit.source_posture.completed', 1);
            return output;
          });
        },
      }),
      verify_hypothesis: workflow({
        input: VerificationModelInputSchema,
        output: VerificationModelOutputSchema,
        delegation: {
          agents: ['verifier'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.verification.started');
          return context.metrics.duration('audit.verification.duration', undefined, async () => {
            const output = await context.agents.verifier(context.input);
            context.metrics.counter('audit.verification.completed');
            return output;
          });
        },
      }),
      countercheck_hypothesis: workflow({
        input: CountercheckModelInputSchema,
        output: CountercheckModelOutputSchema,
        delegation: {
          agents: ['counterchecker'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.countercheck.started');
          return context.metrics.duration('audit.countercheck.duration', undefined, async () => {
            const output = await context.agents.counterchecker(context.input);
            context.metrics.counter('audit.countercheck.completed');
            return output;
          });
        },
      }),
      ground_vector_candidates: workflow({
        input: CandidateGroundingModelInputSchema,
        output: CandidateGroundingModelOutputSchema,
        delegation: {
          agents: ['candidateGrounder'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.candidate_grounding.started');
          return context.metrics.duration(
            'audit.candidate_grounding.duration',
            undefined,
            async () => {
              const output = await context.agents.candidateGrounder(context.input);
              context.metrics.counter('audit.candidate_grounding.completed');
              return output;
            },
          );
        },
      }),
      create_developer_guidance: workflow({
        input: DeveloperGuidanceModelInputSchema,
        output: DeveloperGuidanceModelOutputSchema,
        delegation: {
          agents: ['developerGuide'],
          modelAliases: ['reviewer'],
          maxChildAgentCalls: 1,
          maxParallelChildAgentCalls: 1,
          maxDepth: 1,
        },
        handler: async (context) => {
          context.metrics.counter('audit.developer_guidance.started');
          return context.metrics.duration(
            'audit.developer_guidance.duration',
            undefined,
            async () => {
              const output = await context.agents.developerGuide(context.input);
              context.metrics.counter('audit.developer_guidance.completed');
              return output;
            },
          );
        },
      }),
    }))
    .build();
}
