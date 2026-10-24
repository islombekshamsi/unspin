import { z } from "zod";

/** Error codes and their HTTP status. Messages must never contain secrets, provider payloads, storage keys, or source text. */
export const ERROR_STATUS = {
  bad_request: 400,
  invalid_selection: 400,
  preview_required: 400,
  consent_required: 400,
  partial_ack_required: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  version_conflict: 409,
  idempotency_conflict: 409,
  payload_too_large: 413,
  too_many_rows: 413,
  too_many_columns: 413,
  too_many_pixels: 413,
  unsupported_media_type: 415,
  encrypted_file: 415,
  unsupported_operation: 422,
  extraction_failed: 422,
  no_data_found: 422,
  semantic_validation_failed: 422,
  unreadable_source: 422,
  rate_limited: 429,
  provider_quota: 429,
  provider_failure: 502,
  invalid_provider_response: 502,
  not_configured: 503,
  persistence_unavailable: 503,
  timeout: 504,
  cancelled: 499,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;
export const ErrorCodeSchema = z.enum(Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]]);

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
  requestId: z.string(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/**
 * Typed failure thrown by any server module. Route handlers convert it to the
 * error envelope. `details` must be safe to show to the owning user.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
