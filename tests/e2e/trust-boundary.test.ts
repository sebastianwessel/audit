import { afterEach, expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from '../../src/cli/main.js';
import { loadRuntimeConfiguration } from '../../src/platform/configuration/environment.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test('rejects overlapping audit roots before creating output or opening target evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'audit-topology-e2e-'));
  roots.push(root);
  const targetRoot = join(root, 'target');
  const privateWorkRoot = join(root, 'private-work');
  const sourcePath = join(targetRoot, 'source.unknown');
  await mkdir(targetRoot);
  await writeFile(sourcePath, 'source remains untouched\n', 'utf8');

  await expect(
    runCli(
      [
        'audit',
        '--target',
        targetRoot,
        '--public-output',
        targetRoot,
        '--work',
        privateWorkRoot,
        '--plan',
        'plans/not-opened.json',
      ],
      {
        loadRuntimeConfiguration: () =>
          loadRuntimeConfiguration({
            environment: {
              AUDIT_PROVIDER: 'openai',
              AUDIT_MODEL: 'fixture-model',
            },
            loadDotEnv: false,
          }),
      },
    ),
  ).rejects.toMatchObject({ code: 'artifact-root-topology-invalid' });

  await expect(access(privateWorkRoot)).rejects.toThrow();
  expect(await readdir(targetRoot)).toEqual(['source.unknown']);
  await expect(readFile(sourcePath, 'utf8')).resolves.toBe('source remains untouched\n');
});
