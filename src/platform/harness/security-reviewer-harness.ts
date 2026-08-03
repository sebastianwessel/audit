import { defineHarness, inMemorySandbox, type ModelProvider } from '@purista/harness';
import { z } from 'zod';

import { createPlan } from '../../features/attack-planning/plan.js';
import { AttackPlanSchema } from '../../features/attack-planning/plan.schema.js';
import {
  CandidateGroundingModelInputSchema,
  CandidateGroundingModelOutputSchema,
} from '../../features/review-workflow/agents/candidate-grounding/contract.js';
import { candidateGroundingAgentInstructions } from '../../features/review-workflow/agents/candidate-grounding/instructions.js';
import {
  CountercheckModelInputSchema,
  CountercheckModelOutputSchema,
} from '../../features/review-workflow/agents/countercheck/contract.js';
import { countercheckAgentInstructions } from '../../features/review-workflow/agents/countercheck/instructions.js';
import {
  EvidenceMapModelInputSchema,
  EvidenceMapModelOutputSchema,
} from '../../features/review-workflow/agents/evidence-map/contract.js';
import { evidenceMapAgentInstructions } from '../../features/review-workflow/agents/evidence-map/instructions.js';
import {
  AuditModelOutputSchema,
  VectorAuditModelInputSchema,
} from '../../features/review-workflow/agents/investigation/contract.js';
import { investigationAgentInstructions } from '../../features/review-workflow/agents/investigation/instructions.js';
import {
  PlanModelInputSchema,
  PlanModelOutputSchema,
  PlanModelRequestSchema,
} from '../../features/review-workflow/agents/planning/contract.js';
import { planningAgentInstructions } from '../../features/review-workflow/agents/planning/instructions.js';
import {
  SourcePostureModelInputSchema,
  SourcePostureModelOutputSchema,
} from '../../features/review-workflow/agents/source-posture/contract.js';
import { sourcePostureAgentInstructions } from '../../features/review-workflow/agents/source-posture/instructions.js';
import {
  VerificationModelInputSchema,
  VerificationModelOutputSchema,
} from '../../features/review-workflow/agents/verification/contract.js';
import { verificationAgentInstructions } from '../../features/review-workflow/agents/verification/instructions.js';
import {
  RepoGrepToolInputSchema as GrepFilesInputSchema,
  RepoGrepToolOutputSchema as GrepFilesOutputSchema,
  RepoListToolInputSchema as ListFilesInputSchema,
  RepoListToolOutputSchema as ListFilesOutputSchema,
  RepoReadToolInputSchema as ReadFileInputSchema,
  RepoReadToolOutputSchema as ReadFileOutputSchema,
  type ReviewRepositoryToolset,
  scopedInspectionRequirement,
} from '../../features/review-workflow/tools/contract.js';

import { NoContentLogger } from './no-content-logger.js';

export const HarnessExecutionConfigurationSchema = z
  .strictObject({
    runTimeoutMs: z.number().int().min(5_000).max(300_000).default(30_000),
    modelTimeoutMs: z.number().int().min(5_000).max(180_000).default(20_000),
    modelRetry: z.enum(['default', 'disabled']).default('default'),
  })
  .superRefine((value, context) => {
    if (value.runTimeoutMs < value.modelTimeoutMs) {
      context.addIssue({
        code: 'custom',
        path: ['runTimeoutMs'],
        message: 'runTimeoutMs must be at least modelTimeoutMs.',
      });
    }
  });

export type HarnessExecutionConfiguration = z.infer<typeof HarnessExecutionConfigurationSchema>;

export type ReviewToolset = ReviewRepositoryToolset;

/**
 * The scoped-stage lifecycle owns the one permitted fresh same-scope retry.
 * Keep the provider attempt one-shot so a provider default cannot multiply it.
 */
export function harnessProviderRetry(
  modelRetry: HarnessExecutionConfiguration['modelRetry'],
): false | Readonly<{ maxAttempts: 1 }> {
  return modelRetry === 'disabled' ? false : { maxAttempts: 1 };
}

export function createSecurityReviewerHarness(
  modelProvider: ModelProvider,
  toolset: ReviewToolset,
  modelName = 'security-reviewer-configured-model',
  modelCacheRoutingKey?: string,
) {
  const execution = HarnessExecutionConfigurationSchema.parse({});
  return createSecurityReviewerHarnessWithExecution(
    modelProvider,
    toolset,
    modelName,
    execution,
    modelCacheRoutingKey,
  );
}

export function createSecurityReviewerHarnessWithExecution(
  modelProvider: ModelProvider,
  toolset: ReviewToolset,
  modelName: string | undefined,
  execution: HarnessExecutionConfiguration,
  modelCacheRoutingKey?: string,
) {
  return defineHarness({ name: 'security-reviewer' })
    .logger(new NoContentLogger())
    .telemetry({ contentCaptureMode: 'NO_CONTENT' })
    .sandbox(inMemorySandbox())
    .defaults({
      // Source access is recovered from provider-signalled overflow; the run
      // timeout is the operational stop condition, not a fixed agent-loop cap.
      agentMaxIterations: Number.POSITIVE_INFINITY,
      maxParallelToolCalls: 2,
      runTimeoutMs: execution.runTimeoutMs,
      modelTimeoutMs: execution.modelTimeoutMs,
      toolTimeoutMs: 5_000,
    })
    .models({
      reviewer: {
        provider: modelProvider,
        model: modelName ?? 'security-reviewer-configured-model',
        capabilities: ['object', 'tool_use'],
        retry: harnessProviderRetry(execution.modelRetry),
        ...(modelCacheRoutingKey === undefined
          ? {}
          : { defaults: { providerOptions: { prompt_cache_key: modelCacheRoutingKey } } }),
      },
    })
    .tools({
      repo_list: {
        description: 'List allowlisted repository files. Never returns absolute paths.',
        input: ListFilesInputSchema,
        output: ListFilesOutputSchema,
        handler: async (context, input) => {
          context.signal.throwIfAborted();
          return toolset.listFiles(input);
        },
      },
      repo_read: {
        description: 'Read an allowlisted source range from a relative path.',
        input: ReadFileInputSchema,
        output: ReadFileOutputSchema,
        handler: async (context, input) => {
          context.signal.throwIfAborted();
          return toolset.readFile(input);
        },
      },
      repo_grep: {
        description:
          'Search allowlisted source text with explicit literal, identifier, or safe-regex and casing behavior.',
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
          context.metrics.counter('security_reviewer.plan.started');
          return context.metrics.duration(
            'security_reviewer.plan.duration',
            undefined,
            async () => {
              const modelOutput = await context.agents.planner({
                ...context.input,
                inspectionRequirement: scopedInspectionRequirement(context.input.sourcePaths),
              });
              const plan = createPlan({
                targetFingerprint: context.input.targetFingerprint,
                contextDigest: context.input.contextDigest,
                targetDisplayName: context.input.targetDisplayName,
                inventorySummary: context.input.inventorySummary,
                vectors: modelOutput.vectors,
                createdAt: context.input.createdAt,
              });
              context.metrics.counter('security_reviewer.plan.completed');
              return plan;
            },
          );
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
          context.metrics.counter('security_reviewer.investigation.started', 1);
          return context.metrics.duration(
            'security_reviewer.investigation.duration',
            undefined,
            async () => {
              const output = await context.agents.auditor(context.input);
              context.metrics.counter('security_reviewer.investigation.completed', 1);
              return output;
            },
          );
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
          context.metrics.counter('security_reviewer.evidence_mapping.started', 1);
          return context.metrics.duration(
            'security_reviewer.evidence_mapping.duration',
            undefined,
            async () => {
              const output = await context.agents.evidenceMapper(context.input);
              context.metrics.counter('security_reviewer.evidence_mapping.completed', 1);
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
          context.metrics.counter('security_reviewer.source_posture.started', 1);
          return context.metrics.duration(
            'security_reviewer.source_posture.duration',
            undefined,
            async () => {
              const output = await context.agents.sourcePostureAssessor(context.input);
              context.metrics.counter('security_reviewer.source_posture.completed', 1);
              return output;
            },
          );
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
          context.metrics.counter('security_reviewer.verification.started');
          return context.metrics.duration(
            'security_reviewer.verification.duration',
            undefined,
            async () => {
              const output = await context.agents.verifier(context.input);
              context.metrics.counter('security_reviewer.verification.completed');
              return output;
            },
          );
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
          context.metrics.counter('security_reviewer.countercheck.started');
          return context.metrics.duration(
            'security_reviewer.countercheck.duration',
            undefined,
            async () => {
              const output = await context.agents.counterchecker(context.input);
              context.metrics.counter('security_reviewer.countercheck.completed');
              return output;
            },
          );
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
          context.metrics.counter('security_reviewer.candidate_grounding.started');
          return context.metrics.duration(
            'security_reviewer.candidate_grounding.duration',
            undefined,
            async () => {
              const output = await context.agents.candidateGrounder(context.input);
              context.metrics.counter('security_reviewer.candidate_grounding.completed');
              return output;
            },
          );
        },
      }),
    }))
    .build();
}
