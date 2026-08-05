import { expect, test } from 'bun:test';

import { ArtifactTextSchema, redactArtifactText } from './artifact-text.js';

test('redacts recognized credential and direct PII literals without truncating ordinary text', () => {
  const ordinarySuffix = ' normal review prose remains available.';
  const result = redactArtifactText(
    `password = "fixture-secret"; Authorization: Bearer fixture-token-value; user@example.com; +49 123 4567890; ${'4'.repeat(16)}; ${ordinarySuffix}`,
  );

  expect(result).not.toContain('fixture-secret');
  expect(result).not.toContain('fixture-token-value');
  expect(result).not.toContain('user@example.com');
  expect(result).not.toContain('+49 123 4567890');
  expect(result).not.toContain('4444');
  expect(result).toContain('[REDACTED_SECRET]');
  expect(result).toContain('[REDACTED_EMAIL]');
  expect(result).toContain('[REDACTED_PHONE]');
  expect(result).toContain('[REDACTED_ACCOUNT]');
  expect(result).toContain(ordinarySuffix);
});

test('removes terminal controls and redacts private-key, token, and credential-URI forms', () => {
  const result = ArtifactTextSchema.parse(
    'note\u001b[2J -----BEGIN PRIVATE KEY-----\nprivate-key-material\n-----END PRIVATE KEY----- https://user:pass@example.test sk-fixture-token-value-1234567890',
  );

  expect(result).not.toContain('\u001b');
  expect(result).not.toContain('private-key-material');
  expect(result).not.toContain('user:pass');
  expect(result).not.toContain('sk-fixture-token-value');
  expect(result).toContain('[REDACTED_PRIVATE_KEY]');
  expect(result).toContain('[REDACTED_CREDENTIAL]');
  expect(result).toContain('[REDACTED_TOKEN]');
});

test('preserves Unicode and does not introduce an artifact-text length ceiling', () => {
  const value = `Prüfung 🔒 ${'x'.repeat(20_000)}`;
  expect(ArtifactTextSchema.parse(value)).toBe(value);
});

test('is idempotent for an already redacted credential marker', () => {
  const marker = 'password = [REDACTED_SECRET]';
  expect(redactArtifactText(marker)).toBe(marker);
});
