export interface AgoraErrorOptions {
  code: string;
  retriable?: boolean;
  status?: number;
  cause?: unknown;
}

export interface ApiErrorResponse {
  error: string;
  code: string;
  retriable: boolean;
}

export class AgoraError extends Error {
  readonly code: string;
  readonly retriable: boolean;
  readonly status?: number;

  constructor(message: string, options: AgoraErrorOptions) {
    super(message);
    this.name = "AgoraError";
    this.code = options.code;
    this.retriable = options.retriable ?? false;
    this.status = options.status;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function buildApiErrorResponse(input: {
  message: string;
  code: string;
  retriable?: boolean;
}): ApiErrorResponse {
  return {
    error: input.message,
    code: input.code,
    retriable: input.retriable ?? false,
  };
}
