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

/** Applies the identical explicit-resume contract shared by resumable product commands. */
export function assertResumableRunOptions(
  input: Readonly<{
    resume: boolean;
    retryUnfinished: boolean;
    hasRunId: boolean;
    command: string;
  }>,
): void {
  if (input.resume && !input.hasRunId) {
    throw usage(`Resuming ${input.command} requires an explicit --run-id.`);
  }
  if (!input.resume && input.retryUnfinished) {
    throw usage(`Retrying unfinished ${input.command} requires --resume true.`);
  }
}

export function usage(message: string): AuditRuntimeError {
  return new AuditRuntimeError(
    'invalid-input',
    `${message} Run \`audit --help\` to list commands and \`audit help <command>\` for exact usage.`,
  );
}
