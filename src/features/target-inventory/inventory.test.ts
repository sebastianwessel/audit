import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createJailedReadOnlyFilesystem } from '../../platform/filesystem/index.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';
import { parseContextDocument } from './context.js';
import { DefaultSourceAdmissionPolicy, inferLanguageHint, inventoryTarget } from './inventory.js';

test('inventory binds a deterministic source fingerprint and optional context digest', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'security-reviewer-inventory-'));
  const target = join(fixture, 'target');
  const context = join(fixture, 'context');
  await mkdir(target);
  await mkdir(context);
  await writeFile(join(target, 'server.ts'), 'const token = process.env.TOKEN;\n', 'utf8');
  await writeFile(
    join(context, 'deployment.md'),
    '---\ntitle: Production deployment\nkind: deployment\nsensitivity: internal\nappliesTo:\n  - "src/**"\n---\nTLS terminates at the gateway.\n',
    'utf8',
  );
  const filesystem = await createJailedReadOnlyFilesystem({
    targetRoot: target,
    contextRoot: context,
  });
  const inventory = await inventoryTarget(filesystem);
  expect(inventory.summary).toEqual({
    fileCount: 1,
    totalBytes: 33,
    languageHints: ['typescript'],
  });
  expect(inventory.context[0]?.title).toBe('Production deployment');
  expect(inventory.targetFingerprint).toMatch(/^[a-f0-9]{64}$/u);
});

test('context rejects unknown or complex frontmatter instead of inferring it', () => {
  expect(() =>
    parseContextDocument(
      'bad.md',
      '---\ntitle: Bad\nunknown: value\nkind: other\nsensitivity: internal\nappliesTo:\n---\nBody',
    ),
  ).toThrow(SecurityReviewerError);
});

test('context preserves exact Markdown body text and accepts uncapped applies-to metadata', () => {
  const appliesTo = Array.from({ length: 33 }, (_, index) => `  - "src/${index}/**"`).join('\r\n');
  const body = '\n  Preserve leading whitespace.\r\nKeep this line ending.\r\n';
  const document = parseContextDocument(
    'ARCHITECTURE.MD',
    `---\r\ntitle: Architecture\r\nkind: architecture\r\nsensitivity: internal\r\nappliesTo:\r\n${appliesTo}\r\n---\r\n${body}`,
  );

  expect(document.body).toBe(body);
  expect(document.appliesTo).toHaveLength(33);
});

test('inventory discovers Markdown context case-insensitively', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'security-reviewer-context-case-'));
  const target = join(fixture, 'target');
  const context = join(fixture, 'context');
  await mkdir(target);
  await mkdir(context);
  await writeFile(join(target, 'server.unknown'), 'value\n', 'utf8');
  await writeFile(
    join(context, 'DEPLOYMENT.MD'),
    '---\ntitle: Deployment\nkind: deployment\nsensitivity: internal\nappliesTo:\n  - "**/*"\n---\nKept as advisory context.\n',
    'utf8',
  );

  const inventory = await inventoryTarget(
    await createJailedReadOnlyFilesystem({ targetRoot: target, contextRoot: context }),
  );
  expect(inventory.context.map((document) => document.path)).toEqual(['DEPLOYMENT.MD']);
});

test('language hints are optional metadata and never an inventory allowlist', () => {
  expect(inferLanguageHint('src/worker.rs')).toBe('rust');
  expect(inferLanguageHint('src/custom.dsl')).toBeNull();
});

test('records named default exclusions instead of silently omitting eligible-looking paths', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'security-reviewer-admission-'));
  const target = join(fixture, 'target');
  await mkdir(target);
  await mkdir(join(target, 'node_modules'));
  await writeFile(join(target, 'app.custom'), 'review me\n', 'utf8');
  await writeFile(join(target, 'node_modules', 'cached.custom'), 'exclude me\n', 'utf8');
  await writeFile(join(target, '.env'), 'TOKEN=private\n', 'utf8');

  const inventory = await inventoryTarget(
    await createJailedReadOnlyFilesystem({ targetRoot: target }),
  );
  expect(inventory.sourcePaths).toEqual(['app.custom']);
  expect(inventory.sourceSnapshot.policy).toEqual(DefaultSourceAdmissionPolicy);
  expect(inventory.sourceSnapshot.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: 'node_modules/cached.custom',
        disposition: 'excluded',
        reason: 'dependency-or-vendor-cache',
      }),
      expect.objectContaining({
        path: '.env',
        disposition: 'excluded',
        reason: 'local-secret-store',
      }),
    ]),
  );
});
