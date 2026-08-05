import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  beginPlanPublication,
  createPlan,
  createPlanPublicationIntent,
} from '../features/attack-planning/index.js';
import { acquireArtifactLease } from '../platform/artifact-store/json-artifact-store.js';
import { loadRuntimeConfiguration } from '../platform/configuration/environment.js';
import { AuditRuntimeError } from '../shared/errors/audit-runtime-error.js';
import { parseHelpRequest, renderCliHelp } from './command-catalog.js';
import { cliFailureExitCode, parseCliArguments, runCli } from './main.js';

test('CLI parsing accepts only explicit command option pairs', () => {
  expect(parseCliArguments(['plan', '--target', 'fixture'])).toEqual({
    command: 'plan',
    options: { target: 'fixture' },
  });
  expect(
    parseCliArguments([
      'lineage',
      '--previous',
      'reports/previous.json',
      '--current',
      'reports/current.json',
    ]),
  ).toEqual({
    command: 'lineage',
    options: { previous: 'reports/previous.json', current: 'reports/current.json' },
  });
  expect(() => parseCliArguments(['plan', '--target'])).toThrow('Options must be unique');
  expect(() => parseCliArguments(['scan'])).toThrow('Expected one of');
});

test('CLI help is available without configuration, roots, or a provider', async () => {
  expect(parseHelpRequest(['--help'])).toBeNull();
  expect(parseHelpRequest(['help', 'audit'])).toBe('audit');
  expect(parseHelpRequest(['audit', '--help'])).toBe('audit');
  expect(parseHelpRequest(['help', 'unknown'])).toBeUndefined();
  expect(renderCliHelp()).toContain('`plan-reseal`');
  await expect(runCli(['--help'])).resolves.toBe(0);
});

test('CLI rejects unknown options before configuration or root access', async () => {
  await expect(
    runCli(['plan', '--target', 'does-not-matter', '--targett', 'typo']),
  ).rejects.toThrow('Unknown option --targett');
});

test('lock loads configured private work without target access or a provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-lock-cli-'));
  const privateWork = join(root, 'private-work');
  const runId = 'audit-lock-cli-01';
  await mkdir(privateWork);
  const lease = await acquireArtifactLease(privateWork, `work/leases/${runId}.lock`, {
    metadata: { schemaVersion: 1, operation: 'audit', runId },
  });
  let configurationLoaded = false;
  try {
    await expect(
      runCli(['lock', '--run-id', runId], {
        loadRuntimeConfiguration: async () => {
          configurationLoaded = true;
          return loadRuntimeConfiguration({
            environment: { AUDIT_PRIVATE_WORK_DIR: privateWork },
            loadDotEnv: false,
          });
        },
      }),
    ).resolves.toBe(0);
    expect(configurationLoaded).toBe(true);
  } finally {
    await lease.release();
    await rm(root, { force: true, recursive: true });
  }
});

test('plan publication resume dispatches without target access or provider credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-plan-cli-recovery-'));
  try {
    const privateWork = join(root, 'private-work');
    await mkdir(privateWork);
    const plan = createPlan({
      targetFingerprint: 'a'.repeat(64),
      contextDigest: 'b'.repeat(64),
      targetDisplayName: 'fixture',
      createdAt: '2026-08-05T12:00:00.000Z',
      inventorySummary: { fileCount: 1, totalBytes: 1, languageHints: [] },
      vectors: [
        {
          title: 'Recover publication',
          rationale: 'The retained plan must complete publication.',
          enabled: true,
          scopeGlobs: ['source.unknown'],
          reviewObligations: [
            {
              obligationId: 'recover-publication-01',
              riskStatement: 'A plan publication can stop after its intent.',
              evidenceRequirement: 'Use the private sealed plan for recovery.',
            },
          ],
          limitations: [],
        },
      ],
      additionalObservations: [],
    });
    const runId = 'plan-cli-recovery-01';
    await beginPlanPublication(
      privateWork,
      createPlanPublicationIntent({
        command: 'plan',
        runId,
        plan,
        runManifest: {
          schemaVersion: 2,
          runId,
          command: 'plan',
          startedAt: '2026-08-05T12:00:00.000Z',
          finishedAt: '2026-08-05T12:01:00.000Z',
          targetFingerprint: plan.targetFingerprint,
          planId: plan.planId,
          provider: 'openai',
          model: 'gpt-5.6-terra',
          outcome: 'completed',
          counters: { plannedVectors: 1, completedVectors: 0, failedVectors: 0, findingCount: 0 },
        },
      }),
    );
    await expect(
      runCli(['plan', '--run-id', runId, '--resume', 'true'], {
        loadRuntimeConfiguration: () =>
          loadRuntimeConfiguration({
            environment: { AUDIT_PRIVATE_WORK_DIR: privateWork },
            loadDotEnv: false,
          }),
      }),
    ).resolves.toBe(0);
    expect(await Bun.file(join(privateWork, `plans/${plan.planId}.json`)).exists()).toBe(true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('product CLI validates structured output before preparing roots', async () => {
  const source = await readFile(new URL('./main.ts', import.meta.url), 'utf8');
  expect(source.indexOf('assertAuditWorkflowStructuredOutputCompatibility(')).toBeGreaterThan(-1);
  expect(source.indexOf('assertAuditWorkflowStructuredOutputCompatibility(')).toBeLessThan(
    source.indexOf('const roots = await prepareConfiguredProductRoots('),
  );
});

test('CLI reserves exit code 4 for provider failures before report publication', () => {
  expect(cliFailureExitCode(new AuditRuntimeError('provider-failure', 'Unavailable.'))).toBe(4);
  expect(cliFailureExitCode(new AuditRuntimeError('invalid-input', 'Invalid.'))).toBe(2);
});
