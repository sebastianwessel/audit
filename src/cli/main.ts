#!/usr/bin/env bun

import { basename } from 'node:path';
import type { ModelProvider } from '@purista/harness';
import type { z } from 'zod';
import {
  AttackPlanDraftSchema,
  AttackPlanSchema,
  assertPlanIsSealed,
  createAttackPlanDraft,
  renderAttackPlanMarkdown,
  resealAttackPlanDraft,
} from '../features/attack-planning/index.js';
import {
  type AuditRunAttempt,
  AuditRunAttemptSchema,
  type AuditRunManifest,
  AuditRunManifestSchema,
  materializeVectorCoverageLimitations,
} from '../features/audit-execution/audit.schema.js';
import {
  createAuditPersistenceAdapter,
  writeAuditReportArtifacts,
} from '../features/audit-execution/cli-persistence.js';
import { classifyAuditTerminal } from '../features/audit-execution/terminal-classification.js';
import {
  AuditReportLineageSchema,
  createAuditReportLineage,
  renderAuditReportLineageMarkdown,
} from '../features/audit-lineage/index.js';
import {
  createPublicAuditReport,
  type PublicAuditReport,
  PublicAuditReportSchema,
} from '../features/audit-report/public-contract.js';
import { renderAuditReportMarkdown } from '../features/audit-report/report.js';
import {
  DeveloperGuidanceCheckpointSchema,
  DeveloperGuidanceReportSchema,
} from '../features/developer-guidance/guidance.schema.js';
import {
  createDeveloperGuidanceCheckpointBinding,
  createDeveloperGuidanceId,
  hasExactDeveloperGuidanceCheckpointBinding,
} from '../features/developer-guidance/identity.js';
import { developerGuidanceProtocolFingerprint } from '../features/developer-guidance/index.js';
import { renderDeveloperGuidanceMarkdown } from '../features/developer-guidance/report.js';
import {
  evidenceMapProtocolFingerprint,
  reviewWorkflowPromptProtocolFingerprint,
} from '../features/review-workflow/prompt-protocol.js';
import { createVerificationRouteFingerprint } from '../features/review-workflow/runtime/verification-route.js';
import {
  createReviewService,
  prepareDeveloperGuidanceTarget,
} from '../features/review-workflow/service.js';
import {
  createPrivateSourceCapture,
  discardRetainedTargetSnapshot,
  loadRetainedTargetSnapshot,
  releaseTargetSnapshot,
  retainTargetSnapshot,
} from '../features/target-inventory/index.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  readOptionalJsonArtifact,
  removeArtifactDirectory,
  removeJsonArtifact,
  writeJsonArtifact,
  writeNewJsonArtifact,
  writeNewMarkdownArtifact,
} from '../platform/artifact-store/json-artifact-store.js';
import {
  ensureSafeOutputRoot,
  type RootTopology,
  validateRootTopology,
} from '../platform/artifact-store/root-topology.js';
import {
  type LoadedRuntimeConfiguration,
  loadRuntimeConfiguration,
  type RuntimeConfiguration,
} from '../platform/configuration/environment.js';
import { assertAuditWorkflowStructuredOutputCompatibility } from '../platform/harness/audit-harness.js';
import {
  createConfiguredProvider,
  ProviderNameSchema,
  providerCacheRoutingKey,
} from '../platform/harness/provider.js';
import { canonicalJson, IdentifierSchema, sha256 } from '../shared/contracts/core.js';
import {
  AuditRuntimeError,
  isRetryableAuditRuntimeErrorCode,
} from '../shared/errors/audit-runtime-error.js';
import { isProductCliCommand, parseHelpRequest, renderCliHelp } from './command-catalog.js';
import { assertValidCommandOptions, type ProductCliCommand } from './command-options.js';
import { commandExitMeaning, writeCliCommandResult } from './command-result.js';

export type CliCommand = Readonly<{
  command: ProductCliCommand;
  options: Readonly<Record<string, string>>;
}>;

type CliRuntimeDependencies = Readonly<{
  loadRuntimeConfiguration?: () => Promise<LoadedRuntimeConfiguration>;
}>;

export function parseCliArguments(argv: readonly string[]): CliCommand {
  const command = argv[0];
  if (command === undefined || !isProductCliCommand(command))
    throw usage(
      'Expected one of: plan, plan-draft, plan-reseal, audit, guidance, discard, report, lineage.',
    );
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
  return { command, options };
}

export async function runCli(
  argv: readonly string[],
  dependencies: CliRuntimeDependencies = {},
): Promise<number> {
  const help = parseHelpRequest(argv);
  if (help !== undefined) {
    process.stdout.write(renderCliHelp(help));
    return 0;
  }
  const parsed = parseCliArguments(argv);
  assertValidCommandOptions(parsed.command, parsed.options);
  if (parsed.command === 'discard') {
    return runDiscard(parsed.options, await ensureSafeOutputRoot(required(parsed.options, 'work')));
  }
  if (parsed.command === 'plan-draft') return runPlanDraft(parsed.options);
  if (parsed.command === 'plan-reseal') return runPlanReseal(parsed.options);
  if (parsed.command === 'report') return runReport(parsed.options);
  if (parsed.command === 'lineage') return runLineage(parsed.options);
  const runtime = await (dependencies.loadRuntimeConfiguration ?? loadRuntimeConfiguration)();
  if (runtime.configuration.verificationMode === 'independent-route') {
    throw usage(
      'The independent verifier route is evaluation-only and cannot run product commands.',
    );
  }
  assertAuditWorkflowStructuredOutputCompatibility(
    ProviderNameSchema.parse(providerName(runtime.configuration)),
  );
  const roots = await prepareProductRoots({
    targetRoot: required(parsed.options, 'target'),
    contextRoot: parsed.options.context,
    publicArtifactRoot:
      parsed.options['public-output'] ?? runtime.configuration.publicArtifactDirectory,
    privateWorkRoot: parsed.options.work ?? runtime.configuration.privateWorkDirectory,
  });
  if (parsed.command === 'plan')
    return runPlan(
      parsed.options,
      runtime.configuration,
      createProvider(runtime.configuration, runtime.environment),
      roots,
    );
  if (parsed.command === 'guidance') {
    return runGuidance(parsed.options, runtime, roots);
  }
  return runAudit(
    parsed.options,
    runtime.configuration,
    createProvider(runtime.configuration, runtime.environment),
    roots,
  );
}

/** Discards only an exact stopped run after exclusive ownership and binding checks. */
async function runDiscard(
  options: Readonly<Record<string, string>>,
  privateWork: string,
): Promise<number> {
  const runId = discardRunId(options);
  const plan = await readJsonArtifact(privateWork, required(options, 'plan'), AttackPlanSchema);
  assertPlanIsSealed(plan);
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: {
      operation: 'audit-private-work-discard',
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
    },
  });
  try {
    const attempt = await readOptionalAuditRunAttempt(privateWork, runId);
    assertAuditRunDiscardBinding({ runId, plan, attempt });
    await discardRetainedTargetSnapshot({
      outputRoot: privateWork,
      runId,
      targetFingerprint: plan.targetFingerprint,
    });
    await removeArtifactDirectory(privateWork, `checkpoints/${runId}`);
    await removeJsonArtifact(privateWork, `runs/${runId}.attempt.json`);
  } finally {
    await lease.release();
  }
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'discard',
      status: 'discarded',
      exitCode: 0,
      exitMeaning: commandExitMeaning('discard', 0),
      identifiers: { runId, planId: plan.planId },
      artifacts: [],
    },
    `Discarded private work for audit run ${runId}.\n`,
  );
  return 0;
}

function discardRunId(options: Readonly<Record<string, string>>): string {
  const parsed = IdentifierSchema.safeParse(required(options, 'run-id'));
  if (!parsed.success) throw usage('run-id must be a stable identifier.');
  return parsed.data;
}

async function runGuidance(
  options: Readonly<Record<string, string>>,
  runtime: LoadedRuntimeConfiguration,
  roots: RootTopology,
): Promise<number> {
  const resume = booleanOption(options, 'resume', false);
  const retryUnfinished = booleanOption(options, 'retry-unfinished', false);
  if (resume && options['run-id'] === undefined) {
    throw usage('Resuming developer guidance requires an explicit --run-id.');
  }
  if (!resume && retryUnfinished) {
    throw usage('Retrying unfinished developer guidance requires --resume true.');
  }
  const privateWork = roots.privateWorkRoot;
  const publicArtifacts = roots.publicArtifactRoot;
  const plan = await readJsonArtifact(privateWork, required(options, 'plan'), AttackPlanSchema);
  const report = await readJsonArtifact(
    publicArtifacts,
    required(options, 'report'),
    PublicAuditReportSchema,
  );
  const targetDisplayName = options['target-name'] ?? basename(roots.targetRoot);
  const runId = options['run-id'] ?? `guidance-${crypto.randomUUID()}`;
  const retainedTarget = await prepareDeveloperGuidanceTarget({
    targetRoot: roots.targetRoot,
    contextRoot: roots.contextRoot,
    targetDisplayName,
    plan,
    report,
    sourceCapture: await createPrivateSourceCapture({ outputRoot: privateWork, captureId: runId }),
  });
  try {
    const selectedModel = model(runtime.configuration);
    const selectedProvider = providerName(runtime.configuration);
    const checkpointBinding = createDeveloperGuidanceCheckpointBinding({
      runId,
      plan,
      report,
      contextDigest: retainedTarget.inventory.contextDigest,
      provider: selectedProvider,
      model: selectedModel,
      protocolFingerprint: developerGuidanceProtocolFingerprint,
    });
    const checkpointPath = `guidance-checkpoints/${createDeveloperGuidanceId(report.reportId, runId)}.json`;
    const recoveredCheckpoint = await readOptionalJsonArtifact(
      privateWork,
      checkpointPath,
      DeveloperGuidanceCheckpointSchema,
    );
    if (!resume && recoveredCheckpoint !== undefined) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'A developer-guidance checkpoint already exists; resume the exact run explicitly.',
      );
    }
    if (resume && recoveredCheckpoint === undefined) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'Developer guidance resume requires an existing exact-run checkpoint.',
      );
    }
    if (
      recoveredCheckpoint !== undefined &&
      !hasExactDeveloperGuidanceCheckpointBinding(recoveredCheckpoint.binding, checkpointBinding)
    ) {
      throw new AuditRuntimeError(
        'artifact-invalid',
        'The developer-guidance checkpoint does not match the requested run identity.',
      );
    }
    const guidanceArtifactPath = `guidance/${createDeveloperGuidanceId(report.reportId, runId)}.json`;
    const existingGuidance = await readOptionalJsonArtifact(
      privateWork,
      guidanceArtifactPath,
      DeveloperGuidanceReportSchema,
    );
    if (existingGuidance !== undefined) {
      if (
        !resume ||
        existingGuidance.runId !== runId ||
        existingGuidance.reportId !== report.reportId ||
        existingGuidance.reportDigest !== checkpointBinding.reportDigest ||
        existingGuidance.planId !== plan.planId ||
        existingGuidance.planDigest !== plan.planDigest ||
        existingGuidance.targetFingerprint !== retainedTarget.inventory.targetFingerprint ||
        existingGuidance.contextDigest !== retainedTarget.inventory.contextDigest ||
        existingGuidance.items.some((item) => item.status !== 'completed')
      ) {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'The developer-guidance artifact is not a completed result for the exact resumed run.',
        );
      }
      writeCliCommandResult(
        options,
        {
          schemaVersion: 1,
          command: 'guidance',
          status: 'completed',
          exitCode: 0,
          exitMeaning: commandExitMeaning('guidance', 0),
          identifiers: {
            runId,
            planId: plan.planId,
            reportId: report.reportId,
            guidanceId: existingGuidance.guidanceId,
          },
          artifacts: [
            { kind: 'guidance-json', path: guidanceArtifactPath },
            { kind: 'guidance-markdown', path: `guidance/${existingGuidance.guidanceId}.md` },
          ],
        },
        `Reused completed non-gating developer guidance ${guidanceArtifactPath}.\n`,
      );
      return 0;
    }
    const provider = createProvider(runtime.configuration, runtime.environment);
    const service = createReviewService(provider, selectedModel, {
      modelPricing: selectedModelPricing(runtime.configuration),
      modelCacheRoutingKey: providerCacheRoutingKey({
        provider: ProviderNameSchema.parse(selectedProvider),
        model: selectedModel,
      }),
    });
    const created = await service.createDeveloperGuidance({
      targetRoot: roots.targetRoot,
      contextRoot: roots.contextRoot,
      targetDisplayName,
      plan,
      report,
      retainedTarget,
      recoveredCheckpoint,
      retryUnfinished,
      onCheckpoint: async (state) =>
        writeJsonArtifact(privateWork, checkpointPath, DeveloperGuidanceCheckpointSchema, {
          schemaVersion: 3,
          binding: checkpointBinding,
          generatedAt: new Date().toISOString(),
          attempts: [...state.attempts],
        }),
      runId,
      generatedAt: new Date().toISOString(),
      sessionId: runId,
    });
    if (created.guidance.items.some((item) => item.status !== 'completed')) {
      process.stdout.write(
        `Developer guidance for run ${runId} remains incomplete. Resume with --run-id ${runId} --resume true --retry-unfinished true.\n`,
      );
      return 0;
    }
    await writeNewJsonArtifact(
      privateWork,
      guidanceArtifactPath,
      DeveloperGuidanceReportSchema,
      created.guidance,
    );
    await writeNewMarkdownArtifact(
      privateWork,
      `guidance/${created.guidance.guidanceId}.md`,
      renderDeveloperGuidanceMarkdown(created.guidance),
    );
    writeCliCommandResult(
      options,
      {
        schemaVersion: 1,
        command: 'guidance',
        status: 'completed',
        exitCode: 0,
        exitMeaning: commandExitMeaning('guidance', 0),
        identifiers: {
          runId,
          planId: plan.planId,
          reportId: report.reportId,
          guidanceId: created.guidance.guidanceId,
        },
        artifacts: [
          { kind: 'guidance-json', path: guidanceArtifactPath },
          { kind: 'guidance-markdown', path: `guidance/${created.guidance.guidanceId}.md` },
        ],
      },
      `Created non-gating developer guidance guidance/${created.guidance.guidanceId}.json and guidance/${created.guidance.guidanceId}.md for ${created.guidance.items.length} accepted findings.\n`,
    );
    return 0;
  } finally {
    await retainedTarget.release?.();
  }
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
  const privateWork = roots.privateWorkRoot;
  const selectedModel = model(runtime);
  const service = createReviewService(provider, selectedModel, {
    maxParallelVectors: maxParallelVectors(runtime),
    modelPricing: selectedModelPricing(runtime),
    modelCacheRoutingKey: providerCacheRoutingKey({
      provider: ProviderNameSchema.parse(providerName(runtime)),
      model: selectedModel,
    }),
  });
  const created = await service.createPlan({
    targetRoot,
    contextRoot: roots.contextRoot,
    targetDisplayName: options['target-name'] ?? basename(targetRoot),
    createdAt: startedAt,
    sessionId: runId,
    sourceCapture: await createPrivateSourceCapture({ outputRoot: privateWork, captureId: runId }),
  });
  await writeNewJsonArtifact(
    privateWork,
    `plans/${created.plan.planId}.json`,
    AttackPlanSchema,
    created.plan,
  );
  await writeNewMarkdownArtifact(
    privateWork,
    `plans/${created.plan.planId}.md`,
    renderAttackPlanMarkdown(created.plan),
  );
  await writeRunManifest(privateWork, {
    schemaVersion: 2,
    runId,
    command: 'plan',
    startedAt,
    finishedAt: new Date().toISOString(),
    targetFingerprint: created.inventory.targetFingerprint,
    planId: created.plan.planId,
    provider: providerName(runtime),
    model: selectedModel,
    outcome: 'completed',
    counters: {
      plannedVectors: created.plan.vectors.length,
      completedVectors: 0,
      failedVectors: 0,
      findingCount: 0,
    },
    modelObservation: created.modelObservation,
  });
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'plan',
      status: 'completed',
      exitCode: 0,
      exitMeaning: commandExitMeaning('plan', 0),
      identifiers: { runId, planId: created.plan.planId },
      artifacts: [
        { kind: 'plan-json', path: `plans/${created.plan.planId}.json` },
        { kind: 'plan-markdown', path: `plans/${created.plan.planId}.md` },
        { kind: 'run-manifest', path: `runs/${runId}.json` },
      ],
    },
    `Created executable plan plans/${created.plan.planId}.json and review projection plans/${created.plan.planId}.md for ${created.inventory.summary.fileCount} files.\n`,
  );
  return 0;
}

/** Creates a constrained editable draft without opening a target or calling a provider. */
async function runPlanDraft(options: Readonly<Record<string, string>>): Promise<number> {
  const privateWork = await ensureSafeOutputRoot(required(options, 'work'));
  const plan = await readJsonArtifact(privateWork, required(options, 'plan'), AttackPlanSchema);
  const draft = createAttackPlanDraft(plan);
  const draftPath = required(options, 'draft');
  await writeNewJsonArtifact(privateWork, draftPath, AttackPlanDraftSchema, draft);
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'plan-draft',
      status: 'completed',
      exitCode: 0,
      exitMeaning: commandExitMeaning('plan-draft', 0),
      identifiers: { planId: plan.planId },
      artifacts: [{ kind: 'plan-draft', path: draftPath }],
    },
    `Created editable plan draft ${draftPath} from ${plan.planId}.\n`,
  );
  return 0;
}

/** Validates a constrained edit and publishes a new immutable executable plan pair. */
async function runPlanReseal(options: Readonly<Record<string, string>>): Promise<number> {
  const privateWork = await ensureSafeOutputRoot(required(options, 'work'));
  const basePlan = await readJsonArtifact(privateWork, required(options, 'plan'), AttackPlanSchema);
  const draft = await readJsonArtifact(
    privateWork,
    required(options, 'draft'),
    AttackPlanDraftSchema,
  );
  const plan = resealAttackPlanDraft({ basePlan, draft, resealedAt: new Date().toISOString() });
  await writeNewJsonArtifact(privateWork, `plans/${plan.planId}.json`, AttackPlanSchema, plan);
  await writeNewMarkdownArtifact(
    privateWork,
    `plans/${plan.planId}.md`,
    renderAttackPlanMarkdown(plan),
  );
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'plan-reseal',
      status: 'completed',
      exitCode: 0,
      exitMeaning: commandExitMeaning('plan-reseal', 0),
      identifiers: { planId: plan.planId },
      artifacts: [
        { kind: 'plan-json', path: `plans/${plan.planId}.json` },
        { kind: 'plan-markdown', path: `plans/${plan.planId}.md` },
      ],
    },
    `Resealed executable plan plans/${plan.planId}.json and review projection plans/${plan.planId}.md.\n`,
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
  const privateWork = roots.privateWorkRoot;
  const publicArtifacts = roots.publicArtifactRoot;
  const plan = await readJsonArtifact(privateWork, required(options, 'plan'), AttackPlanSchema);
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`);
  const attemptStartedAt = startedAt;
  let terminalAttemptCommitted = false;
  let publicationIntentCommitted = false;
  let snapshotRetained = false;
  let preparedPublication: AuditRunAttempt['publicReport'] = null;
  try {
    const priorAttempt = await readOptionalAuditRunAttempt(privateWork, runId);
    if (resume && priorAttempt?.status === 'completed') {
      return resumeCompletedAuditAttempt({
        privateWork,
        publicArtifacts,
        attempt: priorAttempt,
        options,
      });
    }
    assertAuditRunReuse({ resume, plan, priorAttempt });
    if (
      resume &&
      priorAttempt?.publicationState === 'published' &&
      priorAttempt.publicReport !== null
    ) {
      await assertPublishedAuditAttemptBinding({
        publicArtifacts,
        publicReport: priorAttempt.publicReport,
      });
    }
    await writeAuditRunAttempt(privateWork, {
      schemaVersion: 3,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: attemptStartedAt,
      finishedAt: null,
      status: 'starting',
      publicReport: null,
      publicationState: 'not-prepared',
      snapshotState: priorAttempt?.snapshotState === 'retained' ? 'retained' : 'not-retained',
    });
    snapshotRetained = priorAttempt?.snapshotState === 'retained';
    const selectedModel = model(runtime);
    const selectedProvider = providerName(runtime);
    const verificationRouteFingerprint = createVerificationRouteFingerprint({
      route: 'primary',
      provider: selectedProvider,
      model: selectedModel,
    });
    const persistence = createAuditPersistenceAdapter({
      privateWork,
      runId,
      plan,
      provider: selectedProvider,
      model: selectedModel,
      verificationRouteFingerprint,
      evidenceMapProtocolFingerprint,
      reviewWorkflowProtocolFingerprint: reviewWorkflowPromptProtocolFingerprint,
    });
    const retainedSnapshot = resume
      ? await loadRetainedTargetSnapshot({
          outputRoot: privateWork,
          runId,
          targetFingerprint: plan.targetFingerprint,
          contextDigest: plan.contextDigest,
        })
      : undefined;
    const persistenceSession = await persistence.loadSession({ resume, retryUnfinished });
    const service = createReviewService(provider, selectedModel, {
      maxParallelVectors: maxParallelVectors(runtime),
      modelPricing: selectedModelPricing(runtime),
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
      resumeState: persistenceSession.resumeState,
      retryUnfinished,
      retainedSnapshot,
      ...(resume
        ? {}
        : {
            sourceCapture: await createPrivateSourceCapture({
              outputRoot: privateWork,
              captureId: runId,
            }),
          }),
      onSnapshotCaptured: async (capture) => {
        const retained = await retainTargetSnapshot({ outputRoot: privateWork, runId, capture });
        snapshotRetained = true;
        await writeAuditRunAttempt(privateWork, {
          schemaVersion: 3,
          runId,
          planId: plan.planId,
          planDigest: plan.planDigest,
          targetFingerprint: plan.targetFingerprint,
          startedAt: attemptStartedAt,
          finishedAt: null,
          status: 'starting',
          publicReport: null,
          publicationState: 'not-prepared',
          snapshotState: 'retained',
        });
        return retained;
      },
      ...persistenceSession.callbacks,
    });
    const durableReport = {
      ...audited.report,
      coverage: audited.report.coverage.map((coverage) => ({
        ...coverage,
        limitations: materializeVectorCoverageLimitations(coverage.limitations),
      })),
    };
    const publicReport = createPublicAuditReport(durableReport, plan);
    preparedPublication = {
      reportId: publicReport.reportId,
      reportDigest: sha256(canonicalJson(publicReport)),
    };
    await writeAuditRunAttempt(privateWork, {
      schemaVersion: 3,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: attemptStartedAt,
      finishedAt: null,
      status: 'starting',
      publicReport: preparedPublication,
      publicationState: 'prepared',
      snapshotState: 'retained',
    });
    publicationIntentCommitted = true;
    await writeAuditReportArtifacts({
      publicArtifacts,
      report: publicReport,
      markdown: renderAuditReportMarkdown(publicReport),
    });
    await writeRunManifest(publicArtifacts, {
      schemaVersion: 2,
      runId,
      command: 'audit',
      startedAt,
      finishedAt: new Date().toISOString(),
      targetFingerprint: audited.inventory.targetFingerprint,
      planId: audited.report.planId,
      provider: selectedProvider,
      model: selectedModel,
      outcome: auditRunOutcome(publicReport),
      counters: reportCounters(publicReport),
      modelObservation: audited.modelObservation,
    });
    const terminal = classifyAuditTerminal(durableReport);
    const terminalAttempt: AuditRunAttempt = {
      schemaVersion: 3,
      runId,
      planId: plan.planId,
      planDigest: plan.planDigest,
      targetFingerprint: plan.targetFingerprint,
      startedAt: attemptStartedAt,
      finishedAt: new Date().toISOString(),
      status: terminal.outcome === 'completed' ? 'completed' : 'partial',
      publicReport: preparedPublication,
      publicationState: 'published',
      snapshotState: terminal.outcome === 'completed' ? 'release-pending' : 'retained',
    };
    await writeAuditRunAttempt(privateWork, terminalAttempt);
    terminalAttemptCommitted = true;
    if (terminal.outcome === 'completed') {
      try {
        await releaseTargetSnapshot({
          outputRoot: privateWork,
          runId,
          targetFingerprint: plan.targetFingerprint,
        });
        await writeAuditRunAttempt(privateWork, {
          ...terminalAttempt,
          snapshotState: 'released',
        });
      } catch {
        await writeAuditRunAttempt(privateWork, {
          ...terminalAttempt,
          snapshotState: 'release-failed',
        });
      }
    }
    writeCliCommandResult(
      options,
      {
        schemaVersion: 1,
        command: 'audit',
        status: terminal.outcome === 'completed' ? 'completed' : 'partial',
        exitCode: terminal.exitCode,
        exitMeaning: commandExitMeaning('audit', terminal.exitCode),
        identifiers: { runId, planId: plan.planId, reportId: publicReport.reportId },
        artifacts: [
          { kind: 'report-json', path: `reports/${publicReport.reportId}.json` },
          { kind: 'report-markdown', path: `reports/${publicReport.reportId}.md` },
          { kind: 'run-manifest', path: `runs/${runId}.json` },
        ],
      },
      `Created report reports/${publicReport.reportId}.json and reports/${publicReport.reportId}.md with ${publicReport.findings.length} accepted findings.\n`,
    );
    return terminal.exitCode;
  } catch (error) {
    if (!terminalAttemptCommitted) {
      await writeAuditRunAttempt(privateWork, {
        schemaVersion: 3,
        runId,
        planId: plan.planId,
        planDigest: plan.planDigest,
        targetFingerprint: plan.targetFingerprint,
        startedAt: attemptStartedAt,
        finishedAt: new Date().toISOString(),
        status: 'failed',
        publicReport: preparedPublication,
        publicationState: publicationIntentCommitted ? 'prepared' : 'not-prepared',
        snapshotState: snapshotRetained ? 'retained' : 'not-retained',
      });
    }
    throw error;
  } finally {
    await lease.release();
  }
}

async function runReport(options: Readonly<Record<string, string>>): Promise<number> {
  const startedAt = new Date().toISOString();
  const publicArtifacts = await ensureSafeOutputRoot(required(options, 'public-output'));
  const report = await readJsonArtifact(
    publicArtifacts,
    required(options, 'report'),
    PublicAuditReportSchema,
  );
  const terminal = classifyAuditTerminal(report);
  const runId = `report-${crypto.randomUUID()}`;
  await writeRunManifest(publicArtifacts, {
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
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'report',
      status: terminal.outcome === 'completed' ? 'completed' : 'partial',
      exitCode: terminal.exitCode,
      exitMeaning: commandExitMeaning('report', terminal.exitCode),
      identifiers: { runId, planId: report.planId, reportId: report.reportId },
      artifacts: [
        { kind: 'report-json', path: required(options, 'report') },
        { kind: 'run-manifest', path: `runs/${runId}.json` },
      ],
    },
    renderAuditReportMarkdown(report),
  );
  return terminal.exitCode;
}

async function runLineage(options: Readonly<Record<string, string>>): Promise<number> {
  const publicArtifacts = await ensureSafeOutputRoot(required(options, 'public-output'));
  const previous = await readJsonArtifact(
    publicArtifacts,
    required(options, 'previous'),
    PublicAuditReportSchema,
  );
  const current = await readJsonArtifact(
    publicArtifacts,
    required(options, 'current'),
    PublicAuditReportSchema,
  );
  const lineage = createAuditReportLineage({
    previous,
    current,
    generatedAt: new Date().toISOString(),
  });
  await writeJsonArtifact(
    publicArtifacts,
    `lineage/${lineage.lineageId}.json`,
    AuditReportLineageSchema,
    lineage,
  );
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'lineage',
      status: 'completed',
      exitCode: 0,
      exitMeaning: commandExitMeaning('lineage', 0),
      identifiers: { lineageId: lineage.lineageId },
      artifacts: [{ kind: 'lineage-json', path: `lineage/${lineage.lineageId}.json` }],
    },
    renderAuditReportLineageMarkdown(lineage),
  );
  return 0;
}

function createProvider(
  runtime: RuntimeConfiguration,
  environment: Readonly<Record<string, string | undefined>>,
): ModelProvider {
  const provider = providerName(runtime);
  return createConfiguredProvider({
    provider: ProviderNameSchema.parse(provider),
    apiKeyEnvironmentVariable: runtime.apiKeyEnvironmentVariable,
    environment,
  });
}

function providerName(runtime: RuntimeConfiguration): string {
  return requiredValue(runtime.provider, 'provider');
}

function model(runtime: RuntimeConfiguration): string {
  return requiredValue(runtime.model, 'model');
}

function selectedModelPricing(runtime: RuntimeConfiguration) {
  return runtime.modelPricing;
}

function maxParallelVectors(runtime: RuntimeConfiguration): number {
  return runtime.maxParallelVectors;
}

export async function prepareProductRoots(input: {
  targetRoot: string;
  contextRoot?: string;
  publicArtifactRoot: string;
  privateWorkRoot: string;
}): Promise<RootTopology> {
  const initial = await validateRootTopology({
    targetRoot: input.targetRoot,
    contextRoot: input.contextRoot,
    publicArtifactRoot: input.publicArtifactRoot,
    privateWorkRoot: input.privateWorkRoot,
  });
  await ensureSafeOutputRoot(initial.publicArtifactRoot);
  await ensureSafeOutputRoot(initial.privateWorkRoot);
  return validateRootTopology({
    targetRoot: initial.targetRoot,
    contextRoot: initial.contextRoot,
    publicArtifactRoot: initial.publicArtifactRoot,
    privateWorkRoot: initial.privateWorkRoot,
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

function reportCounters(
  report: Pick<PublicAuditReport, 'coverage' | 'findings' | 'reviewRequired' | 'errors'>,
): AuditRunManifest['counters'] {
  return classifyAuditTerminal(report).counters;
}

/** A run is clean only when every planned vector reached a terminal clean coverage state. */
export function auditRunOutcome(
  report: Pick<PublicAuditReport, 'coverage' | 'findings' | 'reviewRequired' | 'errors'>,
): AuditRunManifest['outcome'] {
  return classifyAuditTerminal(report).outcome;
}

async function readOptionalAuditRunAttempt(
  output: string,
  runId: string,
): Promise<AuditRunAttempt | undefined> {
  return readOptionalJsonArtifact(output, `runs/${runId}.attempt.json`, AuditRunAttemptSchema);
}

/** Rejects resume when a private terminal record no longer binds its public report exactly. */
async function assertPublishedAuditAttemptBinding(input: {
  publicArtifacts: string;
  publicReport: NonNullable<AuditRunAttempt['publicReport']>;
}): Promise<PublicAuditReport> {
  const report = await readJsonArtifact(
    input.publicArtifacts,
    `reports/${input.publicReport.reportId}.json`,
    PublicAuditReportSchema,
  );
  if (sha256(canonicalJson(report)) !== input.publicReport.reportDigest) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The retained audit attempt does not match its published public report.',
    );
  }
  return report;
}

/** Reuses an already committed terminal result and retries only operational snapshot cleanup. */
async function resumeCompletedAuditAttempt(input: {
  privateWork: string;
  publicArtifacts: string;
  attempt: AuditRunAttempt;
  options: Readonly<Record<string, string>>;
}): Promise<number> {
  if (input.attempt.publicReport === null) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A completed audit attempt is missing its published public report binding.',
    );
  }
  const publicReport = await assertPublishedAuditAttemptBinding({
    publicArtifacts: input.publicArtifacts,
    publicReport: input.attempt.publicReport,
  });
  if (
    input.attempt.snapshotState === 'release-pending' ||
    input.attempt.snapshotState === 'release-failed'
  ) {
    try {
      await releaseTargetSnapshot({
        outputRoot: input.privateWork,
        runId: input.attempt.runId,
        targetFingerprint: input.attempt.targetFingerprint,
      });
      await writeAuditRunAttempt(input.privateWork, {
        ...input.attempt,
        snapshotState: 'released',
      });
    } catch {
      await writeAuditRunAttempt(input.privateWork, {
        ...input.attempt,
        snapshotState: 'release-failed',
      });
    }
  }
  const exitCode = auditRunOutcome(publicReport) === 'completed' ? 0 : 3;
  writeCliCommandResult(
    input.options,
    {
      schemaVersion: 1,
      command: 'audit',
      status: exitCode === 0 ? 'completed' : 'partial',
      exitCode,
      exitMeaning: commandExitMeaning('audit', exitCode),
      identifiers: {
        runId: input.attempt.runId,
        planId: publicReport.planId,
        reportId: publicReport.reportId,
      },
      artifacts: [
        { kind: 'report-json', path: `reports/${publicReport.reportId}.json` },
        { kind: 'report-markdown', path: `reports/${publicReport.reportId}.md` },
        { kind: 'run-manifest', path: `runs/${input.attempt.runId}.json` },
      ],
    },
    `Reused completed report reports/${publicReport.reportId}.json.\n`,
  );
  return exitCode;
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
    throw new AuditRuntimeError(
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
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The retained audit attempt does not match the executable plan.',
    );
  }
  if (input.resume && prior.status === 'completed') {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A completed audit cannot be resumed; start a new run instead.',
    );
  }
}

/** Rejects every incomplete or plan-mismatched identity before private deletion. */
export function assertAuditRunDiscardBinding(input: {
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  attempt: AuditRunAttempt | undefined;
}): asserts input is {
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  attempt: AuditRunAttempt;
} {
  const attempt = input.attempt;
  if (attempt === undefined) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'Discarding private audit work requires its retained immutable attempt record.',
    );
  }
  if (
    attempt.runId !== input.runId ||
    attempt.planId !== input.plan.planId ||
    attempt.planDigest !== input.plan.planDigest ||
    attempt.targetFingerprint !== input.plan.targetFingerprint
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The retained audit attempt does not match the supplied exact discard binding.',
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

function usage(message: string): AuditRuntimeError {
  return new AuditRuntimeError(
    'invalid-input',
    `${message} Run \`audit --help\` to list commands and \`audit help <command>\` for exact usage.`,
  );
}

/** Maps failures that prevented a report to the documented operational CI class. */
export function cliFailureExitCode(error: unknown): 2 | 4 {
  if (
    error instanceof AuditRuntimeError &&
    (isRetryableAuditRuntimeErrorCode(error.code) ||
      error.code === 'provider-http-error' ||
      error.code === 'provider-response-invalid' ||
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
    process.stderr.write(`audit: ${message}\n`);
    process.exitCode = cliFailureExitCode(error);
  }
}
