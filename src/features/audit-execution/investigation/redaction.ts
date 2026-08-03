const secretLiteral = /((?:api[_-]?key|secret|password|token)\s*[:=]\s*['"])[^'"]+(['"])/giu;
const bearerToken = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/giu;
const emailAddress = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;

/** Keeps location-level evidence useful while preventing common secret and PII literals from persisting. */
export function redactEvidenceSnippet(value: string): string {
  return value
    .replace(secretLiteral, '$1[REDACTED]$2')
    .replace(bearerToken, '$1[REDACTED]')
    .replace(emailAddress, '[REDACTED_EMAIL]');
}

/**
 * Projects model-authored text into a safe artifact value without imposing a
 * content-length cap. It preserves normal Unicode and layout whitespace while
 * removing control characters that could alter log or report output.
 */
export function redactArtifactText(value: string): string {
  return [...redactEvidenceSnippet(value)]
    .filter((character) => !isUnsafeControlCharacter(character))
    .join('');
}

function isUnsafeControlCharacter(character: string): boolean {
  const code = character.codePointAt(0);
  if (code === undefined) return false;
  return (
    (code <= 0x1f && character !== '\t' && character !== '\n' && character !== '\r') ||
    (code >= 0x7f && code <= 0x9f)
  );
}
