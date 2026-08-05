import { AuditRuntimeError } from '../shared/errors/audit-runtime-error.js';

/** Reads a required CLI option without duplicating command-boundary errors. */
export function requiredOption(options: Readonly<Record<string, string>>, key: string): string {
  return requiredValue(options[key], key);
}

export function requiredValue(value: string | undefined, key: string): string {
  if (value === undefined || value.length === 0) throw usage(`Missing required --${key} option.`);
  return value;
}

export function booleanOption(
  options: Readonly<Record<string, string>>,
  key: string,
  fallback: boolean,
): boolean {
  const value = options[key];
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw usage(`${key} must be true or false.`);
}

export function usage(message: string): AuditRuntimeError {
  return new AuditRuntimeError(
    'invalid-input',
    `${message} Run \`audit --help\` to list commands and \`audit help <command>\` for exact usage.`,
  );
}
