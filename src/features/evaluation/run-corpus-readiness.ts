import {
  writeJsonArtifact,
  writeMarkdownArtifact,
} from '../../platform/artifact-store/json-artifact-store.js';
import { loadRuntimeConfiguration } from '../../platform/configuration/environment.js';

import { loadCorpusPack } from './corpus.js';
import { assessCorpusReadiness } from './corpus-readiness.js';
import { CorpusReadinessReportSchema } from './corpus-readiness.schema.js';
import { renderCorpusReadinessReport } from './corpus-readiness-report.js';

try {
  const runtime = await loadRuntimeConfiguration();
  const pack = await loadCorpusPack(runtime.configuration.evaluationCorpusRoot);
  const runId = `corpus-readiness-${crypto.randomUUID()}`;
  const readiness = assessCorpusReadiness(pack, new Date().toISOString());
  await writeJsonArtifact(
    runtime.configuration.evaluationOutputRoot,
    `${runId}/readiness.json`,
    CorpusReadinessReportSchema,
    readiness,
  );
  await writeMarkdownArtifact(
    runtime.configuration.evaluationOutputRoot,
    `${runId}/readiness.md`,
    renderCorpusReadinessReport(readiness),
  );
  process.stdout.write(`${JSON.stringify(readiness)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unexpected corpus-readiness failure.';
  process.stderr.write(`security-reviewer corpus readiness: ${message}\n`);
  process.exitCode = 2;
}
