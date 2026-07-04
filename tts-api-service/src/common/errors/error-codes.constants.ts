/**
 * Single source of truth for API error codes and their HTTP mapping
 * (plan.md Phase 13). DRY: never re-type these strings/numbers elsewhere.
 */
import { HTTP_STATUS, type HttpStatus } from '../constants/http-status.constants';

export const ERROR_CODE = {
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  RATE_LIMITED: 'rate_limited',
  SERVICE_UNAVAILABLE: 'service_unavailable',
  GATEWAY_TIMEOUT: 'gateway_timeout',
  INTERNAL: 'internal',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export const ERROR_STATUS: Record<ErrorCode, HttpStatus> = {
  [ERROR_CODE.BAD_REQUEST]: HTTP_STATUS.BAD_REQUEST,
  [ERROR_CODE.UNAUTHORIZED]: HTTP_STATUS.UNAUTHORIZED,
  [ERROR_CODE.FORBIDDEN]: HTTP_STATUS.FORBIDDEN,
  [ERROR_CODE.NOT_FOUND]: HTTP_STATUS.NOT_FOUND,
  [ERROR_CODE.PAYLOAD_TOO_LARGE]: HTTP_STATUS.PAYLOAD_TOO_LARGE,
  [ERROR_CODE.RATE_LIMITED]: HTTP_STATUS.TOO_MANY_REQUESTS,
  [ERROR_CODE.SERVICE_UNAVAILABLE]: HTTP_STATUS.SERVICE_UNAVAILABLE,
  [ERROR_CODE.GATEWAY_TIMEOUT]: HTTP_STATUS.GATEWAY_TIMEOUT,
  [ERROR_CODE.INTERNAL]: HTTP_STATUS.INTERNAL_SERVER_ERROR,
};
