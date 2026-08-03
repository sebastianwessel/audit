import type { ModelProvider } from '@purista/harness';
import { z } from 'zod';
import { writeJsonArtifact } from '../../platform/artifact-store/json-artifact-store.js';
import {
  loadRuntimeConfiguration,
  ProviderNameSchema,
  type RuntimeConfiguration,
} from '../../platform/configuration/environment.js';
import {
  createConfiguredModelRoute,
  providerCacheRoutingKey,
} from '../../platform/harness/provider.js';
import { HarnessExecutionConfigurationSchema } from '../../platform/harness/security-reviewer-harness.js';
import {
  canonicalJson,
  createStableId,
  IdentifierSchema,
  sha256,
} from '../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { createPlan } from '../attack-planning/plan.js';
import { emptyVerificationTerminalLaneCounts } from '../audit-execution/verification/contract.js';
import { ModelCostCeilingUsdSchema } from '../model-operations/model-operations.schema.js';
import { catalogueModelPricing } from '../model-operations/model-pricing-catalogue.js';
import {
  evidenceMapProtocolFingerprint,
  reviewWorkflowPromptProtocolFingerprint,
} from '../review-workflow/prompt-protocol.js';
import { createVerificationRouteFingerprint } from '../review-workflow/runtime/verification-route.js';
import { createReviewService } from '../review-workflow/service.js';

import { parseEvaluationOptionPairs } from './command-arguments.js';
import { loadCorpusSmokeCase } from './corpus.js';
import { CorpusVariantSchema } from './corpus.schema.js';
import {
  type ProviderSmokeCheckpoint,
  ProviderSmokeCheckpointSchema,
  ProviderSmokeIdentitySchema,
  type ProviderSmokeRun,
  ProviderSmokeRunSchema,
  providerSmokeIdentityFromCheckpoint,
} from './provider-smoke.schema.js';
import {
  acquireProviderEvaluationLock,
  createEvaluationAuditCheckpointStore,
  evaluatorCheckpointModelStages,
  readProviderSmokeCheckpoint,
  writeProviderSmokeCheckpoint,
} from './real-world-artifacts.js';

const ProviderSmokeArgumentsSchema = z.strictObject({
  provider: ProviderNameSchema.optional(),
  model: z.string().trim().min(1).max(160).optional(),
  case: IdentifierSchema,
  variant: CorpusVariantSchema,
  corpus: z.string().trim().min(1).optional(),
  output: z.string().trim().min(1).optional(),
  'api-key-env': z.string().trim().min(1).max(160).optional(),
  'max-estimated-cost-usd': z.coerce.number().pipe(ModelCostCeilingUsdSchema).optional(),
  'model-timeout-ms': z.coerce.number().int().min(5_000).max(180_000).default(120_000),
  'run-timeout-ms': z.coerce.number().int().min(5_000).max(300_000).default(150_000),
  'run-id': IdentifierSchema.optional(),
  resume: z.enum(['true', 'false']).default('false'),
  'retry-unfinished': z.enum(['true', 'false']).default('false'),
});

const ProviderSmokeOptionsSchema = ProviderSmokeArgumentsSchema.extend({
  provider: ProviderNameSchema,
  model: z.string().trim().min(1).max(160),
  corpus: z.string().trim().min(1),
  output: z.string().trim().min(1),
  'max-estimated-cost-usd': ModelCostCeilingUsdSchema,
  executionBudget: HarnessExecutionConfigurationSchema,
  runId: IdentifierSchema,
  resume: z.boolean(),
  retryUnfinished: z.boolean(),
});

export type ProviderSmokeOptions = z.output<typeof ProviderSmokeOptionsSchema>;

/** Strictly parse the one-case, one-variant, one-attempt non-scoring smoke command. */
export function parseProviderSmokeArguments(
  argv: readonly string[],
  runtime?: RuntimeConfiguration,
): ProviderSmokeOptions {
  const values = parseEvaluationOptionPairs(argv);
  const parsedArguments = ProviderSmokeArgumentsSchema.safeParse(values);
  if (!parsedArguments.success) throw usage('Invalid provider smoke options.');
  if (parsedArguments.data.resume === 'true' && parsedArguments.data['run-id'] === undefined) {
    throw usage('Resuming a provider smoke requires an explicit --run-id.');
  }
  if (
    parsedArguments.data['retry-unfinished'] === 'true' &&
    parsedArguments.data.resume !== 'true'
  ) {
    throw usage('Retrying unfinished smoke work requires --resume true.');
  }
  const parsed = ProviderSmokeOptionsSchema.safeParse({
    ...parsedArguments.data,
    provider: parsedArguments.data.provider ?? runtime?.provider,
    model: parsedArguments.data.model ?? runtime?.model,
    corpus: parsedArguments.data.corpus ?? runtime?.evaluationCorpusRoot ?? 'evaluation/corpora',
    output: parsedArguments.data.output ?? runtime?.evaluationOutputRoot ?? 'evaluation/runs',
    'api-key-env': parsedArguments.data['api-key-env'] ?? runtime?.apiKeyEnvironmentVariable,
    'max-estimated-cost-usd':
      parsedArguments.data['max-estimated-cost-usd'] ?? runtime?.maxEstimatedCostUsd,
    executionBudget: {
      modelTimeoutMs: parsedArguments.data['model-timeout-ms'],
      runTimeoutMs: parsedArguments.data['run-timeout-ms'],
      modelRetry: 'default',
    },
    runId:
      parsedArguments.data['run-id'] ??
      createStableId('provider-smoke', `${String(Date.now())}\0${crypto.randomUUID()}`),
    resume: parsedArguments.data.resume === 'true',
    retryUnfinished: parsedArguments.data['retry-unfinished'] === 'true',
  });
  if (!parsed.success) {
    throw usage('A provider, model, and observed-cost ceiling are required for a provider smoke.');
  }
  return parsed.data;
}

export async function runProviderSmoke(input: {
  options: ProviderSmokeOptions;
  environment: Readonly<Record<string, string | undefined>>;
  /** Test-only in-process route; production always constructs the configured provider. */
  modelProvider?: ModelProvider;
}): Promise<ProviderSmokeRun> {
  const smoke = await loadCorpusSmokeCase({
    root: input.options.corpus,
    caseId: input.options.case,
    variant: input.options.variant,
  });
  const lock = await acquireProviderEvaluationLock(input.options.output, input.options.runId);
  try {
    const pricing = catalogueModelPricing({
      provider: input.options.provider,
      model: input.options.model,
    });
    if (pricing.inputPerMillion === undefined || pricing.outputPerMillion === undefined) {
      throw usage('The selected provider/model has no exact bundled price catalogue entry.');
    }
    const configuredRoute =
      input.modelProvider === undefined
        ? createConfiguredModelRoute({
            provider: input.options.provider,
            model: input.options.model,
            apiKeyEnvironmentVariable: input.options['api-key-env'],
            modelPricing: pricing,
            environment: input.environment,
            requestTimeoutMs: input.options.executionBudget.modelTimeoutMs,
          })
        : undefined;
    const modelProvider = input.modelProvider ?? configuredRoute?.modelProvider;
    if (modelProvider === undefined) throw new Error('Expected a configured smoke model provider.');
    const service = createReviewService(modelProvider, input.options.model, {
      maxParallelVectors: 1,
      harnessExecution: input.options.executionBudget,
      maxEstimatedCostUsd: input.options['max-estimated-cost-usd'],
      modelPricing: pricing,
      modelCacheRoutingKey: providerCacheRoutingKey({
        provider: input.options.provider,
        model: input.options.model,
      }),
    });
    const startedAt = new Date().toISOString();
    const inventory = await service.inspectTarget({
      targetRoot: smoke.targetRoot,
      contextRoot: smoke.contextRoot,
      targetDisplayName: smoke.case.caseId,
    });
    const plan = createPlan({
      targetFingerprint: inventory.targetFingerprint,
      contextDigest: inventory.contextDigest,
      targetDisplayName: smoke.case.caseId,
      inventorySummary: inventory.summary,
      vectors: smoke.reviewedPlan.vectors,
      createdAt: smoke.reviewedPlan.reviewedAt,
    });
    const verificationRouteFingerprint = createVerificationRouteFingerprint({
      route: 'primary',
      provider: input.options.provider,
      model: input.options.model,
    });
    const auditCheckpointStore = createEvaluationAuditCheckpointStore({
      outputRoot: input.options.output,
      evaluationRunId: input.options.runId,
      candidateGroundingProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
      savedAt: () => new Date().toISOString(),
    });
    const checkpointBinding = {
      runId: input.options.runId,
      planId: plan.planId,
      targetFingerprint: inventory.targetFingerprint,
      provider: input.options.provider,
      model: input.options.model,
      verificationRouteFingerprint,
      evidenceMapProtocolFingerprint,
      reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    };
    const identity = ProviderSmokeIdentitySchema.parse({
      runId: input.options.runId,
      provider: input.options.provider,
      model: input.options.model,
      caseId: smoke.case.caseId,
      variant: smoke.variant,
      planProfile: 'reviewed-plan',
      targetFingerprint: inventory.targetFingerprint,
      contextDigest: inventory.contextDigest,
      reviewedPlanFingerprint: sha256(canonicalJson(smoke.reviewedPlan)),
      verificationRouteFingerprint,
      evidenceMapProtocolFingerprint,
      reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
      executionBudget: input.options.executionBudget,
    });
    const existing = await readProviderSmokeCheckpoint(input.options.output, input.options.runId);
    if (existing !== undefined && !input.options.resume) {
      throw usage(
        'A smoke checkpoint already exists for this run id; pass --resume true to continue it.',
      );
    }
    if (
      existing !== undefined &&
      canonicalJson(providerSmokeIdentityFromCheckpoint(existing)) !== canonicalJson(identity)
    ) {
      throw usage('The smoke checkpoint identity does not match this provider smoke.');
    }
    let checkpoint: ProviderSmokeCheckpoint = ProviderSmokeCheckpointSchema.parse({
      ...(existing ?? identity),
      schemaVersion: 1,
      ...identity,
      status: 'running',
      errorCode: null,
      startedAt: existing?.startedAt ?? startedAt,
      updatedAt: startedAt,
    });
    await writeProviderSmokeCheckpoint(input.options.output, checkpoint);
    try {
      const reusable = input.options.resume
        ? await auditCheckpointStore.load({
            binding: checkpointBinding,
            plan,
            retryUnfinished: input.options.retryUnfinished,
          })
        : undefined;
      if (reusable !== undefined) {
        service.recordPriorModelStages(evaluatorCheckpointModelStages(reusable));
      }
      const audited = await service.audit({
        targetRoot: smoke.targetRoot,
        contextRoot: smoke.contextRoot,
        targetDisplayName: smoke.case.caseId,
        plan,
        runId: input.options.runId,
        generatedAt: startedAt,
        sessionId: input.options.runId,
        priorVectorResults: reusable?.vectorResults,
        priorCandidateGroundingDrafts: reusable?.candidateGroundingDrafts,
        priorCandidateAwareCheckpoints: reusable?.candidateAwareCheckpoints,
        priorEvidenceMapDrafts: reusable?.evidenceMapDrafts,
        priorSourcePostureDrafts: reusable?.sourcePostureDrafts,
        priorContextOverflowLedgers: reusable?.contextOverflowLedgers,
        priorEvidenceMapRecoveryLeaves: reusable?.evidenceMapRecoveryLeaves,
        priorSourcePostureRecoveryLeaves: reusable?.sourcePostureRecoveryLeaves,
        priorCandidateGroundingRecoveryLeaves: reusable?.candidateGroundingRecoveryLeaves,
        retryUnfinished: input.options.retryUnfinished,
        onEvidenceMapDraft: async (draft) =>
          auditCheckpointStore.saveEvidenceMap({ binding: checkpointBinding, plan, draft }),
        onSourcePostureDraft: async (draft) =>
          auditCheckpointStore.saveSourcePosture({ binding: checkpointBinding, plan, draft }),
        onCandidateGroundingDraft: async (draft) =>
          auditCheckpointStore.saveCandidateGrounding({ binding: checkpointBinding, plan, draft }),
        onCandidateAwareCheckpoint: async (update) =>
          auditCheckpointStore.saveCandidateAware({ binding: checkpointBinding, plan, update }),
        onVectorResult: async (result) =>
          auditCheckpointStore.saveVectorResult({ binding: checkpointBinding, plan, result }),
        onContextOverflowTransition: async (update) =>
          auditCheckpointStore.saveContextOverflowTransition({
            binding: checkpointBinding,
            plan,
            update,
          }),
        onEvidenceMapRecoveryLeaf: async (update) =>
          auditCheckpointStore.saveEvidenceMapRecoveryLeaf({
            binding: checkpointBinding,
            plan,
            update,
          }),
        onSourcePostureRecoveryLeaf: async (update) =>
          auditCheckpointStore.saveSourcePostureRecoveryLeaf({
            binding: checkpointBinding,
            plan,
            update,
          }),
        onCandidateGroundingRecoveryLeaf: async (update) =>
          auditCheckpointStore.saveCandidateGroundingRecoveryLeaf({
            binding: checkpointBinding,
            plan,
            update,
          }),
      });
      const run = ProviderSmokeRunSchema.parse({
        schemaVersion: 2,
        mode: 'provider-smoke',
        ...identity,
        startedAt: checkpoint.startedAt,
        finishedAt: new Date().toISOString(),
        status: smokeStatus(audited.report.coverage.map((coverage) => coverage.outcome)),
        vectors: audited.report.coverage.map((coverage) => ({
          vectorId: coverage.vectorId,
          outcome: coverage.outcome,
          errorCode: coverage.errorCode,
          matchedSourcePaths: coverage.matchedSourcePaths,
          evidenceMapFactCount: coverage.evidenceMapFactCount,
          evidenceMapUnansweredObligationCount: coverage.evidenceMapUnansweredObligationCount,
          sourcePostureAssessmentCount: coverage.sourcePostureAssessmentCount,
          findingCount: coverage.findingCount,
          reviewRequiredCount: coverage.reviewRequiredCount ?? 0,
          verificationTerminalLanes:
            coverage.admissionFunnel?.verificationTerminalLanes ??
            emptyVerificationTerminalLaneCounts(),
        })),
        modelObservation: audited.modelObservation,
      });
      await writeJsonArtifact(
        input.options.output,
        `smokes/${input.options.runId}.json`,
        ProviderSmokeRunSchema,
        run,
      );
      checkpoint = ProviderSmokeCheckpointSchema.parse({
        ...checkpoint,
        status: 'completed',
        errorCode: null,
        updatedAt: new Date().toISOString(),
      });
      await writeProviderSmokeCheckpoint(input.options.output, checkpoint);
      return run;
    } catch (error) {
      const cancelled =
        error instanceof SecurityReviewerError && error.code === 'provider-cancelled';
      await writeProviderSmokeCheckpoint(
        input.options.output,
        ProviderSmokeCheckpointSchema.parse({
          ...checkpoint,
          status: cancelled ? 'cancelled' : 'failed',
          errorCode: cancelled ? 'provider-cancelled' : 'provider-smoke-failed',
          updatedAt: new Date().toISOString(),
        }),
      );
      throw error;
    }
  } finally {
    await lock.release();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const runtime = await loadRuntimeConfiguration();
  const options = parseProviderSmokeArguments(argv, runtime.configuration);
  const run = await runProviderSmoke({ options, environment: runtime.environment });
  process.stdout.write(`${JSON.stringify(run)}\n`);
  return run.status === 'completed' ? 0 : 1;
}

function smokeStatus(
  outcomes: readonly (
    | 'completed'
    | 'not-applicable'
    | 'incomplete'
    | 'failed'
    | 'cancelled'
    | 'skipped'
  )[],
): 'completed' | 'incomplete' | 'failed' | 'cancelled' {
  if (outcomes.some((outcome) => outcome === 'failed')) return 'failed';
  if (outcomes.some((outcome) => outcome === 'cancelled')) return 'cancelled';
  if (outcomes.every((outcome) => outcome === 'completed' || outcome === 'not-applicable'))
    return 'completed';
  return 'incomplete';
}

function usage(message: string): SecurityReviewerError {
  return new SecurityReviewerError(
    'invalid-input',
    `${message} Usage: bun run eval:smoke --case <development-case-id> --variant <vulnerable|patched|benign> --max-estimated-cost-usd <ceiling> [--provider openai|anthropic --model <name> --corpus evaluation/corpora --output evaluation/runs --run-id <id> --resume true --retry-unfinished true]`,
  );
}

if (import.meta.main) {
  try {
    process.exitCode = await main(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected provider smoke failure.';
    process.stderr.write(`security-reviewer provider smoke: ${message}\n`);
    process.exitCode = 2;
  }
}
