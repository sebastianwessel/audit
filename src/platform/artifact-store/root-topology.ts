import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

import { ArtifactStoreError } from './json-artifact-store.ts';

export const RootTopologyInputSchema = z.strictObject({
  targetRoot: z.string().trim().min(1).max(4_096),
  contextRoot: z.string().trim().min(1).max(4_096).optional(),
  outputRoot: z.string().trim().min(1).max(4_096),
});

export const RootTopologySchema = z.strictObject({
  targetRoot: z.string().min(1),
  contextRoot: z.string().min(1).optional(),
  outputRoot: z.string().min(1),
});

export type RootTopology = z.infer<typeof RootTopologySchema>;

/**
 * Validates the three process roots before any output directory is created.
 * A missing output root stays unresolved on disk; callers rerun this function
 * after their safe output-root creation step before publishing artifacts.
 */
export async function validateRootTopology(
  input: z.input<typeof RootTopologyInputSchema>,
): Promise<RootTopology> {
  const parsed = RootTopologyInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ArtifactStoreError(
      'artifact-root-topology-invalid',
      'Target, context, and output roots must be valid paths.',
    );
  }

  const targetRoot = await canonicalExistingDirectory(parsed.data.targetRoot, 'target');
  const contextRoot =
    parsed.data.contextRoot === undefined
      ? undefined
      : await canonicalExistingDirectory(parsed.data.contextRoot, 'context');
  const outputRoot = await canonicalOutputCandidate(parsed.data.outputRoot);

  const roots = [
    { kind: 'target', path: targetRoot },
    ...(contextRoot === undefined ? [] : [{ kind: 'context', path: contextRoot }]),
    { kind: 'output', path: outputRoot },
  ];
  for (let leftIndex = 0; leftIndex < roots.length; leftIndex += 1) {
    const left = roots[leftIndex];
    if (left === undefined) continue;
    for (const right of roots.slice(leftIndex + 1)) {
      if (rootsOverlap(left.path, right.path)) {
        throw new ArtifactStoreError(
          'artifact-root-topology-invalid',
          `${left.kind} and ${right.kind} roots must be pairwise disjoint.`,
        );
      }
    }
  }

  return RootTopologySchema.parse({ targetRoot, contextRoot, outputRoot });
}

/** Creates only the requested output path, rejecting every symlinked or non-directory segment. */
export async function ensureSafeOutputRoot(outputRoot: string): Promise<string> {
  const candidate = await canonicalOutputCandidate(outputRoot);
  let current = '/';
  for (const segment of candidate.split('/').filter((value) => value.length > 0)) {
    current = join(current, segment);
    await ensureSafeDirectorySegment(current);
  }
  try {
    return await realpath(candidate);
  } catch {
    throw new ArtifactStoreError(
      'artifact-root-topology-invalid',
      'The output root could not be safely canonicalized after creation.',
    );
  }
}

async function canonicalExistingDirectory(
  path: string,
  label: 'target' | 'context',
): Promise<string> {
  const candidate = resolve(path);
  try {
    const status = await lstat(candidate);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'artifact-root-topology-invalid',
        `The ${label} root must be an existing non-symbolic-link directory.`,
      );
    }
    return await realpath(candidate);
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError(
      'artifact-root-topology-invalid',
      `The ${label} root must be an existing non-symbolic-link directory.`,
    );
  }
}

async function ensureSafeDirectorySegment(path: string): Promise<void> {
  try {
    const status = await lstat(path);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'artifact-root-topology-invalid',
        'The output root must not traverse symbolic links or non-directory paths.',
      );
    }
    return;
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
  }

  try {
    await mkdir(path);
  } catch {
    throw new ArtifactStoreError(
      'artifact-root-topology-invalid',
      'The output root could not be created safely.',
    );
  }

  try {
    const status = await lstat(path);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'artifact-root-topology-invalid',
        'The output root changed to an unsafe path during creation.',
      );
    }
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    throw new ArtifactStoreError(
      'artifact-root-topology-invalid',
      'The output root could not be verified after creation.',
    );
  }
}

async function canonicalOutputCandidate(path: string): Promise<string> {
  const candidate = resolve(path);
  try {
    const status = await lstat(candidate);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new ArtifactStoreError(
        'artifact-root-topology-invalid',
        'The output root must be a non-symbolic-link directory.',
      );
    }
    return await realpath(candidate);
  } catch (error) {
    if (error instanceof ArtifactStoreError) throw error;
    return canonicalizeMissingPath(candidate);
  }
}

async function canonicalizeMissingPath(candidate: string): Promise<string> {
  const missingSegments: string[] = [];
  let existingPath = candidate;
  while (true) {
    try {
      const status = await lstat(existingPath);
      if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new ArtifactStoreError(
          'artifact-root-topology-invalid',
          'The output root must have a non-symbolic-link directory ancestor.',
        );
      }
      return join(await realpath(existingPath), ...missingSegments.reverse());
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      const parentPath = dirname(existingPath);
      if (parentPath === existingPath) {
        throw new ArtifactStoreError(
          'artifact-root-topology-invalid',
          'The output root cannot be resolved from an existing directory.',
        );
      }
      missingSegments.push(existingPath.slice(parentPath.length + 1));
      existingPath = parentPath;
    }
  }
}

function rootsOverlap(left: string, right: string): boolean {
  const relativePath = relative(left, right);
  return relativePath.length === 0 || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}
