import { sha256 } from '../../shared/contracts/core.js';
import { SecurityReviewerError } from '../../shared/errors/security-reviewer-error.js';

import { type ContextDocument, ContextDocumentSchema } from './inventory.schema.js';

const allowedKeys = new Set(['title', 'kind', 'sensitivity', 'appliesTo']);

/** Parses deliberately small YAML frontmatter. Complex YAML is rejected, not guessed. */
export function parseContextDocument(path: string, text: string): ContextDocument {
  const matched = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u.exec(text);
  if (matched === null) {
    throw new SecurityReviewerError(
      'context-invalid',
      `Context document ${path} must begin with strict YAML frontmatter.`,
    );
  }

  const rawFrontmatter = matched[1];
  const rawBody = matched[2];
  if (rawFrontmatter === undefined || rawBody === undefined) {
    throw new SecurityReviewerError('context-invalid', `Context document ${path} is incomplete.`);
  }
  const frontmatter = parseFrontmatter(path, rawFrontmatter);
  // Markdown is evidence. Preserve its exact text after the frontmatter
  // delimiter so context fingerprints and overflow recovery cannot erase
  // whitespace, line endings, or a final newline.
  const body = rawBody;
  return ContextDocumentSchema.parse({
    path,
    title: frontmatter.title,
    kind: frontmatter.kind,
    sensitivity: frontmatter.sensitivity,
    appliesTo: frontmatter.appliesTo,
    body,
    digest: sha256(
      `${path}\0${frontmatter.title}\0${frontmatter.kind}\0${frontmatter.sensitivity}\0${frontmatter.appliesTo.join('\0')}\0${body}`,
    ),
  });
}

type ParsedFrontmatter = {
  title: string;
  kind: string;
  sensitivity: string;
  appliesTo: string[];
};

function parseFrontmatter(path: string, frontmatter: string): ParsedFrontmatter {
  const values = new Map<string, string | string[]>();
  let activeList: string | undefined;
  for (const [index, line] of frontmatter.split(/\r?\n/u).entries()) {
    if (line.trim().length === 0) continue;
    const list = /^ {2}- (.+)$/u.exec(line);
    if (list !== null && activeList === 'appliesTo') {
      const current = values.get('appliesTo');
      const value = list[1];
      if (!Array.isArray(current) || value === undefined) throw invalid(path, index + 1);
      current.push(parseScalar(value, path, index + 1));
      continue;
    }
    const property = /^([A-Za-z][A-Za-z0-9]*):(?: (.+))?$/u.exec(line);
    const key = property?.[1];
    if (property === null || key === undefined || !allowedKeys.has(key) || values.has(key)) {
      throw invalid(path, index + 1);
    }
    const rawValue = property[2];
    if (key === 'appliesTo') {
      if (rawValue !== undefined) throw invalid(path, index + 1);
      values.set(key, []);
      activeList = key;
      continue;
    }
    if (rawValue === undefined) throw invalid(path, index + 1);
    values.set(key, parseScalar(rawValue, path, index + 1));
    activeList = undefined;
  }
  const title = values.get('title');
  const kind = values.get('kind');
  const sensitivity = values.get('sensitivity');
  const appliesTo = values.get('appliesTo');
  if (
    typeof title !== 'string' ||
    typeof kind !== 'string' ||
    typeof sensitivity !== 'string' ||
    !Array.isArray(appliesTo)
  ) {
    throw new SecurityReviewerError(
      'context-invalid',
      `Context document ${path} is missing required metadata.`,
    );
  }
  return { title, kind, sensitivity, appliesTo };
}

function parseScalar(value: string, path: string, line: number): string {
  const trimmed = value.trim();
  const quote = /^"([^"\\]*(?:\\.[^"\\]*)*)"$/u.exec(trimmed);
  const quotedValue = quote?.[1];
  if (quotedValue !== undefined) return quotedValue.replace(/\\"/gu, '"').replace(/\\\\/gu, '\\');
  if (
    trimmed.includes(':') ||
    trimmed.includes('#') ||
    trimmed.startsWith('[') ||
    trimmed.startsWith('{')
  ) {
    throw invalid(path, line);
  }
  return trimmed;
}

function invalid(path: string, line: number): SecurityReviewerError {
  return new SecurityReviewerError(
    'context-invalid',
    `Invalid context frontmatter in ${path} at line ${line}.`,
  );
}
