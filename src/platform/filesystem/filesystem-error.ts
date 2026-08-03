import type { FilesystemErrorCode } from './filesystem.schema.ts';

export class FilesystemBoundaryError extends Error {
  public readonly code: FilesystemErrorCode;

  public constructor(code: FilesystemErrorCode, message: string) {
    super(message);
    this.name = 'FilesystemBoundaryError';
    this.code = code;
  }
}
