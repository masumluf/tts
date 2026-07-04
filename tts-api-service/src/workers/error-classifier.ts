/**
 * Maps a raw worker error to a persisted error code, a customer-safe message,
 * and whether it should be retried (skills.md: no `any`; narrow `unknown`).
 */
import { JobErrorCode } from '@prisma/client';
import { ModelServerError } from '../model-server/model-server.client';
import { TimeoutError } from '../common/utils/timeout';

export interface ClassifiedError {
  errorCode: JobErrorCode;
  /** Customer-safe message stored on the job + emailed. */
  safeMessage: string;
  /** Non-safe detail for logs/events only. */
  internalMessage: string;
  retryable: boolean;
  /** Dependency failure that also warrants an incident alert. */
  isDependencyFailure: boolean;
}

export function classifyWorkerError(error: unknown): ClassifiedError {
  if (error instanceof TimeoutError) {
    return {
      errorCode: JobErrorCode.model_timeout,
      safeMessage: 'Audio generation timed out. Please try again.',
      internalMessage: 'Model generation exceeded the job timeout.',
      retryable: true,
      isDependencyFailure: true,
    };
  }

  if (error instanceof ModelServerError) {
    switch (error.kind) {
      case 'timeout':
        return {
          errorCode: JobErrorCode.model_timeout,
          safeMessage: 'Audio generation timed out. Please try again.',
          internalMessage: error.message,
          retryable: true,
          isDependencyFailure: true,
        };
      case 'network':
        return {
          errorCode: JobErrorCode.network_error,
          safeMessage: 'Audio service was temporarily unreachable. Please try again.',
          internalMessage: error.message,
          retryable: true,
          isDependencyFailure: true,
        };
      case 'server_error':
        return {
          errorCode: JobErrorCode.model_error,
          safeMessage: 'Audio generation failed. Please try submitting your request again.',
          internalMessage: error.message,
          retryable: true,
          isDependencyFailure: true,
        };
      case 'bad_request':
        return {
          errorCode: JobErrorCode.model_error,
          safeMessage: 'The submitted text could not be processed.',
          internalMessage: error.message,
          retryable: false,
          isDependencyFailure: false,
        };
      case 'unauthorized':
        return {
          errorCode: JobErrorCode.model_error,
          safeMessage: 'Audio generation failed. Please try again later.',
          internalMessage: 'Model server rejected the internal token (configuration issue).',
          retryable: false,
          isDependencyFailure: true,
        };
    }
  }

  return {
    errorCode: JobErrorCode.unknown,
    safeMessage: 'Audio generation failed. Please try submitting your request again.',
    internalMessage: error instanceof Error ? error.message : 'Unknown worker error.',
    retryable: true,
    isDependencyFailure: false,
  };
}
