/**
 * Centralized application error with factory methods (skills.md).
 *  - Services throw `AppError`; controllers call next(error).
 *  - The centralized error handler is the ONLY place that formats HTTP JSON.
 *  - `message` is customer-safe. Internal detail goes in `internalMessage`
 *    (logged, never returned to the client).
 */
import { ERROR_CODE, ERROR_STATUS, type ErrorCode } from './error-codes.constants';
import type { HttpStatus } from '../constants/http-status.constants';

interface AppErrorOptions {
  /** Non-customer-facing detail for logs only. */
  internalMessage?: string;
  /** Underlying error for the cause chain. */
  cause?: unknown;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: HttpStatus;
  public readonly internalMessage: string | undefined;
  public readonly isOperational = true;

  private constructor(code: ErrorCode, message: string, options?: AppErrorOptions) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = ERROR_STATUS[code];
    this.internalMessage = options?.internalMessage;
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message = 'Invalid request.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.BAD_REQUEST, message, options);
  }

  static unauthorized(message = 'Authentication required.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.UNAUTHORIZED, message, options);
  }

  static forbidden(message = 'You do not have access to this resource.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.FORBIDDEN, message, options);
  }

  static notFound(message = 'Resource not found.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.NOT_FOUND, message, options);
  }

  static payloadTooLarge(message = 'Request payload is too large.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.PAYLOAD_TOO_LARGE, message, options);
  }

  static tooManyRequests(message = 'Too many requests. Please slow down and try again shortly.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.RATE_LIMITED, message, options);
  }

  static serviceUnavailable(message = 'The service is temporarily busy. Please try again later.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.SERVICE_UNAVAILABLE, message, options);
  }

  static gatewayTimeout(message = 'The request timed out. Please try again.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.GATEWAY_TIMEOUT, message, options);
  }

  static internal(message = 'An unexpected error occurred.', options?: AppErrorOptions): AppError {
    return new AppError(ERROR_CODE.INTERNAL, message, options);
  }

  static isAppError(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}
