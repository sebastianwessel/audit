import { classifyAuditTerminal } from '../../../features/audit-execution/index.js';
import {
  AuditReportLineageSchema,
  createAuditReportLineage,
  renderAuditReportLineageMarkdown,
} from '../../../features/audit-lineage/index.js';
import {
  PublicAuditReportSchema,
  renderAuditReportMarkdown,
} from '../../../features/audit-report/index.js';
import {
  readJsonArtifact,
  writeJsonArtifact,
} from '../../../platform/artifact-store/json-artifact-store.js';
import { commandExitMeaning, writeCliCommandResult } from '../../command-result.js';
import { requiredOption } from '../../input.js';
import { writeRunManifest } from '../../run-manifest.js';

export async function runReport(
  options: Readonly<Record<string, string>>,
  publicArtifacts: string,
): Promise<number> {
  const startedAt = new Date().toISOString();
  const report = await readJsonArtifact(
    publicArtifacts,
    requiredOption(options, 'report'),
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
    counters: classifyAuditTerminal(report).counters,
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
        { kind: 'report-json', path: requiredOption(options, 'report') },
        { kind: 'run-manifest', path: `runs/${runId}.json` },
      ],
    },
    renderAuditReportMarkdown(report),
  );
  return terminal.exitCode;
}

export async function runLineage(
  options: Readonly<Record<string, string>>,
  publicArtifacts: string,
): Promise<number> {
  const previous = await readJsonArtifact(
    publicArtifacts,
    requiredOption(options, 'previous'),
    PublicAuditReportSchema,
  );
  const current = await readJsonArtifact(
    publicArtifacts,
    requiredOption(options, 'current'),
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
