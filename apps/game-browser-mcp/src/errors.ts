import type { RuntimeErrorCode } from './contracts.js';

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: RuntimeErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RuntimeError';
    this.code = code;
    this.details = details;
  }
}

export function asRuntimeError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  return new RuntimeError('INTERNAL_ERROR', error instanceof Error ? error.message : 'unknown runtime error');
}
