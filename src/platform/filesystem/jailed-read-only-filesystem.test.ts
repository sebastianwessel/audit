import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FilesystemErrorCode } from './index.ts';
import { createJailedReadOnlyFilesystem, FilesystemBoundaryError } from './index.ts';

let workspace = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'security-reviewer-filesystem-'));
});

afterEach(async () => {
  if (workspace.length > 0) {
    await rm(workspace, { recursive: true, force: true });
  }
});

const createRoots = async (): Promise<{ targetRoot: string; contextRoot: string }> => {
  const targetRoot = join(workspace, 'target');
  const contextRoot = join(workspace, 'context');
  await mkdir(targetRoot, { recursive: true });
  await mkdir(contextRoot, { recursive: true });
  return { targetRoot, contextRoot };
};

const expectBoundaryError = (error: FilesystemBoundaryError, code: FilesystemErrorCode): void => {
  expect(error).toBeInstanceOf(FilesystemBoundaryError);
  expect(error.code).toBe(code);
};

describe('createJailedReadOnlyFilesystem', () => {
  test('canonicalizes separate roots and returns all sorted file entries', async () => {
    const { targetRoot, contextRoot } = await createRoots();
    await mkdir(join(targetRoot, 'nested'));
    await writeFile(join(targetRoot, 'z.ts'), 'export const z = 1;\n');
    await writeFile(join(targetRoot, 'nested', 'a.ts'), 'export const a = 1;\n');
    await writeFile(join(contextRoot, 'overview.md'), '# Overview\n');

    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot, contextRoot });
    const targetFiles = await filesystem.listFiles({
      root: ' TARGET ',
      includeGlobs: ['**/*.ts'],
      excludeGlobs: [],
    });
    const contextFile = await filesystem.readFile({
      root: 'context',
      relativePath: 'overview.md',
      startLine: 1,
      endLine: 1,
    });

    expect(targetFiles.entries).toEqual([
      { relativePath: 'nested/a.ts', sizeBytes: 20 },
      { relativePath: 'z.ts', sizeBytes: 20 },
    ]);
    expect(contextFile.text).toBe('# Overview');
    expect(filesystem.targetRoot).toBe(await realpath(targetRoot));
    expect(filesystem.contextRoot).toBe(await realpath(contextRoot));
  });

  test('rejects absolute, traversal, backslash, and NUL path attempts', async () => {
    const { targetRoot } = await createRoots();
    await writeFile(join(targetRoot, 'safe.ts'), 'safe\n');
    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot });

    await expect(filesystem.readFile({ relativePath: '/etc/passwd' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(filesystem.readFile({ relativePath: '../outside.ts' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(filesystem.readFile({ relativePath: 'nested\\outside.ts' })).rejects.toMatchObject(
      {
        code: 'INVALID_INPUT',
      },
    );
    await expect(filesystem.readFile({ relativePath: 'nul\0.ts' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  test('rejects symlink escapes for direct reads and recursive listing', async () => {
    const { targetRoot } = await createRoots();
    const outsidePath = join(workspace, 'outside.ts');
    await writeFile(outsidePath, 'secret\n');
    await symlink(outsidePath, join(targetRoot, 'escape.ts'));
    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot });

    await expect(filesystem.readFile({ relativePath: 'escape.ts' })).rejects.toMatchObject({
      code: 'SYMLINK_ESCAPE',
    });
    await expect(
      filesystem.listFiles({ includeGlobs: ['**/*'], excludeGlobs: [] }),
    ).rejects.toMatchObject({
      code: 'SYMLINK_ESCAPE',
    });
  });

  test('does not omit source or matches because of a product size limit', async () => {
    const { targetRoot } = await createRoots();
    await writeFile(join(targetRoot, 'a.ts'), 'token\n');
    await writeFile(join(targetRoot, 'b.ts'), 'token\n');
    await writeFile(join(targetRoot, 'large.ts'), 'this is larger than ten bytes');
    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot });

    await expect(filesystem.readFile({ relativePath: 'large.ts' })).resolves.toMatchObject({
      text: 'this is larger than ten bytes',
    });
    await expect(
      filesystem.listFiles({ includeGlobs: ['**/*'], excludeGlobs: [] }),
    ).resolves.toMatchObject({
      entries: [
        { relativePath: 'a.ts', sizeBytes: 6 },
        { relativePath: 'b.ts', sizeBytes: 6 },
        { relativePath: 'large.ts', sizeBytes: 29 },
      ],
    });
    await expect(
      filesystem.grepFiles({
        pattern: 'token',
        mode: 'literal',
        caseSensitive: true,
        relativePaths: ['a.ts', 'b.ts'],
      }),
    ).resolves.toMatchObject({ matches: [{ relativePath: 'a.ts' }, { relativePath: 'b.ts' }] });
  });

  test('preserves original line endings for source reads', async () => {
    const { targetRoot } = await createRoots();
    await writeFile(join(targetRoot, 'mixed.txt'), 'first\r\nsecond\nthird\r\n');
    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot });

    await expect(
      filesystem.readFile({ relativePath: 'mixed.txt', startLine: 1 }),
    ).resolves.toMatchObject({ text: 'first\r\nsecond\nthird\r\n' });
    await expect(
      filesystem.readFile({ relativePath: 'mixed.txt', startLine: 1, endLine: 2 }),
    ).resolves.toMatchObject({ text: 'first\r\nsecond' });
  });

  test('supports literal, identifier, and safe regex searches with explicit casing modes', async () => {
    const { targetRoot } = await createRoots();
    await writeFile(
      join(targetRoot, 'app.ts'),
      'const TOKEN_ABC = true;\nconst token_def = false;\n',
    );
    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot });

    const insensitiveLiteral = await filesystem.grepFiles({
      pattern: 'token_abc',
      mode: 'literal',
      caseSensitive: false,
      relativePaths: ['app.ts'],
      contextLines: 1,
    });
    const sensitiveRegex = await filesystem.grepFiles({
      pattern: 'TOKEN_[A-Z][A-Z][A-Z]',
      mode: 'regex',
      caseSensitive: true,
      relativePaths: ['app.ts'],
      contextLines: 0,
    });
    const identifier = await filesystem.grepFiles({
      pattern: 'token',
      mode: 'identifier',
      caseSensitive: false,
      relativePaths: ['app.ts'],
      contextLines: 0,
    });

    expect(insensitiveLiteral.matches).toEqual([
      {
        relativePath: 'app.ts',
        line: 1,
        context: 'const TOKEN_ABC = true;\nconst token_def = false;',
      },
    ]);
    expect(sensitiveRegex.matches).toEqual([
      { relativePath: 'app.ts', line: 1, context: 'const TOKEN_ABC = true;' },
    ]);
    expect(identifier.matches).toEqual([]);
    await expect(
      filesystem.grepFiles({
        pattern: '(TOKEN)+',
        mode: 'regex',
        caseSensitive: true,
        relativePaths: ['app.ts'],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATTERN' });
  });

  test('preserves physical source line endings in grep context without an arbitrary context cap', async () => {
    const { targetRoot } = await createRoots();
    await writeFile(join(targetRoot, 'mixed.txt'), 'first\r\nsecond\r\nthird\r\n');
    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot });

    await expect(
      filesystem.grepFiles({
        pattern: 'second',
        mode: 'literal',
        caseSensitive: true,
        relativePaths: ['mixed.txt'],
        contextLines: 99,
      }),
    ).resolves.toEqual({
      matches: [
        {
          relativePath: 'mixed.txt',
          line: 2,
          context: 'first\r\nsecond\r\nthird',
        },
      ],
    });
  });

  test('uses stable boundary errors for unavailable context and invalid roots', async () => {
    const { targetRoot } = await createRoots();
    const filesystem = await createJailedReadOnlyFilesystem({ targetRoot });

    await expect(
      filesystem.listFiles({ root: 'context', includeGlobs: ['**/*'], excludeGlobs: [] }),
    ).rejects.toMatchObject({
      code: 'CONTEXT_ROOT_UNAVAILABLE',
    });
    await expect(
      createJailedReadOnlyFilesystem({ targetRoot: join(workspace, 'missing') }),
    ).rejects.toMatchObject({ code: 'INVALID_ROOT' });
  });

  test('exposes the expected stable error shape', () => {
    expectBoundaryError(new FilesystemBoundaryError('INVALID_INPUT', 'invalid'), 'INVALID_INPUT');
  });
});
