import { z } from 'zod';

const labelledCredential =
  /\b(api[_-]?key|access[_-]?token|auth(?:orization)?|client[_-]?secret|password|passwd|private[_-]?key|secret|token)\b(\s*[:=]\s*)(?:\[REDACTED_[A-Z_]+\]|"[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`|[^\s,;)}\]]+)/giu;
const authorizationValue = /\b(authorization\s*:\s*)(?:basic|bearer|token)?\s*[^\s,;\r\n]+/giu;
const privateKeyBlock =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu;
const jwt = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu;
const credentialUri = /\b([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gu;
const cloudOrProviderToken =
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\b(?:sk|rk|xox[baprs])-[A-Za-z0-9_-]{16,}\b/gu;
const emailAddress = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const phoneNumber = /\b(?:\+?\d[\d .()-]{7,}\d)\b/gu;
const accountNumber = /\b(?:\d[ -]?){13,19}\b/gu;

/**
 * Normalizes persistable human-readable artifact text without limiting its
 * length. It is defence in depth; source-minimal contracts remain the primary
 * control against source and model-output retention.
 */
export function redactArtifactText(value: string): string {
  return [...redactSensitiveLiterals(value)]
    .filter((character) => !isUnsafeControlCharacter(character))
    .join('');
}

/** Shared schema boundary for persistable human-readable artifact text. */
export const ArtifactTextSchema = z.string().transform(redactArtifactText);

function redactSensitiveLiterals(value: string): string {
  return value
    .replace(privateKeyBlock, '[REDACTED_PRIVATE_KEY]')
    .replace(authorizationValue, (_match, prefix: string) => `${prefix}[REDACTED_SECRET]`)
    .replace(
      labelledCredential,
      (_match, label: string, separator: string) => `${label}${separator}[REDACTED_SECRET]`,
    )
    .replace(credentialUri, (_match, scheme: string) => `${scheme}[REDACTED_CREDENTIAL]@`)
    .replace(jwt, '[REDACTED_TOKEN]')
    .replace(cloudOrProviderToken, '[REDACTED_TOKEN]')
    .replace(emailAddress, '[REDACTED_EMAIL]')
    .replace(accountNumber, '[REDACTED_ACCOUNT]')
    .replace(phoneNumber, '[REDACTED_PHONE]');
}

function isUnsafeControlCharacter(character: string): boolean {
  const code = character.codePointAt(0);
  if (code === undefined) return false;
  return (
    (code <= 0x1f && character !== '\t' && character !== '\n' && character !== '\r') ||
    (code >= 0x7f && code <= 0x9f)
  );
}
