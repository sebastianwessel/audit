import {
  readJsonArtifact,
  readMarkdownArtifact,
  readOptionalJsonArtifact,
  writeNewJsonArtifact,
  writeNewMarkdownArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import { canonicalJson, sha256 } from '../../../shared/contracts/core.js';
import { AuditRuntimeError } from '../../../shared/errors/audit-runtime-error.js';
import { AuditRunManifestSchema } from '../../audit-execution/audit.schema.js';
import { type AttackPlan, AttackPlanSchema } from './plan.schema.js';
import { renderAttackPlanMarkdown } from './plan-markdown.js';
import { type PlanPublicationIntent, PlanPublicationIntentSchema } from './publication.schema.js';

const publicationIntentPath = (runId: string): string => `plan-publications/${runId}.json`;

export function createPlanPublicationIntent(
  input: Readonly<{
    command: PlanPublicationIntent['command'];
    runId: string;
    plan: AttackPlan;
    runManifest: PlanPublicationIntent['runManifest'];
  }>,
): PlanPublicationIntent {
  return PlanPublicationIntentSchema.parse({
    schemaVersion: 1,
    command: input.command,
    runId: input.runId,
    planId: input.plan.planId,
    planDigest: input.plan.planDigest,
    planJsonPath: `plans/${input.plan.planId}.json`,
    planMarkdownPath: `plans/${input.plan.planId}.md`,
    plan: input.plan,
    runManifest: input.runManifest,
  });
}

/** Writes the immutable intent before any plan-pair or manifest artifact. */
export async function beginPlanPublication(
  privateWork: string,
  intent: PlanPublicationIntent,
): Promise<void> {
  await writeNewJsonArtifact(
    privateWork,
    publicationIntentPath(intent.runId),
    PlanPublicationIntentSchema,
    intent,
  );
}

/** Publishes only absent artifacts after validating every already-present immutable artifact. */
export async function completePlanPublication(
  privateWork: string,
  intent: PlanPublicationIntent,
): Promise<void> {
  assertPlanMatchesIntent(intent.plan, intent);
  await writeOrValidatePlan(privateWork, intent);
  const markdown = renderAttackPlanMarkdown(intent.plan);
  await writeOrValidateMarkdown(privateWork, intent.planMarkdownPath, markdown);
  if (intent.runManifest !== null) {
    await writeOrValidateManifest(privateWork, intent.runManifest);
  }
}

/** Resumes a publication only through its exact immutable private intent. */
export async function resumePlanPublication(
  input: Readonly<{
    privateWork: string;
    command: PlanPublicationIntent['command'];
    runId: string;
  }>,
): Promise<PlanPublicationIntent> {
  const intent = await readJsonArtifact(
    input.privateWork,
    publicationIntentPath(input.runId),
    PlanPublicationIntentSchema,
  );
  if (intent.command !== input.command || intent.runId !== input.runId) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The plan publication intent does not match the explicit recovery command.',
    );
  }
  await completePlanPublication(input.privateWork, intent);
  return intent;
}

/** Fails fresh commands before model work when their explicit run already has retained publication state. */
export async function assertNoPlanPublicationIntent(
  privateWork: string,
  runId: string,
): Promise<void> {
  const existing = await readOptionalJsonArtifact(
    privateWork,
    publicationIntentPath(runId),
    PlanPublicationIntentSchema,
  );
  if (existing !== undefined) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'A plan publication intent already exists; resume the exact run explicitly.',
    );
  }
}

function assertPlanMatchesIntent(plan: AttackPlan, intent: PlanPublicationIntent): void {
  if (
    plan.planId !== intent.planId ||
    plan.planDigest !== intent.planDigest ||
    intent.planJsonPath !== `plans/${intent.planId}.json` ||
    intent.planMarkdownPath !== `plans/${intent.planId}.md`
  ) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The plan artifact does not match its immutable publication intent.',
    );
  }
}

async function writeOrValidatePlan(
  privateWork: string,
  intent: PlanPublicationIntent,
): Promise<void> {
  const existing = await readOptionalJsonArtifact(
    privateWork,
    intent.planJsonPath,
    AttackPlanSchema,
  );
  if (existing === undefined) {
    await writeNewJsonArtifact(privateWork, intent.planJsonPath, AttackPlanSchema, intent.plan);
    return;
  }
  assertPlanMatchesIntent(existing, intent);
  if (sha256(canonicalJson(existing)) !== sha256(canonicalJson(intent.plan))) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The plan artifact content does not match its immutable publication intent.',
    );
  }
}

async function writeOrValidateMarkdown(
  privateWork: string,
  path: string,
  expectedMarkdown: string,
): Promise<void> {
  let existingMarkdown: string | undefined;
  try {
    existingMarkdown = await readMarkdownArtifact(privateWork, path);
  } catch (error) {
    if (!isArtifactNotFound(error)) throw error;
  }
  if (existingMarkdown === undefined) {
    await writeNewMarkdownArtifact(privateWork, path, expectedMarkdown);
    return;
  }
  if (existingMarkdown !== expectedMarkdown) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The plan Markdown projection does not match the validated executable plan.',
    );
  }
}

async function writeOrValidateManifest(
  privateWork: string,
  expectedManifest: NonNullable<PlanPublicationIntent['runManifest']>,
): Promise<void> {
  const path = `runs/${expectedManifest.runId}.json`;
  const existing = await readOptionalJsonArtifact(privateWork, path, AuditRunManifestSchema);
  if (existing === undefined) {
    await writeNewJsonArtifact(privateWork, path, AuditRunManifestSchema, expectedManifest);
    return;
  }
  if (sha256(canonicalJson(existing)) !== sha256(canonicalJson(expectedManifest))) {
    throw new AuditRuntimeError(
      'artifact-invalid',
      'The plan run manifest does not match its immutable publication intent.',
    );
  }
}

function isArtifactNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'artifact-not-found'
  );
}
