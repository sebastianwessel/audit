import {
  type AuditRunManifest,
  AuditRunManifestSchema,
} from '../features/audit-execution/audit.schema.js';
import { writeJsonArtifact } from '../platform/artifact-store/json-artifact-store.js';

/** Writes the single source-free command manifest projection. */
export async function writeRunManifest(output: string, manifest: AuditRunManifest): Promise<void> {
  await writeJsonArtifact(output, `runs/${manifest.runId}.json`, AuditRunManifestSchema, manifest);
}
