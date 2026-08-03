import { afterEach, describe, expect, test } from 'bun:test';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import {
  type ArtifactStoreError,
  acquireArtifactLease,
  readJsonArtifact,
  writeJsonArtifact,
  writeJsonLinesArtifact,
  writeMarkdownArtifact,
} from './json-artifact-store.ts';

const artifactRoots: string[] = [];

const AuditArtifactSchema = z.strictObject({
  zeta: z.string(),
  alpha: z.number(),
  nested: z.strictObject({
    zulu: z.boolean(),
    beta: z.boolean(),
  }),
});

afterEach(async () => {
  await Promise.all(
    artifactRoots.splice(0).map(async (root) => rm(root, { force: true, recursive: true })),
  );
});

describe('JSON artifact store', () => {
  test('writes stably serialized artifacts atomically and reads validated data', async () => {
    const outputRoot = await createArtifactRoot();
    const artifactPath = 'reports/audit.json';
    const expectedArtifact = {
      zeta: 'complete',
      alpha: 2,
      nested: {
        zulu: true,
        beta: false,
      },
    };

    await writeJsonArtifact(outputRoot, artifactPath, AuditArtifactSchema, expectedArtifact);

    expect(await readFile(join(outputRoot, artifactPath), 'utf8')).toBe(
      [
        '{',
        '  "alpha": 2,',
        '  "nested": {',
        '    "beta": false,',
        '    "zulu": true',
        '  },',
        '  "zeta": "complete"',
        '}',
        '',
      ].join('\n'),
    );

    await expect(readJsonArtifact(outputRoot, artifactPath, AuditArtifactSchema)).resolves.toEqual(
      expectedArtifact,
    );
  });

  test('rejects absolute, traversal, and non-JSON output paths', async () => {
    const outputRoot = await createArtifactRoot();

    for (const artifactPath of ['../outside.json', '/tmp/outside.json', 'reports/audit.txt']) {
      await expect(
        writeJsonArtifact(outputRoot, artifactPath, AuditArtifactSchema, {
          zeta: 'complete',
          alpha: 2,
          nested: { zulu: true, beta: false },
        }),
      ).rejects.toMatchObject({
        code: 'artifact-invalid-output-path',
      } satisfies Pick<ArtifactStoreError, 'code'>);
    }
  });

  test('writes Markdown only inside the same jailed root', async () => {
    const outputRoot = await createArtifactRoot();
    await writeMarkdownArtifact(outputRoot, 'reports/evaluation.md', '# Evaluation\n');
    await expect(readFile(join(outputRoot, 'reports/evaluation.md'), 'utf8')).resolves.toBe(
      '# Evaluation\n',
    );
    await expect(
      writeMarkdownArtifact(outputRoot, '../outside.md', '# no\n'),
    ).rejects.toMatchObject({
      code: 'artifact-invalid-output-path',
    } satisfies Pick<ArtifactStoreError, 'code'>);
  });

  test('writes validated JSON-lines records atomically inside the jailed root', async () => {
    const outputRoot = await createArtifactRoot();
    await writeJsonLinesArtifact(outputRoot, 'reports/trials.jsonl', AuditArtifactSchema, [
      { zeta: 'first', alpha: 1, nested: { zulu: true, beta: false } },
      { zeta: 'second', alpha: 2, nested: { zulu: false, beta: true } },
    ]);
    const content = await readFile(join(outputRoot, 'reports/trials.jsonl'), 'utf8');
    expect(content.split('\n').filter(Boolean)).toHaveLength(2);
    await expect(
      writeJsonLinesArtifact(outputRoot, '../outside.jsonl', AuditArtifactSchema, []),
    ).rejects.toMatchObject({
      code: 'artifact-invalid-output-path',
    } satisfies Pick<ArtifactStoreError, 'code'>);
  });

  test('rejects artifacts that fail their caller-provided schema on read', async () => {
    const outputRoot = await createArtifactRoot();
    const artifactPath = 'reports/invalid.json';

    await writeFile(join(outputRoot, 'invalid.json'), '{"zeta":17}');

    await expect(
      readJsonArtifact(outputRoot, 'invalid.json', AuditArtifactSchema),
    ).rejects.toMatchObject({
      code: 'artifact-schema-invalid',
    } satisfies Pick<ArtifactStoreError, 'code'>);
    await expect(access(join(outputRoot, artifactPath))).rejects.toThrow();
  });

  test('does not create missing artifact directories while resolving a read', async () => {
    const outputRoot = await createArtifactRoot();

    await expect(
      readJsonArtifact(outputRoot, 'missing/nested/audit.json', AuditArtifactSchema),
    ).rejects.toMatchObject({
      code: 'artifact-read-failed',
    } satisfies Pick<ArtifactStoreError, 'code'>);

    await expect(readdir(outputRoot)).resolves.toEqual([]);
  });

  test('leaves no final or temporary artifact when schema validation fails before writing', async () => {
    const outputRoot = await createArtifactRoot();
    const RejectingArtifactSchema = z
      .strictObject({ title: z.string() })
      .refine(() => false, 'Intentional test validation failure.');

    await expect(
      writeJsonArtifact(outputRoot, 'reports/rejected.json', RejectingArtifactSchema, {
        title: 'draft',
      }),
    ).rejects.toMatchObject({
      code: 'artifact-schema-invalid',
    } satisfies Pick<ArtifactStoreError, 'code'>);
    await expect(access(join(outputRoot, 'reports/rejected.json'))).rejects.toThrow();
    await expect(readdir(outputRoot)).resolves.toEqual([]);
  });

  test('serializes one writer and fails closed for an unresolved lease', async () => {
    const outputRoot = await createArtifactRoot();
    const artifactPath = 'work/leases/audit-run.lock';
    const first = await acquireArtifactLease(outputRoot, artifactPath);
    await expect(acquireArtifactLease(outputRoot, artifactPath)).rejects.toMatchObject({
      code: 'artifact-lease-unavailable',
    } satisfies Pick<ArtifactStoreError, 'code'>);
    await first.release();

    await writeFile(join(outputRoot, artifactPath), '999999999\n', 'utf8');
    await expect(acquireArtifactLease(outputRoot, artifactPath)).rejects.toMatchObject({
      code: 'artifact-lease-unavailable',
    } satisfies Pick<ArtifactStoreError, 'code'>);
  });
});

async function createArtifactRoot(): Promise<string> {
  const artifactRoot = await mkdtemp(join(tmpdir(), 'security-reviewer-artifact-store-'));
  artifactRoots.push(artifactRoot);
  return artifactRoot;
}
