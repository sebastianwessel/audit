import { basename } from 'node:path';
import type { ModelProvider } from '@purista/harness';
import type { z } from 'zod';
import { AttackPlanSchema } from '../features/attack-planning/plan.schema.js';
import type { CandidateAwareCheckpointUpdate } from '../features/audit-execution/audit.js';
import {
  AuditCandidateAwareCheckpointSchema,
  AuditCandidateGroundingDraftSchema,
  AuditCandidateGroundingRecoveryLeafSchema,
  AuditContextOverflowLedgerSchema,
  AuditEvidenceMapDraftSchema,
  AuditEvidenceMapRecoveryLeafSchema,
  type AuditReport,
  AuditReportSchema,
  type AuditRunAttempt,
  AuditRunAttemptSchema,
  type AuditRunManifest,
  AuditRunManifestSchema,
  AuditSourcePostureDraftSchema,
  AuditSourcePostureRecoveryLeafSchema,
  AuditVectorCheckpointSchema,
  type AuditVectorResult,
} from '../features/audit-execution/audit.schema.js';
import {
  auditCandidateAwareCheckpointPath,
  auditCandidateGroundingDraftPath,
  auditCandidateGroundingRecoveryLeafPath,
  auditCheckpointPath,
  auditContextOverflowLedgerPath,
  auditEvidenceMapDraftPath,
  auditEvidenceMapRecoveryLeafPath,
  auditSourcePostureDraftPath,
  auditSourcePostureRecoveryLeafPath,
  createAuditCandidateAwareCheckpoint,
  createAuditCandidateGroundingDraft,
  createAuditCandidateGroundingRecoveryLeaf,
  createAuditCheckpointBinding,
  createAuditContextOverflowLedger,
  createAuditEvidenceMapDraft,
  createAuditEvidenceMapRecoveryLeaf,
  createAuditResumeState,
  createAuditSourcePostureDraft,
  createAuditSourcePostureRecoveryLeaf,
  createAuditVectorCheckpoint,
  loadObservedAuditVectorResults,
  loadReusableAuditCandidateAwareCheckpoints,
  loadReusableAuditCandidateGroundingDrafts,
  loadReusableAuditCandidateGroundingRecoveryLeaves,
  loadReusableAuditContextOverflowLedgers,
  loadReusableAuditEvidenceMapDrafts,
  loadReusableAuditEvidenceMapRecoveryLeaves,
  loadReusableAuditSourcePostureDrafts,
  loadReusableAuditSourcePostureRecoveryLeaves,
  loadReusableAuditVectorResults,
  reusableContextOverflowModelStages,
} from '../features/audit-execution/checkpoints.js';
import { classifyAuditTerminal } from '../features/audit-execution/terminal-classification.js';
import {
  AuditReportLineageSchema,
  createAuditReportLineage,
  renderAuditReportLineageMarkdown,
} from '../features/audit-lineage/index.js';
import { renderAuditReportMarkdown } from '../features/audit-report/report.js';
import type { ModelStageObservation } from '../features/model-operations/model-operations.js';
import { ModelCostCeilingUsdSchema } from '../features/model-operations/model-operations.schema.js';
import { catalogueModelPricing } from '../features/model-operations/model-pricing-catalogue.js';
import {
  evidenceMapProtocolFingerprint,
  reviewWorkflowPromptProtocolFingerprint,
} from '../features/review-workflow/prompt-protocol.js';
import { createVerificationRouteFingerprint } from '../features/review-workflow/runtime/verification-route.js';
import { createReviewService, modelStagesForAudit } from '../features/review-workflow/service.js';
import {
  loadRetainedTargetSnapshot,
  releaseTargetSnapshot,
  retainTargetSnapshot,
} from '../features/target-inventory/snapshot-store.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  readOptionalJsonArtifact,
  writeJsonArtifact,
} from '../platform/artifact-store/json-artifact-store.js';
import {
  ensureSafeOutputRoot,
  type RootTopology,
  validateRootTopology,
} from '../platform/artifact-store/root-topology.js';
import {
  loadRuntimeConfiguration,
  MaxParallelVectorsSchema,
  type RuntimeConfiguration,
} from '../platform/configuration/environment.js';
import {
  createConfiguredProvider,
  ProviderNameSchema,
  providerCacheRoutingKey,
} from '../platform/harness/provider.js';
import { SecurityReviewerError } from '../shared/errors/security-reviewer-error.js';
import { assertValidCommandOptions } from './command-options.js';

const commandNames = new Set(['plan', 'audit', 'report', 'lineage']);

export type CliCommand = Readonly<{
  command: 'plan' | 'audit' | 'report' | 'lineage';
  options: Readonly<Record<string, string>>;
}>;

export function parseCliArguments(argv: readonly string[]): CliCommand {
  const command = argv[0];
  if (command === undefined || !commandNames.has(command))
    throw usage('Expected one of: plan, audit, report, lineage.');
  const options: Record<string, string> = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (
      key === undefined ||
      value === undefined ||
      !key.startsWith('--') ||
      key.length < 3 ||
      options[key.slice(2)] !== undefined
    )
      throw usage('Options must be unique --key value pairs.');
    options[key.slice(2)] = value;
  }
  return { command: command as CliCommand['command'], options };
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const parsed = parseCliArguments(argv);
  assertValidCommandOptions(parsed.command, parsed.options);
  const runtime = await loadRuntimeConfiguration();
  if (parsed.command === 'report') return runReport(parsed.options, runtime.configuration);
  if (parsed.command === 'lineage') return runLineage(parsed.options, runtime.configuration);
  if (runtime.configuration.verificationMode === 'independent-route') {
    throw usage(
      'The independent verifier route is evaluation-only and cannot run product commands.',
    );
  }
  const roots = await prepareProductRoots({
    targetRoot: required(parsed.options, 'target'),
    contextRoot: parsed.options.context,
    outputRoot: parsed.options.output ?? runtime.configuration.artifactDirectory,
  });
  const provider = createProvider(parsed.options, runtime.configuration, runtime.environment);
  return parsed.command === 'plan'
    ? runPlan(parsed.options, runtime.configuration, provider, roots)
    : runAudit(parsed.options, runtime.configuration, provider, roots);
}

async function runPlan(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
  provider: ModelProvider,
  roots: RootTopology,
): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = `plan-${crypto.randomUUID()}`;
  const targetRoot = roots.targetRoot;
  const output = roots.outputRoot;
  const selectedModel = model(options, runtime);
  const service = createReviewService(provider, selectedModel, {
    maxParallelVectors: maxParallelVectors(options, runtime),
    modelPricing: selectedModelPricing(options, runtime),
    maxEstimatedCostUsd: maxEstimatedCostUsd(options, runtime),
    modelCacheRoutingKey: providerCacheRoutingKey({
      provider: ProviderNameSchema.parse(providerName(options, runtime)),
      model: selectedModel,
    }),
  });
  const created = await service.createPlan({
    targetRoot,
    contextRoot: roots.contextRoot,
    targetDisplayName: options['target-name'] ?? basename(targetRoot),
    createdAt: startedAt,
    sessionId: runId,
  });
  await writeJsonArtifact(
    output,
    `plans/${created.plan.planId}.json`,
    AttackPlanSchema,
    created.plan,
  );
  await writeRunManifest(output, {
    schemaVersion: 2,
    runId,
    command: 'plan',
    startedAt,
    finishedAt: new Date().toISOString(),
    targetFingerprint: created.inventory.targetFingerprint,
    planId: created.plan.planId,
    provider: providerName(options, runtime),
    model: selectedModel,
    outcome: 'completed',
    counters: {
      plannedVectors: created.plan.vectors.length,
      completedVectors: 0,
      failedVectors: 0,
      findingCount: 0,
    },
    modelObservation: created.modelObservation,
    ...(created.modelCostCeilingState === undefined
      ? {}
      : { modelCostCeilingState: created.modelCostCeilingState }),
  });
  process.stdout.write(
    `Created executable plan plans/${created.plan.planId}.json for ${created.inventory.summary.fileCount} files.\n`,
  );
  return 0;
}

export async function runAudit(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
  provider: ModelProvider,
  roots: RootTopology,
): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = options['run-id'] ?? `audit-${crypto.randomUUID()}`;
  const resume = booleanOption(options, 'resume', false);
  const retryUnfinished = booleanOption(options, 'retry-unfinished', false);
  if (resume && options['run-id'] === undefined) {
    throw usage('Resuming an audit requires an explicit --run-id.');
  }
  const targetRoot = roots.targetRoot;
  const output = roots.outputRoot;
  const plan = await readJsonArtifact(output, required(options, 'plan'), AttackPlanSchema);
  const lease = await acquireArtifactLease(output, `work/leases/${runId}.lock`);
  const attemptStartedAt = startedAt;
  try {
    const priorAttempt = await readOptionalAuditRunAttempt(output, runId);
    assertAuditRunReuse({ resume, plan, priorAttempt });
    await writeAuditRunAttempt(output, {
      schemaVersion: 1,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: attemptStartedAt,
      finishedAt: null,
      status: 'starting',
    });
    const selectedModel = model(options, runtime);
    const selectedProvider = providerName(options, runtime);
    const verificationRouteFingerprint = createVerificationRouteFingerprint({
      route: 'primary',
      provider: selectedProvider,
      model: selectedModel,
    });
    const retainedSnapshot = resume
      ? await loadRetainedTargetSnapshot({
          outputRoot: output,
          runId,
          targetFingerprint: plan.targetFingerprint,
          contextDigest: plan.contextDigest,
        })
      : undefined;
    const priorVectorResults = resume
      ? await loadReusableAuditVectorResults({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          retryUnfinished,
          reader: async (artifactPath) => readOptionalAuditVectorCheckpoint(output, artifactPath),
        })
      : [];
    const observedVectorResults = resume
      ? await loadObservedAuditVectorResults({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          reader: async (artifactPath) => readOptionalAuditVectorCheckpoint(output, artifactPath),
        })
      : [];
    const priorCandidateGroundingDrafts = resume
      ? await loadReusableAuditCandidateGroundingDrafts({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          candidateGroundingProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          plan,
          reader: async (artifactPath) =>
            readOptionalAuditCandidateGroundingDraft(output, artifactPath),
        })
      : [];
    const priorCandidateAwareCheckpoints = resume
      ? await loadReusableAuditCandidateAwareCheckpoints({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          candidateGroundingProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          plan,
          drafts: priorCandidateGroundingDrafts,
          reader: async (artifactPath) =>
            readOptionalAuditCandidateAwareCheckpoint(output, artifactPath),
          retryUnfinished,
        })
      : [];
    const priorEvidenceMapDrafts = resume
      ? await loadReusableAuditEvidenceMapDrafts({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          reader: async (artifactPath) => readOptionalAuditEvidenceMapDraft(output, artifactPath),
        })
      : [];
    const priorSourcePostureDrafts = resume
      ? await loadReusableAuditSourcePostureDrafts({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          reader: async (artifactPath) => readOptionalAuditSourcePostureDraft(output, artifactPath),
        })
      : [];
    const priorContextOverflowLedgers = resume
      ? await loadReusableAuditContextOverflowLedgers({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          reader: async (artifactPath) =>
            readOptionalAuditContextOverflowLedger(output, artifactPath),
        })
      : [];
    const contextOverflowLedgersByStage = new Map(
      priorContextOverflowLedgers.map((ledger) => [`${ledger.vectorId}\0${ledger.phase}`, ledger]),
    );
    const priorEvidenceMapRecoveryLeaves = resume
      ? await loadReusableAuditEvidenceMapRecoveryLeaves({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          ledgers: priorContextOverflowLedgers,
          reader: async (artifactPath) =>
            readOptionalAuditEvidenceMapRecoveryLeaf(output, artifactPath),
        })
      : [];
    const priorSourcePostureRecoveryLeaves = resume
      ? await loadReusableAuditSourcePostureRecoveryLeaves({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          ledgers: priorContextOverflowLedgers,
          reader: async (artifactPath) =>
            readOptionalAuditSourcePostureRecoveryLeaf(output, artifactPath),
        })
      : [];
    const priorCandidateGroundingRecoveryLeaves = resume
      ? await loadReusableAuditCandidateGroundingRecoveryLeaves({
          binding: {
            runId,
            planId: plan.planId,
            targetFingerprint: plan.targetFingerprint,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          },
          plan,
          ledgers: priorContextOverflowLedgers,
          reader: async (artifactPath) =>
            readOptionalAuditCandidateGroundingRecoveryLeaf(output, artifactPath),
        })
      : [];
    const resumeState = createAuditResumeState({
      vectorResults: priorVectorResults,
      candidateGroundingDrafts: priorCandidateGroundingDrafts,
      candidateAwareCheckpoints: priorCandidateAwareCheckpoints,
      evidenceMapDrafts: priorEvidenceMapDrafts,
      sourcePostureDrafts: priorSourcePostureDrafts,
      contextOverflowLedgers: priorContextOverflowLedgers,
      evidenceMapRecoveryLeaves: priorEvidenceMapRecoveryLeaves,
      sourcePostureRecoveryLeaves: priorSourcePostureRecoveryLeaves,
      candidateGroundingRecoveryLeaves: priorCandidateGroundingRecoveryLeaves,
    });
    const service = createReviewService(provider, selectedModel, {
      maxParallelVectors: maxParallelVectors(options, runtime),
      modelPricing: selectedModelPricing(options, runtime),
      maxEstimatedCostUsd: maxEstimatedCostUsd(options, runtime),
      priorModelStages: resumedModelStages({
        priorVectorResults: observedVectorResults,
        priorCandidateGroundingDrafts,
        priorCandidateAwareCheckpoints,
        priorEvidenceMapDrafts,
        priorSourcePostureDrafts,
        priorContextOverflowLedgers,
      }),
      modelCacheRoutingKey: providerCacheRoutingKey({
        provider: ProviderNameSchema.parse(selectedProvider),
        model: selectedModel,
      }),
    });
    const audited = await service.audit({
      targetRoot,
      contextRoot: roots.contextRoot,
      targetDisplayName: options['target-name'] ?? basename(targetRoot),
      plan,
      runId,
      generatedAt: startedAt,
      sessionId: runId,
      resumeState,
      retryUnfinished,
      retainedSnapshot,
      onSnapshotCaptured: async (capture) =>
        retainTargetSnapshot({ outputRoot: output, runId, capture }),
      onEvidenceMapDraft: async (draft) =>
        writeAuditEvidenceMapDraft({
          output,
          runId,
          plan,
          provider: selectedProvider,
          model: selectedModel,
          verificationRouteFingerprint,
          evidenceMapProtocolFingerprint,
          reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          draft,
        }),
      onCandidateGroundingDraft: async (draft) =>
        writeAuditCandidateGroundingDraft({
          output,
          runId,
          plan,
          provider: selectedProvider,
          model: selectedModel,
          verificationRouteFingerprint,
          evidenceMapProtocolFingerprint,
          reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          candidateGroundingProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          draft,
        }),
      onCandidateAwareCheckpoint: async (update) =>
        writeAuditCandidateAwareCheckpoint({
          output,
          runId,
          plan,
          provider: selectedProvider,
          model: selectedModel,
          verificationRouteFingerprint,
          evidenceMapProtocolFingerprint,
          reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          candidateGroundingProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          update,
        }),
      onSourcePostureDraft: async (draft) =>
        writeAuditSourcePostureDraft({
          output,
          runId,
          plan,
          provider: selectedProvider,
          model: selectedModel,
          verificationRouteFingerprint,
          evidenceMapProtocolFingerprint,
          reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          draft,
        }),
      onContextOverflowTransition: async (update) => {
        const key = `${update.vectorId}\0${update.phase}`;
        const current = contextOverflowLedgersByStage.get(key);
        const events = [
          ...(current?.events ?? []),
          {
            ordinal: (current?.events.length ?? 0) + 1,
            ...update.event,
            savedAt: new Date().toISOString(),
          },
        ];
        const ledger = createAuditContextOverflowLedger({
          binding: auditCheckpointBinding({
            runId,
            plan,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
            vectorId: update.vectorId,
          }),
          plan,
          phase: update.phase,
          parentStageId: update.parentStageId,
          recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
          rootScopeFingerprint: update.rootScopeFingerprint,
          events,
        });
        contextOverflowLedgersByStage.set(key, ledger);
        await writeJsonArtifact(
          output,
          auditContextOverflowLedgerPath({
            runId,
            vectorId: update.vectorId,
            phase: update.phase,
          }),
          AuditContextOverflowLedgerSchema,
          ledger,
        );
      },
      onEvidenceMapRecoveryLeaf: async (update) => {
        const leaf = createAuditEvidenceMapRecoveryLeaf({
          binding: auditCheckpointBinding({
            runId,
            plan,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
            vectorId: update.vectorId,
          }),
          plan,
          parentStageId: update.parentStageId,
          recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
          rootScopeFingerprint: update.rootScopeFingerprint,
          childKey: update.childKey,
          scopeFingerprint: update.scopeFingerprint,
          evidenceMap: update.evidenceMap,
          savedAt: new Date().toISOString(),
        });
        await writeJsonArtifact(
          output,
          auditEvidenceMapRecoveryLeafPath({
            runId,
            vectorId: update.vectorId,
            scopeFingerprint: update.scopeFingerprint,
          }),
          AuditEvidenceMapRecoveryLeafSchema,
          leaf,
        );
      },
      onSourcePostureRecoveryLeaf: async (update) => {
        const leaf = createAuditSourcePostureRecoveryLeaf({
          binding: auditCheckpointBinding({
            runId,
            plan,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
            vectorId: update.vectorId,
          }),
          plan,
          parentStageId: update.parentStageId,
          recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
          rootScopeFingerprint: update.rootScopeFingerprint,
          childKey: update.childKey,
          scopeFingerprint: update.scopeFingerprint,
          sourcePosture: update.sourcePosture,
          savedAt: new Date().toISOString(),
        });
        await writeJsonArtifact(
          output,
          auditSourcePostureRecoveryLeafPath({
            runId,
            vectorId: update.vectorId,
            scopeFingerprint: update.scopeFingerprint,
          }),
          AuditSourcePostureRecoveryLeafSchema,
          leaf,
        );
      },
      onCandidateGroundingRecoveryLeaf: async (update) => {
        const leaf = createAuditCandidateGroundingRecoveryLeaf({
          binding: auditCheckpointBinding({
            runId,
            plan,
            provider: selectedProvider,
            model: selectedModel,
            verificationRouteFingerprint,
            evidenceMapProtocolFingerprint,
            reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
            vectorId: update.vectorId,
          }),
          plan,
          parentStageId: update.parentStageId,
          recoveryProtocolFingerprint: update.recoveryProtocolFingerprint,
          rootScopeFingerprint: update.rootScopeFingerprint,
          childKey: update.childKey,
          scopeFingerprint: update.scopeFingerprint,
          groundings: update.groundings,
          savedAt: new Date().toISOString(),
        });
        await writeJsonArtifact(
          output,
          auditCandidateGroundingRecoveryLeafPath({
            runId,
            vectorId: update.vectorId,
            scopeFingerprint: update.scopeFingerprint,
          }),
          AuditCandidateGroundingRecoveryLeafSchema,
          leaf,
        );
      },
      onVectorResult: async (result) =>
        writeAuditVectorCheckpoint({
          output,
          runId,
          plan,
          provider: selectedProvider,
          model: selectedModel,
          verificationRouteFingerprint,
          evidenceMapProtocolFingerprint,
          reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
          result,
        }),
    });
    await writeJsonArtifact(
      output,
      `reports/${audited.report.reportId}.json`,
      AuditReportSchema,
      audited.report,
    );
    await writeRunManifest(output, {
      schemaVersion: 2,
      runId,
      command: 'audit',
      startedAt,
      finishedAt: new Date().toISOString(),
      targetFingerprint: audited.inventory.targetFingerprint,
      planId: audited.report.planId,
      provider: selectedProvider,
      model: selectedModel,
      outcome: auditRunOutcome(audited.report),
      counters: reportCounters(audited.report),
      modelObservation: audited.modelObservation,
      ...(audited.modelCostCeilingState === undefined
        ? {}
        : { modelCostCeilingState: audited.modelCostCeilingState }),
    });
    process.stdout.write(
      `Created report reports/${audited.report.reportId}.json with ${audited.report.findings.length} findings.\n`,
    );
    const terminal = classifyAuditTerminal(audited.report);
    if (terminal.outcome === 'completed') {
      await releaseTargetSnapshot({
        outputRoot: output,
        runId,
        targetFingerprint: plan.targetFingerprint,
      });
    }
    await writeAuditRunAttempt(output, {
      schemaVersion: 1,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: attemptStartedAt,
      finishedAt: new Date().toISOString(),
      status: terminal.outcome === 'completed' ? 'completed' : 'partial',
    });
    return terminal.exitCode;
  } catch (error) {
    await writeAuditRunAttempt(output, {
      schemaVersion: 1,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: attemptStartedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
    });
    throw error;
  } finally {
    await lease.release();
  }
}

async function runReport(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
): Promise<number> {
  const startedAt = new Date().toISOString();
  const output = await outputDirectory(options, runtime);
  const report = await readJsonArtifact(output, required(options, 'report'), AuditReportSchema);
  const terminal = classifyAuditTerminal(report);
  const runId = `report-${crypto.randomUUID()}`;
  await writeRunManifest(output, {
    schemaVersion: 2,
    runId,
    command: 'report',
    startedAt,
    finishedAt: new Date().toISOString(),
    targetFingerprint: report.targetFingerprint,
    planId: report.planId,
    provider: null,
    model: null,
    outcome: terminal.outcome,
    counters: reportCounters(report),
  });
  process.stdout.write(renderAuditReportMarkdown(report));
  return terminal.exitCode;
}

async function runLineage(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
): Promise<number> {
  const output = await outputDirectory(options, runtime);
  const previous = await readJsonArtifact(output, required(options, 'previous'), AuditReportSchema);
  const current = await readJsonArtifact(output, required(options, 'current'), AuditReportSchema);
  const lineage = createAuditReportLineage({
    previous,
    current,
    generatedAt: new Date().toISOString(),
  });
  await writeJsonArtifact(
    output,
    `lineage/${lineage.lineageId}.json`,
    AuditReportLineageSchema,
    lineage,
  );
  process.stdout.write(renderAuditReportLineageMarkdown(lineage));
  return 0;
}

function createProvider(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
): ModelProvider {
  const provider = providerName(options, runtime);
  return createConfiguredProvider({
    provider: ProviderNameSchema.parse(provider),
    apiKeyEnvironmentVariable: options['api-key-env'] ?? runtime.apiKeyEnvironmentVariable,
    environment,
  });
}

function providerName(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
): string {
  return requiredValue(options.provider ?? runtime.provider, 'provider');
}

function model(options: Readonly<Record<string, string>>, runtime: RuntimeConfiguration): string {
  return requiredValue(options.model ?? runtime.model, 'model');
}

function selectedModelPricing(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
) {
  return catalogueModelPricing({
    provider: providerName(options, runtime),
    model: model(options, runtime),
  });
}

function maxParallelVectors(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
): number {
  const configured = options['max-parallel-vectors'];
  if (configured === undefined) return runtime.maxParallelVectors;
  if (!/^\d+$/u.test(configured))
    throw usage('max-parallel-vectors must be an integer from 1 to 8.');
  return MaxParallelVectorsSchema.parse(Number(configured));
}

function maxEstimatedCostUsd(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
): number | undefined {
  const configured = options['max-estimated-cost-usd'];
  if (configured === undefined) return runtime.maxEstimatedCostUsd;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(configured)) {
    throw usage('max-estimated-cost-usd must be a positive decimal.');
  }
  return ModelCostCeilingUsdSchema.parse(Number(configured));
}

/** Retains each reusable stage exactly once before a resumed cost ceiling dispatches work. */
function resumedModelStages(input: {
  priorVectorResults: readonly AuditVectorResult[];
  priorCandidateGroundingDrafts: readonly z.infer<typeof AuditCandidateGroundingDraftSchema>[];
  priorCandidateAwareCheckpoints: readonly z.infer<typeof AuditCandidateAwareCheckpointSchema>[];
  priorEvidenceMapDrafts: readonly z.infer<typeof AuditEvidenceMapDraftSchema>[];
  priorSourcePostureDrafts: readonly z.infer<typeof AuditSourcePostureDraftSchema>[];
  priorContextOverflowLedgers: readonly z.infer<typeof AuditContextOverflowLedgerSchema>[];
}): readonly ModelStageObservation[] {
  const terminalVectorIds = new Set(
    input.priorVectorResults.map((result) => result.coverage.vectorId),
  );
  const stages = [
    ...modelStagesForAudit(input.priorVectorResults.map((result) => result.coverage)),
    ...input.priorEvidenceMapDrafts.flatMap((draft) =>
      terminalVectorIds.has(draft.vectorId) || draft.modelObservation === undefined
        ? []
        : [draft.modelObservation],
    ),
    ...input.priorSourcePostureDrafts.flatMap((draft) =>
      terminalVectorIds.has(draft.vectorId) || draft.modelObservation === undefined
        ? []
        : [draft.modelObservation],
    ),
    ...input.priorCandidateGroundingDrafts.flatMap((draft) =>
      terminalVectorIds.has(draft.vectorId)
        ? []
        : [draft.discoveryObservation, draft.modelObservation].filter(
            (stage): stage is ModelStageObservation => stage !== undefined,
          ),
    ),
    ...input.priorCandidateAwareCheckpoints.flatMap((checkpoint) => {
      if (terminalVectorIds.has(checkpoint.vectorId)) return [];
      if (checkpoint.result?.modelObservation !== undefined) {
        return [checkpoint.result.modelObservation];
      }
      return (
        checkpoint.contextOverflowTopology?.events.flatMap((event) =>
          event.modelObservation === undefined ? [] : [event.modelObservation],
        ) ?? []
      );
    }),
    ...reusableContextOverflowModelStages({
      ledgers: input.priorContextOverflowLedgers,
      terminalVectorResults: input.priorVectorResults,
      evidenceMapDrafts: input.priorEvidenceMapDrafts,
      sourcePostureDrafts: input.priorSourcePostureDrafts,
      candidateGroundingDrafts: input.priorCandidateGroundingDrafts,
    }),
  ];
  const byIdentity = new Map<string, ModelStageObservation>();
  for (const stage of stages) {
    const identity = `${stage.route}\0${stage.stage}\0${stage.stageId}`;
    const existing = byIdentity.get(identity);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(stage)) {
      throw new SecurityReviewerError(
        'artifact-invalid',
        'Reusable audit artifacts contain conflicting model-stage observations.',
      );
    }
    byIdentity.set(identity, stage);
  }
  return [...byIdentity.values()];
}

async function outputDirectory(
  options: Readonly<Record<string, string>>,
  runtime: RuntimeConfiguration,
): Promise<string> {
  const output = options.output ?? runtime.artifactDirectory;
  return ensureSafeOutputRoot(output);
}

export async function prepareProductRoots(input: {
  targetRoot: string;
  contextRoot?: string;
  outputRoot: string;
}): Promise<RootTopology> {
  const initial = await validateRootTopology({
    targetRoot: input.targetRoot,
    contextRoot: input.contextRoot,
    outputRoot: input.outputRoot,
  });
  await ensureSafeOutputRoot(initial.outputRoot);
  return validateRootTopology({
    targetRoot: initial.targetRoot,
    contextRoot: initial.contextRoot,
    outputRoot: initial.outputRoot,
  });
}

async function writeRunManifest(output: string, manifest: AuditRunManifest): Promise<void> {
  await writeJsonArtifact(output, `runs/${manifest.runId}.json`, AuditRunManifestSchema, manifest);
}

async function writeAuditRunAttempt(output: string, attempt: AuditRunAttempt): Promise<void> {
  await writeJsonArtifact(
    output,
    `runs/${attempt.runId}.attempt.json`,
    AuditRunAttemptSchema,
    attempt,
  );
}

function reportCounters(report: AuditReport): AuditRunManifest['counters'] {
  return classifyAuditTerminal(report).counters;
}

function auditCheckpointBinding(input: {
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
  vectorId: string;
}) {
  return createAuditCheckpointBinding({
    binding: {
      runId: input.runId,
      planId: input.plan.planId,
      targetFingerprint: input.plan.targetFingerprint,
      provider: input.provider,
      model: input.model,
      verificationRouteFingerprint: input.verificationRouteFingerprint,
      evidenceMapProtocolFingerprint: input.evidenceMapProtocolFingerprint,
      reviewWorkflowProtocolFingerprint: input.reviewWorkflowProtocolFingerprint,
    },
    plan: input.plan,
    vectorId: input.vectorId,
  });
}

/** A run is clean only when every planned vector reached a terminal clean coverage state. */
export function auditRunOutcome(report: AuditReport): AuditRunManifest['outcome'] {
  return classifyAuditTerminal(report).outcome;
}

async function writeAuditVectorCheckpoint(input: {
  output: string;
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
  result: AuditVectorResult;
}): Promise<void> {
  await writeJsonArtifact(
    input.output,
    auditCheckpointPath(input.runId, input.result.coverage.vectorId),
    AuditVectorCheckpointSchema,
    createAuditVectorCheckpoint({
      binding: {
        ...auditCheckpointBinding({
          ...input,
          vectorId: input.result.coverage.vectorId,
        }),
      },
      plan: input.plan,
      result: input.result,
      savedAt: new Date().toISOString(),
    }),
  );
}

async function writeAuditCandidateGroundingDraft(input: {
  output: string;
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
  candidateGroundingProtocolFingerprint: string;
  draft: Pick<
    z.infer<typeof AuditCandidateGroundingDraftSchema>,
    | 'vectorId'
    | 'findings'
    | 'closures'
    | 'hypothesisGroundingFunnel'
    | 'candidateIntegrityRejections'
    | 'discoveryObservation'
    | 'modelObservation'
  >;
}): Promise<void> {
  await writeJsonArtifact(
    input.output,
    auditCandidateGroundingDraftPath(input.runId, input.draft.vectorId),
    AuditCandidateGroundingDraftSchema,
    createAuditCandidateGroundingDraft({
      binding: {
        ...auditCheckpointBinding({ ...input, vectorId: input.draft.vectorId }),
      },
      candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
      plan: input.plan,
      findings: input.draft.findings,
      closures: input.draft.closures,
      hypothesisGroundingFunnel: input.draft.hypothesisGroundingFunnel,
      candidateIntegrityRejections: input.draft.candidateIntegrityRejections,
      ...(input.draft.discoveryObservation === undefined
        ? {}
        : { discoveryObservation: input.draft.discoveryObservation }),
      ...(input.draft.modelObservation === undefined
        ? {}
        : { modelObservation: input.draft.modelObservation }),
      savedAt: new Date().toISOString(),
    }),
  );
}

async function writeAuditCandidateAwareCheckpoint(input: {
  output: string;
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
  candidateGroundingProtocolFingerprint: string;
  update: CandidateAwareCheckpointUpdate;
}): Promise<void> {
  await writeJsonArtifact(
    input.output,
    auditCandidateAwareCheckpointPath({
      runId: input.runId,
      vectorId: input.update.vectorId,
      phase: input.update.phase,
      candidateOrdinal: input.update.candidateOrdinal,
    }),
    AuditCandidateAwareCheckpointSchema,
    createAuditCandidateAwareCheckpoint({
      binding: {
        ...auditCheckpointBinding({ ...input, vectorId: input.update.vectorId }),
      },
      candidateGroundingProtocolFingerprint: input.candidateGroundingProtocolFingerprint,
      plan: input.plan,
      phase: input.update.phase,
      candidateOrdinal: input.update.candidateOrdinal,
      candidate: input.update.candidate,
      state: input.update.state,
      ...(input.update.result === undefined ? {} : { result: input.update.result }),
      ...(input.update.contextOverflowTopology === undefined
        ? {}
        : { contextOverflowTopology: input.update.contextOverflowTopology }),
      savedAt: new Date().toISOString(),
    }),
  );
}

async function writeAuditEvidenceMapDraft(input: {
  output: string;
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
  draft: Pick<
    z.infer<typeof AuditEvidenceMapDraftSchema>,
    'vectorId' | 'evidenceMap' | 'modelObservation'
  >;
}): Promise<void> {
  await writeJsonArtifact(
    input.output,
    auditEvidenceMapDraftPath(input.runId, input.draft.vectorId),
    AuditEvidenceMapDraftSchema,
    createAuditEvidenceMapDraft({
      binding: {
        ...auditCheckpointBinding({ ...input, vectorId: input.draft.vectorId }),
      },
      plan: input.plan,
      evidenceMap: input.draft.evidenceMap,
      ...(input.draft.modelObservation === undefined
        ? {}
        : { modelObservation: input.draft.modelObservation }),
      savedAt: new Date().toISOString(),
    }),
  );
}

async function writeAuditSourcePostureDraft(input: {
  output: string;
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  provider: string;
  model: string;
  verificationRouteFingerprint: string;
  evidenceMapProtocolFingerprint: string;
  reviewWorkflowProtocolFingerprint: string;
  draft: Pick<
    z.infer<typeof AuditSourcePostureDraftSchema>,
    'vectorId' | 'sourcePosture' | 'modelObservation'
  >;
}): Promise<void> {
  await writeJsonArtifact(
    input.output,
    auditSourcePostureDraftPath(input.runId, input.draft.vectorId),
    AuditSourcePostureDraftSchema,
    createAuditSourcePostureDraft({
      binding: {
        ...auditCheckpointBinding({ ...input, vectorId: input.draft.vectorId }),
      },
      plan: input.plan,
      sourcePosture: input.draft.sourcePosture,
      ...(input.draft.modelObservation === undefined
        ? {}
        : { modelObservation: input.draft.modelObservation }),
      savedAt: new Date().toISOString(),
    }),
  );
}

async function readOptionalAuditVectorCheckpoint(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditVectorCheckpointSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditVectorCheckpointSchema);
}

async function readOptionalAuditCandidateGroundingDraft(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditCandidateGroundingDraftSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditCandidateGroundingDraftSchema);
}

async function readOptionalAuditCandidateAwareCheckpoint(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditCandidateAwareCheckpointSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditCandidateAwareCheckpointSchema);
}

async function readOptionalAuditEvidenceMapDraft(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditEvidenceMapDraftSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditEvidenceMapDraftSchema);
}

async function readOptionalAuditSourcePostureDraft(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditSourcePostureDraftSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditSourcePostureDraftSchema);
}

async function readOptionalAuditContextOverflowLedger(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditContextOverflowLedgerSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditContextOverflowLedgerSchema);
}

async function readOptionalAuditEvidenceMapRecoveryLeaf(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditEvidenceMapRecoveryLeafSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditEvidenceMapRecoveryLeafSchema);
}

async function readOptionalAuditSourcePostureRecoveryLeaf(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditSourcePostureRecoveryLeafSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditSourcePostureRecoveryLeafSchema);
}

async function readOptionalAuditCandidateGroundingRecoveryLeaf(
  output: string,
  artifactPath: string,
): Promise<z.infer<typeof AuditCandidateGroundingRecoveryLeafSchema> | undefined> {
  return readOptionalJsonArtifact(output, artifactPath, AuditCandidateGroundingRecoveryLeafSchema);
}

async function readOptionalAuditRunAttempt(
  output: string,
  runId: string,
): Promise<AuditRunAttempt | undefined> {
  return readOptionalJsonArtifact(output, `runs/${runId}.attempt.json`, AuditRunAttemptSchema);
}

export function assertAuditRunReuse(input: {
  resume: boolean;
  plan: z.infer<typeof AttackPlanSchema>;
  priorAttempt: AuditRunAttempt | undefined;
}): void {
  if (!input.resume && input.priorAttempt !== undefined) {
    throw usage(
      'The supplied run-id already has retained audit state; use resume=true or choose a new run-id.',
    );
  }
  if (input.resume && input.priorAttempt === undefined) {
    throw new SecurityReviewerError(
      'artifact-invalid',
      'Resuming an audit requires its retained attempt record.',
    );
  }
  const prior = input.priorAttempt;
  if (prior === undefined) return;
  if (
    prior.planId !== input.plan.planId ||
    prior.planDigest !== input.plan.planDigest ||
    prior.targetFingerprint !== input.plan.targetFingerprint
  ) {
    throw new SecurityReviewerError(
      'artifact-invalid',
      'The retained audit attempt does not match the executable plan.',
    );
  }
  if (input.resume && prior.status === 'completed') {
    throw new SecurityReviewerError(
      'artifact-invalid',
      'A completed audit cannot be resumed; start a new run instead.',
    );
  }
}

function booleanOption(
  options: Readonly<Record<string, string>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = options[key];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw usage(`${key} must be true or false.`);
}

function required(options: Readonly<Record<string, string>>, key: string): string {
  return requiredValue(options[key], key);
}

function requiredValue(value: string | undefined, key: string): string {
  if (value === undefined || value.length === 0) throw usage(`Missing required --${key} option.`);
  return value;
}

function usage(message: string): SecurityReviewerError {
  return new SecurityReviewerError(
    'invalid-input',
    `${message} Usage: security-reviewer <plan|audit|report|lineage> --key value`,
  );
}

/** Maps failures that prevented a report to the documented operational CI class. */
export function cliFailureExitCode(error: unknown): 2 | 4 {
  if (
    error instanceof SecurityReviewerError &&
    (error.code === 'provider-failure' ||
      error.code === 'provider-cancelled' ||
      error.code === 'provider-context-overflow' ||
      error.code === 'agent-loop-budget-exceeded')
  )
    return 4;
  return 2;
}

if (import.meta.main) {
  try {
    process.exitCode = await runCli(Bun.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    process.stderr.write(`security-reviewer: ${message}\n`);
    process.exitCode = cliFailureExitCode(error);
  }
}
