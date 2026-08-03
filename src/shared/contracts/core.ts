import { createHash } from 'node:crypto';
import { z } from 'zod';

export const SchemaVersion = z.literal(1);
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const IdentifierSchema = z.string().regex(/^[a-z][a-z0-9-]{2,63}$/);
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
/** Free-form text is structurally validated but never silently constrained by length. */
export const NonEmptyTextSchema = z.string().trim().min(1);
export const BoundedTextSchema = z.string();

export const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.includes('\\') && !value.includes('\0'),
    'Path contains an invalid character.',
  )
  .refine((value) => !value.startsWith('/'), 'Path must be relative.')
  .refine(
    (value) => value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..'),
    'Path must not contain traversal segments.',
  );

/** Shared model-boundary normalization; schemas still own their accepted token sets. */
export function normalizeModelEnumToken(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/**
 * Applies the one model-boundary token normalization rule while leaving the
 * accepted token set to the schema that owns the domain vocabulary.
 */
export function modelTokenSchema<TSchema extends z.ZodType>(schema: TSchema) {
  return z.preprocess(normalizeModelEnumToken, schema);
}

/** Converts the provider JSON convention for an omitted optional field to undefined. */
export function modelNullableOptionalSchema<TSchema extends z.ZodType>(schema: TSchema) {
  return z.preprocess((value) => (value === null ? undefined : value), schema.optional());
}

/** Produces one canonical digest for textual contracts and exact file bytes. */
export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Deterministic JSON serialization for content digests and detached-signature
 * payloads. Arrays retain their declared order; object keys sort recursively.
 */
export function canonicalJson(value: z.output<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export function createStableId(prefix: string, value: string): string {
  return `${prefix}-${sha256(value).slice(0, 16)}`;
}
