import { basename } from 'node:path';
import type { ModelProvider } from '@purista/harness';
import {
  AttackPlanDraftSchema,
  AttackPlanSchema,
  assertNoPlanPublicationIntent,
  beginPlanPublication,
  completePlanPublication,
  createAttackPlanDraft,
  createPlanPublicationIntent,
  resealAttackPlanDraft,
  resumePlanPublication,
} from '../../../features/attack-planning/index.js';
import { createReviewService } from '../../../features/review-workflow/index.js';
import { createPrivateSourceCapture } from '../../../features/target-inventory/index.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  writeNewJsonArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import type { RootTopology } from '../../../platform/artifact-store/root-topology.js';
import type { RuntimeConfiguration } from '../../../platform/configuration/environment.js';
import { ProviderNameSchema, providerCacheRoutingKey } from '../../../platform/harness/provider.js';
import { IdentifierSchema } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import { commandExitMeaning, writeCliCommandResult } from '../../command-result.js';
import { booleanOption, requiredOption, usage } from '../../input.js';
import { createSimpleProductLeaseMetadata } from '../../product-lease.js';

export type PlanningCommandDependencies = Readonly<{
  runtime: RuntimeConfiguration;
  provider: ModelProvider;
  roots: RootTopology;
  providerName: string;
  model: string;
}>;

export async function runPlan(
  options: Readonly<Record<string, string>>,
  dependencies: PlanningCommandDependencies,
): Promise<number> {
  const startedAt = new Date().toISOString();
  const runId = IdentifierSchema.parse(options['run-id'] ?? `plan-${crypto.randomUUID()}`);
  if (booleanOption(options, 'resume', false)) {
    throw new AuditRuntimeError(
      'invalid-input',
      'Plan publication resume must be dispatched before provider construction.',
    );
  }
  const targetRoot = dependencies.roots.targetRoot;
  const privateWork = dependencies.roots.privateWorkRoot;
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: createSimpleProductLeaseMetadata({ operation: 'plan', runId }),
  });
  try {
    await assertNoPlanPublicationIntent(privateWork, runId);
    const selectedModel = dependencies.model;
    const service = createReviewService(dependencies.provider, selectedModel, {
      maxParallelVectors: dependencies.runtime.maxParallelVectors,
      modelPricing: dependencies.runtime.modelPricing,
      modelCacheRoutingKey: providerCacheRoutingKey({
        provider: ProviderNameSchema.parse(dependencies.providerName),
        model: selectedModel,
      }),
    });
    const created = await service.createPlan({
      targetRoot,
      contextRoot: dependencies.roots.contextRoot,
      targetDisplayName: options['target-name'] ?? basename(targetRoot),
      createdAt: startedAt,
      sessionId: runId,
      sourceCapture: await createPrivateSourceCapture({
        outputRoot: privateWork,
        captureId: runId,
      }),
    });
    const intent = createPlanPublicationIntent({
      command: 'plan',
      runId,
      plan: created.plan,
      runManifest: {
        schemaVersion: 2,
        runId,
        command: 'plan',
        startedAt,
        finishedAt: new Date().toISOString(),
        targetFingerprint: created.inventory.targetFingerprint,
        planId: created.plan.planId,
        provider: dependencies.providerName,
        model: selectedModel,
        outcome: 'completed',
        counters: {
          plannedVectors: created.plan.vectors.length,
          completedVectors: 0,
          failedVectors: 0,
          findingCount: 0,
        },
        modelObservation: created.modelObservation,
      },
    });
    await beginPlanPublication(privateWork, intent);
    await completePlanPublication(privateWork, intent);
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
          { kind: 'plan-json', path: intent.planJsonPath },
          { kind: 'plan-markdown', path: intent.planMarkdownPath },
          { kind: 'run-manifest', path: `runs/${runId}.json` },
        ],
      },
      `Created executable plan ${intent.planJsonPath} and review projection ${intent.planMarkdownPath} for ${created.inventory.summary.fileCount} files.\n`,
    );
    return 0;
  } finally {
    await lease.release();
  }
}

/** Recovers one exact plan publication without opening a target or constructing a provider. */
export async function runPlanPublicationRecovery(
  options: Readonly<Record<string, string>>,
  privateWork: string,
): Promise<number> {
  if (!booleanOption(options, 'resume', false)) {
    throw usage('Plan publication recovery requires --resume true.');
  }
  const runId = IdentifierSchema.parse(requiredOption(options, 'run-id'));
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: createSimpleProductLeaseMetadata({ operation: 'plan', runId }),
  });
  try {
    const intent = await resumePlanPublication({ privateWork, command: 'plan', runId });
    writeCliCommandResult(
      options,
      {
        schemaVersion: 1,
        command: 'plan',
        status: 'completed',
        exitCode: 0,
        exitMeaning: commandExitMeaning('plan', 0),
        identifiers: { runId, planId: intent.planId },
        artifacts: [
          { kind: 'plan-json', path: intent.planJsonPath },
          { kind: 'plan-markdown', path: intent.planMarkdownPath },
          ...(intent.runManifest === null
            ? []
            : [{ kind: 'run-manifest' as const, path: `runs/${runId}.json` }]),
        ],
      },
      `Recovered executable plan ${intent.planJsonPath} and review projection ${intent.planMarkdownPath}.\n`,
    );
    return 0;
  } finally {
    await lease.release();
  }
}

/** Creates a constrained editable draft without opening a target or calling a provider. */
export async function runPlanDraft(
  options: Readonly<Record<string, string>>,
  privateWork: string,
): Promise<number> {
  const plan = await readJsonArtifact(
    privateWork,
    requiredOption(options, 'plan'),
    AttackPlanSchema,
  );
  const draft = createAttackPlanDraft(plan);
  const draftPath = requiredOption(options, 'draft');
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
export async function runPlanReseal(
  options: Readonly<Record<string, string>>,
  privateWork: string,
): Promise<number> {
  const resume = booleanOption(options, 'resume', false);
  if (resume && options['run-id'] === undefined) {
    throw usage('Resuming plan publication requires an explicit --run-id.');
  }
  const runId = IdentifierSchema.parse(options['run-id'] ?? `plan-reseal-${crypto.randomUUID()}`);
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: createSimpleProductLeaseMetadata({ operation: 'plan-reseal', runId }),
  });
  try {
    if (resume) {
      const intent = await resumePlanPublication({ privateWork, command: 'plan-reseal', runId });
      return writeRecoveredResealedPlanResult(options, intent, runId);
    }
    await assertNoPlanPublicationIntent(privateWork, runId);
    const basePlan = await readJsonArtifact(
      privateWork,
      requiredOption(options, 'plan'),
      AttackPlanSchema,
    );
    const draft = await readJsonArtifact(
      privateWork,
      requiredOption(options, 'draft'),
      AttackPlanDraftSchema,
    );
    const plan = resealAttackPlanDraft({
      basePlan,
      draft,
      resealedAt: new Date().toISOString(),
    });
    const intent = createPlanPublicationIntent({
      command: 'plan-reseal',
      runId,
      plan,
      runManifest: null,
    });
    await beginPlanPublication(privateWork, intent);
    await completePlanPublication(privateWork, intent);
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
          { kind: 'plan-json', path: intent.planJsonPath },
          { kind: 'plan-markdown', path: intent.planMarkdownPath },
        ],
      },
      `Resealed executable plan ${intent.planJsonPath} and review projection ${intent.planMarkdownPath}.\n`,
    );
    return 0;
  } finally {
    await lease.release();
  }
}

function writeRecoveredResealedPlanResult(
  options: Readonly<Record<string, string>>,
  intent: ReturnType<typeof createPlanPublicationIntent>,
  runId: string,
): number {
  writeCliCommandResult(
    options,
    {
      schemaVersion: 1,
      command: 'plan-reseal',
      status: 'completed',
      exitCode: 0,
      exitMeaning: commandExitMeaning('plan-reseal', 0),
      identifiers: { runId, planId: intent.planId },
      artifacts: [
        { kind: 'plan-json', path: intent.planJsonPath },
        { kind: 'plan-markdown', path: intent.planMarkdownPath },
      ],
    },
    `Recovered resealed executable plan ${intent.planJsonPath} and review projection ${intent.planMarkdownPath}.\n`,
  );
  return 0;
}
