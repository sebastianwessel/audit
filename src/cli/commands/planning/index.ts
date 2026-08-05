import { basename } from 'node:path';
import type { ModelProvider } from '@purista/harness';
import {
  AttackPlanDraftSchema,
  AttackPlanSchema,
  createAttackPlanDraft,
  renderAttackPlanMarkdown,
  resealAttackPlanDraft,
} from '../../../features/attack-planning/index.js';
import { createReviewService } from '../../../features/review-workflow/index.js';
import { createPrivateSourceCapture } from '../../../features/target-inventory/index.js';
import {
  readJsonArtifact,
  writeNewJsonArtifact,
  writeNewMarkdownArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import type { RootTopology } from '../../../platform/artifact-store/root-topology.js';
import type { RuntimeConfiguration } from '../../../platform/configuration/environment.js';
import { ProviderNameSchema, providerCacheRoutingKey } from '../../../platform/harness/provider.js';
import { commandExitMeaning, writeCliCommandResult } from '../../command-result.js';
import { requiredOption } from '../../input.js';
import { writeRunManifest } from '../../run-manifest.js';

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
  const runId = `plan-${crypto.randomUUID()}`;
  const targetRoot = dependencies.roots.targetRoot;
  const privateWork = dependencies.roots.privateWorkRoot;
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
