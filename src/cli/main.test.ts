import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

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
