import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  canonicalJson,
  createStableId,
  modelNullableOptionalSchema,
  RelativePathSchema,
  sha256,
} from './core.js';

describe('shared contract primitives', () => {
  test('creates deterministic SHA-256 based IDs', () => {
    expect(sha256('review')).toHaveLength(64);
    expect(createStableId('finding', 'same input')).toBe(createStableId('finding', 'same input'));
    expect(createStableId('finding', 'same input')).not.toBe(
      createStableId('finding', 'other input'),
    );
  });

  test('canonicalizes nested JSON for digests and signatures', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: true })).toBe('{"a":true,"z":[{"a":1,"b":2}]}');
  });

  test('converts model nulls only for explicitly optional fields', () => {
    const schema = modelNullableOptionalSchema(z.string().min(1));
    expect(schema.parse(null)).toBeUndefined();
    expect(schema.parse('value')).toBe('value');
  });

  test('accepts normalized relative paths only', () => {
    expect(RelativePathSchema.parse('src/security/reviewer.ts')).toBe('src/security/reviewer.ts');
    expect(() => RelativePathSchema.parse('../secret')).toThrow();
    expect(() => RelativePathSchema.parse('/etc/passwd')).toThrow();
    expect(() => RelativePathSchema.parse('src\\file.ts')).toThrow();
  });
});
