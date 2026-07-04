/**
 * Centralized error handling (plan.md Phase 13, skills.md).
 * The ONLY place that formats error JSON. Maps AppError + ZodError to safe
 * responses; everything else becomes a 500 with no internal detail leaked.
 * Internal detail is logged with the request correlation id.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from './app-error';
import { ERROR_CODE } from './error-codes.constants';
import { HTTP_STATUS } from '../constants/http-status.constants';
import { logger } from '../logger/logger';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorBody = {
    error: { code: ERROR_CODE.NOT_FOUND, message: 'The requested resource was not found.' },
  };
  res.status(HTTP_STATUS.NOT_FOUND).json(body);
}

// Express identifies error handlers by arity (4 args); `next` must be present.
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const correlationId = req.correlationId ?? 'unknown';

  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      error: { code: ERROR_CODE.BAD_REQUEST, message: 'Invalid request payload.', details },
    } satisfies ErrorBody);
    return;
  }

  if (AppError.isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error({ correlationId, code: err.code, internal: err.internalMessage, err }, err.message);
    } else {
      logger.warn({ correlationId, code: err.code }, err.message);
    }
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    } satisfies ErrorBody);
    return;
  }

  // Unknown/unexpected error: log everything, expose nothing.
  logger.error({ correlationId, err }, 'Unhandled error');
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    error: { code: ERROR_CODE.INTERNAL, message: 'An unexpected error occurred.' },
  } satisfies ErrorBody);
}
