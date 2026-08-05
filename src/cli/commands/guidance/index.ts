import { basename } from 'node:path';
import { AttackPlanSchema } from '../../../features/attack-planning/index.js';
import { PublicAuditReportSchema } from '../../../features/audit-report/index.js';
import {
  createDeveloperGuidanceCheckpointBinding,
  createDeveloperGuidanceId,
  DeveloperGuidanceCheckpointSchema,
  DeveloperGuidanceLeaseMetadataSchema,
  DeveloperGuidanceReportSchema,
  developerGuidanceProtocolFingerprint,
  hasExactDeveloperGuidanceCheckpointBinding,
  hasExactDeveloperGuidanceReportBinding,
  renderDeveloperGuidanceMarkdown,
} from '../../../features/developer-guidance/index.js';
import {
  assertDeveloperGuidancePlanReportBinding,
  createReviewService,
  prepareDeveloperGuidanceTarget,
} from '../../../features/review-workflow/index.js';
import {
  createPrivateSourceCapture,
  discardUnsealedPrivateSourceCapture,
  privateSourceCaptureState,
} from '../../../features/target-inventory/index.js';
import {
  acquireArtifactLease,
  readJsonArtifact,
  readOptionalJsonArtifact,
  writeJsonArtifact,
  writeNewJsonArtifact,
  writeNewMarkdownArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import type { RootTopology } from '../../../platform/artifact-store/root-topology.js';
import type { LoadedRuntimeConfiguration } from '../../../platform/configuration/environment.js';
import {
  createConfiguredProvider,
  ProviderNameSchema,
  providerCacheRoutingKey,
} from '../../../platform/harness/provider.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import { commandExitMeaning, writeCliCommandResult } from '../../command-result.js';
import { booleanOption, requiredOption, requiredValue, usage } from '../../input.js';

export async function runGuidance(
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
  const targetDisplayName = options['target-name'] ?? basename(roots.targetRoot);
  const runId = options['run-id'] ?? `guidance-${crypto.randomUUID()}`;
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: DeveloperGuidanceLeaseMetadataSchema.parse({
      schemaVersion: 1,
      operation: 'developer-guidance',
      runId,
    }),
  });
  let retainedTarget: Awaited<ReturnType<typeof prepareDeveloperGuidanceTarget>> | undefined;
  try {
    const plan = await readJsonArtifact(
      privateWork,
      requiredOption(options, 'plan'),
      AttackPlanSchema,
    );
    const report = await readJsonArtifact(
      publicArtifacts,
      requiredOption(options, 'report'),
      PublicAuditReportSchema,
    );
    assertDeveloperGuidancePlanReportBinding({
      targetRoot: roots.targetRoot,
      contextRoot: roots.contextRoot,
      targetDisplayName,
      plan,
      report,
    });
    const selectedModel = requiredValue(runtime.configuration.model, 'model');
    const selectedProvider = requiredValue(runtime.configuration.provider, 'provider');
    const checkpointBinding = createDeveloperGuidanceCheckpointBinding({
      runId,
      plan,
      report,
      contextDigest: plan.contextDigest,
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
    if (resume || options['run-id'] !== undefined) {
      const captureState = await privateSourceCaptureState({
        outputRoot: privateWork,
        captureId: runId,
      });
      if (captureState === 'retained') {
        throw new AuditRuntimeError(
          'artifact-invalid',
          'Developer guidance cannot reuse a retained source snapshot for its transient capture.',
        );
      }
      if (captureState === 'unsealed') {
        await discardUnsealedPrivateSourceCapture({
          outputRoot: privateWork,
          captureId: runId,
        });
      }
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
        !hasExactDeveloperGuidanceReportBinding(existingGuidance, checkpointBinding) ||
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
            {
              kind: 'guidance-markdown',
              path: `guidance/${existingGuidance.guidanceId}.md`,
            },
          ],
        },
        `Reused completed non-gating developer guidance ${guidanceArtifactPath}.\n`,
      );
      return 0;
    }
    const capturedTarget = await prepareDeveloperGuidanceTarget({
      targetRoot: roots.targetRoot,
      contextRoot: roots.contextRoot,
      targetDisplayName,
      plan,
      report,
      sourceCapture: await createPrivateSourceCapture({
        outputRoot: privateWork,
        captureId: runId,
      }),
    });
    retainedTarget = capturedTarget;
    const provider = createConfiguredProvider({
      provider: ProviderNameSchema.parse(selectedProvider),
      apiKeyEnvironmentVariable: runtime.configuration.apiKeyEnvironmentVariable,
      environment: runtime.environment,
    });
    const service = createReviewService(provider, selectedModel, {
      modelPricing: runtime.configuration.modelPricing,
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
      retainedTarget: capturedTarget,
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
          {
            kind: 'guidance-markdown',
            path: `guidance/${created.guidance.guidanceId}.md`,
          },
        ],
      },
      `Created non-gating developer guidance guidance/${created.guidance.guidanceId}.json and guidance/${created.guidance.guidanceId}.md for ${created.guidance.items.length} accepted findings.\n`,
    );
    return 0;
  } finally {
    await retainedTarget?.release?.();
    await lease.release();
  }
}
