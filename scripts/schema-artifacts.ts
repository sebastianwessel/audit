import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

import { AttackPlanSchema } from '../src/features/attack-planning/plan.schema.js';
import {
  AuditReportSchema,
  AuditRunAttemptSchema,
  AuditRunManifestSchema,
} from '../src/features/audit-execution/audit.schema.js';
import { AuditReportLineageSchema } from '../src/features/audit-lineage/contract.js';
import { CorpusCandidateRegistrySchema } from '../src/features/evaluation/candidate-registry.schema.js';
import { CorpusPackManifestSchema } from '../src/features/evaluation/corpus.schema.js';
import { CorpusReadinessReportSchema } from '../src/features/evaluation/corpus-readiness.schema.js';
import { EvaluationPackSchema } from '../src/features/evaluation/evaluation.schema.js';
import { ProviderSmokeRunSchema } from '../src/features/evaluation/provider-smoke.schema.js';
import { StageConformanceRunSchema } from '../src/features/evaluation/stage-conformance.schema.js';
import {
  ContextDocumentSchema,
  SourceAdmissionPolicySchema,
  SourceSnapshotManifestSchema,
  SourceSnapshotRetentionIndexSchema,
  TargetInventorySchema,
} from '../src/features/target-inventory/inventory.schema.js';
import { RuntimeConfigurationSchema } from '../src/platform/configuration/environment.js';

const schemaDefinitions = [
  { fileName: 'attack-plan.schema.json', schema: AttackPlanSchema },
  { fileName: 'audit-lineage.schema.json', schema: AuditReportLineageSchema },
  { fileName: 'audit-report-v15.schema.json', schema: AuditReportSchema },
  { fileName: 'audit-run-attempt.schema.json', schema: AuditRunAttemptSchema },
  { fileName: 'audit-run-manifest.schema.json', schema: AuditRunManifestSchema },
  { fileName: 'context-document.schema.json', schema: ContextDocumentSchema },
  { fileName: 'corpus-pack.schema.json', schema: CorpusPackManifestSchema },
  { fileName: 'corpus-candidate-registry.schema.json', schema: CorpusCandidateRegistrySchema },
  { fileName: 'corpus-readiness.schema.json', schema: CorpusReadinessReportSchema },
  { fileName: 'evaluation-pack.schema.json', schema: EvaluationPackSchema },
  { fileName: 'provider-smoke-run.schema.json', schema: ProviderSmokeRunSchema },
  { fileName: 'stage-conformance-run.schema.json', schema: StageConformanceRunSchema },
  { fileName: 'runtime-configuration.schema.json', schema: RuntimeConfigurationSchema },
  { fileName: 'source-admission-policy.schema.json', schema: SourceAdmissionPolicySchema },
  { fileName: 'source-snapshot-manifest.schema.json', schema: SourceSnapshotManifestSchema },
  {
    fileName: 'source-snapshot-retention-index.schema.json',
    schema: SourceSnapshotRetentionIndexSchema,
  },
  { fileName: 'target-inventory.schema.json', schema: TargetInventorySchema },
] as const;

export function generatedSchemaArtifacts(): ReadonlyArray<
  Readonly<{ fileName: string; content: string }>
> {
  return schemaDefinitions.map(({ fileName, schema }) => ({
    fileName,
    content: `${JSON.stringify(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }), null, 2)}\n`,
  }));
}

export async function generateSchemaArtifacts(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const artifact of generatedSchemaArtifacts()) {
    await writeFile(join(directory, artifact.fileName), artifact.content, 'utf8');
  }
}

export async function assertSchemaArtifactsCurrent(directory: string): Promise<void> {
  for (const artifact of generatedSchemaArtifacts()) {
    const actual = await readFile(join(directory, artifact.fileName), 'utf8').catch(
      () => undefined,
    );
    if (actual !== artifact.content) {
      throw new Error(`Generated schema artifact is missing or stale: ${artifact.fileName}`);
    }
  }
}
