import type { Logger } from '@purista/harness';

/**
 * A deliberate no-op logger for target-review workflows.
 *
 * Harness provider errors can carry provider bodies, headers, request ids, or
 * source-adjacent diagnostic data. Product diagnostics are instead recorded
 * through the strict, content-free stage-observation contracts.
 */
export class NoContentLogger implements Logger {
  public trace(_message: string, _fields?: Record<string, unknown>): void {}

  public debug(_message: string, _fields?: Record<string, unknown>): void {}

  public info(_message: string, _fields?: Record<string, unknown>): void {}

  public warn(_message: string, _fields?: Record<string, unknown>): void {}

  public error(_message: string, _fields?: Record<string, unknown>): void {}

  public fatal(_message: string, _fields?: Record<string, unknown>): void {}

  public child(_bindings: Record<string, unknown>): Logger {
    return this;
  }
}
