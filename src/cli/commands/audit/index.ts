import { basename } from 'node:path';
import type { ModelProvider } from '@purista/harness';
import type { z } from 'zod';
import { AttackPlanSchema, assertPlanIsSealed } from '../../../features/attack-planning/index.js';
import {
  type AuditRunAttempt,
  AuditRunAttemptSchema,
  type AuditRunManifest,
  classifyAuditTerminal,
  createAuditPersistenceAdapter,
  materializeVectorCoverageLimitations,
  writeAuditReportArtifacts,
} from '../../../features/audit-execution/index.js';
import {
  createPublicAuditReport,
  type PublicAuditReport,
  PublicAuditReportSchema,
  renderAuditReportMarkdown,
} from '../../../features/audit-report/index.js';
import {
  createReviewService,
  createVerificationRouteFingerprint,
  evidenceMapProtocolFingerprint,
  reviewWorkflowPromptProtocolFingerprint,
} from '../../../features/review-workflow/index.js';
import {
  createPrivateSourceCapture,
  discardRetainedTargetSnapshot,
  discardUnsealedPrivateSourceCapture,
  loadRetainedTargetSnapshot,
  privateSourceCaptureState,
  releaseTargetSnapshot,
  retainTargetSnapshot,
} from '../../../features/target-inventory/index.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  readOptionalJsonArtifact,
  removeArtifactDirectory,
  removeJsonArtifact,
  writeJsonArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import type { RootTopology } from '../../../platform/artifact-store/root-topology.js';
import type { RuntimeConfiguration } from '../../../platform/configuration/environment.js';
import { ProviderNameSchema, providerCacheRoutingKey } from '../../../platform/harness/provider.js';
import { canonicalJson, IdentifierSchema, sha256 } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import { commandExitMeaning, writeCliCommandResult } from '../../command-result.js';
import { booleanOption, requiredOption, usage } from '../../input.js';
import { writeRunManifest } from '../../run-manifest.js';

export type AuditCommandDependencies = Readonly<{
  runtime: RuntimeConfiguration;
  provider: ModelProvider;
  roots: RootTopology;
  providerName: string;
  model: string;
}>;

/** Discards only an exact stopped run after exclusive ownership and binding checks. */
export async function runDiscard(
  options: Readonly<Record<string, string>>,
  privateWork: string,
): Promise<number> {
  const runId = discardRunId(options);
  const plan = await readJsonArtifact(
    privateWork,
    requiredOption(options, 'plan'),
    AttackPlanSchema,
  );
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
  const parsed = IdentifierSchema.safeParse(requiredOption(options, 'run-id'));
  if (!parsed.success) throw usage('run-id must be a stable identifier.');
  return parsed.data;
}

export async function runAudit(
  options: Readonly<Record<string, string>>,
  dependencies: AuditCommandDependencies,
): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = options['run-id'] ?? `audit-${crypto.randomUUID()}`;
  const resume = booleanOption(options, 'resume', false);
  const retryUnfinished = booleanOption(options, 'retry-unfinished', false);
  if (resume && options['run-id'] === undefined) {
    throw usage('Resuming an audit requires an explicit --run-id.');
  }
  const targetRoot = dependencies.roots.targetRoot;
  const privateWork = dependencies.roots.privateWorkRoot;
  const publicArtifacts = dependencies.roots.publicArtifactRoot;
  const plan = await readJsonArtifact(
    privateWork,
    requiredOption(options, 'plan'),
    AttackPlanSchema,
  );
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`);
  const attemptStartedAt = startedAt;
  let terminalAttemptCommitted = false;
  let attemptLifecyclePersisted = false;
  let publicationIntentCommitted = false;
  let snapshotRetained = false;
  let preparedPublication: AuditRunAttempt['publicReport'] = null;
  let priorAttempt: AuditRunAttempt | undefined;
  try {
    priorAttempt = await readOptionalAuditRunAttempt(privateWork, runId);
    if (priorAttempt !== undefined) assertAuditRunAttemptBinding({ plan, attempt: priorAttempt });
    snapshotRetained =
      priorAttempt !== undefined &&
      auditAttemptRequiresRetainedSnapshot(priorAttempt.snapshotState);
    const resumedCapture = resume
      ? await recoverAuditResumeSourceCapture({
          privateWork,
          runId,
          plan,
          priorAttempt,
        })
      : undefined;
    if (resumedCapture !== undefined) {
      priorAttempt = resumedCapture.attempt;
      snapshotRetained = priorAttempt.snapshotState === 'retained';
    }
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
    attemptLifecyclePersisted = true;
    snapshotRetained = priorAttempt?.snapshotState === 'retained';
    const selectedModel = dependencies.model;
    const selectedProvider = dependencies.providerName;
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
    const retainedSnapshot =
      resumedCapture?.retainedSnapshot ??
      (resume
        ? await loadRetainedTargetSnapshot({
            outputRoot: privateWork,
            runId,
            targetFingerprint: plan.targetFingerprint,
            contextDigest: plan.contextDigest,
          })
        : undefined);
    const persistenceSession = await persistence.loadSession({
      resume,
      retryUnfinished,
    });
    const service = createReviewService(dependencies.provider, selectedModel, {
      maxParallelVectors: dependencies.runtime.maxParallelVectors,
      modelPricing: dependencies.runtime.modelPricing,
      modelCacheRoutingKey: providerCacheRoutingKey({
        provider: ProviderNameSchema.parse(selectedProvider),
        model: selectedModel,
      }),
    });
    const audited = await service.audit({
      targetRoot,
      contextRoot: dependencies.roots.contextRoot,
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
        const retained = await retainTargetSnapshot({
          outputRoot: privateWork,
          runId,
          capture,
        });
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
        identifiers: {
          runId,
          planId: plan.planId,
          reportId: publicReport.reportId,
        },
        artifacts: [
          {
            kind: 'report-json',
            path: `reports/${publicReport.reportId}.json`,
          },
          {
            kind: 'report-markdown',
            path: `reports/${publicReport.reportId}.md`,
          },
          { kind: 'run-manifest', path: `runs/${runId}.json` },
        ],
      },
      `Created report reports/${publicReport.reportId}.json and reports/${publicReport.reportId}.md with ${publicReport.findings.length} accepted findings.\n`,
    );
    return terminal.exitCode;
  } catch (error) {
    if (
      !terminalAttemptCommitted &&
      (attemptLifecyclePersisted ||
        !(
          resume &&
          priorAttempt !== undefined &&
          auditAttemptRequiresRetainedSnapshot(priorAttempt.snapshotState)
        ))
    ) {
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
        {
          kind: 'report-markdown',
          path: `reports/${publicReport.reportId}.md`,
        },
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
  assertAuditRunAttemptBinding({ plan: input.plan, attempt: prior });
  if (input.resume && prior.status === 'completed') {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A completed audit cannot be resumed; start a new run instead.',
    );
  }
}

/** Validates the immutable attempt binding before any exact-run lifecycle action. */
export function assertAuditRunAttemptBinding(input: {
  plan: z.infer<typeof AttackPlanSchema>;
  attempt: AuditRunAttempt;
}): void {
  const prior = input.attempt;
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
}

/**
 * Resolves only crash-left unsealed source bytes after the audit lease and
 * immutable attempt binding are both established. A missing required seal is
 * terminal: the audit never reopens a mutable target under the same run id.
 */
export async function recoverAuditResumeSourceCapture(input: {
  privateWork: string;
  runId: string;
  plan: z.infer<typeof AttackPlanSchema>;
  priorAttempt: AuditRunAttempt | undefined;
}): Promise<
  | Readonly<{
      attempt: AuditRunAttempt;
      retainedSnapshot: Awaited<ReturnType<typeof loadRetainedTargetSnapshot>> | undefined;
    }>
  | undefined
> {
  if (input.priorAttempt === undefined) return;
  const state = await privateSourceCaptureState({
    outputRoot: input.privateWork,
    captureId: input.runId,
  });
  const requiresRetainedSnapshot = auditAttemptRequiresRetainedSnapshot(
    input.priorAttempt.snapshotState,
  );
  if (requiresRetainedSnapshot) {
    if (state === 'retained') {
      return {
        attempt: input.priorAttempt,
        retainedSnapshot: await loadRetainedTargetSnapshot({
          outputRoot: input.privateWork,
          runId: input.runId,
          targetFingerprint: input.plan.targetFingerprint,
          contextDigest: input.plan.contextDigest,
        }),
      };
    }
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The retained audit attempt is missing its required immutable source snapshot.',
    );
  }
  if (state === 'retained' && input.priorAttempt.snapshotState === 'not-retained') {
    const retainedSnapshot = await loadRetainedTargetSnapshot({
      outputRoot: input.privateWork,
      runId: input.runId,
      targetFingerprint: input.plan.targetFingerprint,
      contextDigest: input.plan.contextDigest,
    });
    const attempt = AuditRunAttemptSchema.parse({
      ...input.priorAttempt,
      snapshotState: 'retained',
    });
    await writeAuditRunAttempt(input.privateWork, attempt);
    return { attempt, retainedSnapshot };
  }
  if (state === 'retained') {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The audit attempt has an unexpected retained source snapshot state.',
    );
  }
  if (state === 'unsealed') {
    await discardUnsealedPrivateSourceCapture({
      outputRoot: input.privateWork,
      captureId: input.runId,
    });
  }
  if (input.priorAttempt.snapshotState === 'not-retained') {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The audit run has no retained immutable source snapshot and cannot be resumed.',
    );
  }
  return { attempt: input.priorAttempt, retainedSnapshot: undefined };
}

function auditAttemptRequiresRetainedSnapshot(
  snapshotState: AuditRunAttempt['snapshotState'],
): boolean {
  return (
    snapshotState === 'retained' ||
    snapshotState === 'release-pending' ||
    snapshotState === 'release-failed'
  );
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
