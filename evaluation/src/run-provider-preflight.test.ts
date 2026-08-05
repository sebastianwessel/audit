import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { runProviderPreflightCommand } from './run-provider-preflight.js';

test('uses controlled exit-code assignment instead of direct process termination', async () => {
  const source = await readFile(new URL('./run-provider-preflight.ts', import.meta.url), 'utf8');

  expect(source).toContain('process.exitCode = await runProviderPreflightCommand');
  expect(source).not.toContain('process.exit(');
});

test('prints provider-evaluation help before loading runtime configuration', async () => {
  expect(await runProviderPreflightCommand(['--help'])).toBe(0);
});
