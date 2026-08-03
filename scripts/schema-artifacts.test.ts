import { expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertSchemaArtifactsCurrent, generateSchemaArtifacts } from './schema-artifacts.js';

test('generates deterministic JSON Schema artifacts from the feature-owned Zod schemas', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'security-reviewer-schema-'));
  await generateSchemaArtifacts(directory);
  await expect(assertSchemaArtifactsCurrent(directory)).resolves.toBeUndefined();
  expect(
    JSON.parse(await readFile(join(directory, 'audit-report-v15.schema.json'), 'utf8')).properties
      .schemaVersion.const,
  ).toBe(15);
});
