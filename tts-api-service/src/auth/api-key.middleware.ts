/**
 * API-key authentication middleware.
 * Reads `Authorization: Bearer <api_key>`, resolves the user, and attaches a
 * narrow AuthUserContext to the request. Missing/invalid -> 401 (via AppError).
 */
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../common/errors/app-error';
import type { AuthUserContext } from '../common/types/context.types';
import { resolveApiKey } from './auth.service';

const BEARER_PREFIX = 'Bearer ';

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    next(AppError.unauthorized('Missing or malformed Authorization header.'));
    return;
  }

  const apiKey = header.slice(BEARER_PREFIX.length).trim();
  if (apiKey.length === 0) {
    next(AppError.unauthorized('API key is required.'));
    return;
  }

  resolveApiKey(apiKey)
    .then((context) => {
      if (!context) {
        next(AppError.unauthorized('Invalid API key.'));
        return;
      }
      req.authUser = context;
      next();
    })
    .catch(next);
}

/**
 * Reads the authenticated context set by `authenticate`. Throws internal if
 * called on an unauthenticated route (programming error, never a client fault).
 */
export function getAuthUserContext(req: Request): AuthUserContext {
  if (!req.authUser) {
    throw AppError.internal('Auth context missing on a protected route.', {
      internalMessage: 'getAuthUserContext called before authenticate middleware.',
    });
  }
  return req.authUser;
}
