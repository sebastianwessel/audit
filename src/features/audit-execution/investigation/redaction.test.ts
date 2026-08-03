import { expect, test } from 'bun:test';

import { redactArtifactText, redactEvidenceSnippet } from './redaction.js';

test('redacts credential literals, bearer tokens, and email addresses from persisted evidence', () => {
  const result = redactEvidenceSnippet(
    "apiKey = 'live-secret-value'; authorization = Bearer abcdefghijklmnop; email = alice@example.test",
  );
  expect(result).not.toContain('live-secret-value');
  expect(result).not.toContain('abcdefghijklmnop');
  expect(result).not.toContain('alice@example.test');
  expect(result).toContain('[REDACTED]');
  expect(result).toContain('[REDACTED_EMAIL]');
});

test('projects model-authored artifact text without terminal controls or truncation', () => {
  const longValue = `note\u001b[2J password = "not-for-artifacts" ${'x'.repeat(20_000)}`;
  const redacted = redactArtifactText(longValue);
  expect(redacted).not.toContain('\u001b');
  expect(redacted).toContain('password = "[REDACTED]"');
  expect(redacted).toHaveLength('note[2J password = "[REDACTED]" '.length + 20_000);
});
