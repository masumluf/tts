/**
 * BullMQ worker processor (plan.md Phase 7).
 * Success: reload from Postgres -> skip if completed -> processing -> call model
 * server -> store WAV -> completed -> success email -> events.
 * Failure: classify -> retry (mark retrying + throw for BullMQ backoff) until
 * max attempts -> mark failed/timeout -> failure email -> incident alert.
 *
 * The worker throws ONLY when it wants BullMQ to retry; this keeps Redis job
 * state and the DB status in lock-step.
 */
import type { Job } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../common/logger/logger';
import { withTimeout } from '../common/utils/timeout';
import { ttsJobRepository } from '../jobs/tts-job.repository';
import { JOB_EVENT_TYPE } from '../jobs/tts-job.constants';
import { userRepository } from '../users/user.repository';
import { modelServerClient } from '../model-server/model-server.client';
import { storageClient } from '../storage/storage.client';
import { notificationService } from '../notifications/notification.service';
import { incidentAlertService } from '../alerts/incident-alert.service';
import { IncidentSeverity, MONITORED_SERVICE } from '../alerts/incident.constants';
import { classifyWorkerError } from './error-classifier';
import type { TtsJobPayload } from '../queue/queue.constants';
import { TtsJobStatus } from '@prisma/client';

async function notifyCompleted(userId: string, jobId: string): Promise<void> {
  try {
    const user = await userRepository.findById(userId);
    if (user?.email) {
      await notificationService.sendJobCompleted({ to: user.email, jobId });
      await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.NOTIFICATION_SENT });
    }
  } catch (error) {
    // Email failure must not corrupt job status (verification.md §11).
    logger.error({ err: error, jobId }, 'Success email failed');
    await ttsJobRepository.addEvent({
      jobId,
      eventType: JOB_EVENT_TYPE.NOTIFICATION_FAILED,
      message: 'success email failed',
    });
    await incidentAlertService.raiseAlert({
      serviceName: MONITORED_SERVICE.EMAIL,
      severity: IncidentSeverity.warning,
      message: 'Failed to send job completion email.',
    });
  }
}

async function notifyFailed(userId: string, jobId: string, reason: string): Promise<void> {
  try {
    const user = await userRepository.findById(userId);
    if (user?.email) {
      await notificationService.sendJobFailed({ to: user.email, jobId, reason });
      await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.NOTIFICATION_SENT });
    }
  } catch (error) {
    logger.error({ err: error, jobId }, 'Failure email failed');
    await ttsJobRepository.addEvent({
      jobId,
      eventType: JOB_EVENT_TYPE.NOTIFICATION_FAILED,
      message: 'failure email failed',
    });
    await incidentAlertService.raiseAlert({
      serviceName: MONITORED_SERVICE.EMAIL,
      severity: IncidentSeverity.warning,
      message: 'Failed to send job failure email.',
    });
  }
}

/** After a terminal failure, alert if the failure rate crosses the threshold. */
async function checkFailureRate(): Promise<void> {
  const since = new Date(Date.now() - env.FAILURE_RATE_WINDOW_MS);
  const failures = await ttsJobRepository.countFailedSince(since);
  if (failures >= env.FAILURE_RATE_THRESHOLD) {
    await incidentAlertService.raiseAlert({
      serviceName: MONITORED_SERVICE.WORKER,
      severity: IncidentSeverity.critical,
      message: `High job failure rate: ${failures} failures in the last ${Math.round(env.FAILURE_RATE_WINDOW_MS / 60000)} minute(s).`,
      fingerprint: 'worker:high-failure-rate',
    });
  }
}

export async function processTtsJob(job: Job<TtsJobPayload>): Promise<void> {
  const jobId = job.data.jobId;
  const record = await ttsJobRepository.findById(jobId);

  if (!record) {
    logger.warn({ jobId }, 'Job not found in Postgres; nothing to process');
    return;
  }
  if (record.status === TtsJobStatus.completed) {
    logger.info({ jobId }, 'Job already completed; skipping (idempotent)');
    return;
  }

  await ttsJobRepository.markProcessing(jobId);
  await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.PROCESSING_STARTED });

  try {
    await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.MODEL_CALL_STARTED });
    const result = await withTimeout(
      modelServerClient.generate(jobId, record.text),
      env.QUEUE_JOB_TIMEOUT_MS,
    );
    await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.MODEL_CALL_COMPLETED });

    const audioPath = await storageClient.putAudio(jobId, result.audio);
    await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.AUDIO_STORED });

    const audioUrl = `${env.PUBLIC_BASE_URL}/v1/tts/jobs/${jobId}/audio`;
    await ttsJobRepository.markCompleted(jobId, {
      audioPath,
      audioUrl,
      ...(result.durationMs !== undefined ? { durationMs: result.durationMs } : {}),
    });
    await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.COMPLETED });

    await notifyCompleted(record.userId, jobId);
    logger.info({ jobId }, 'Job completed');
  } catch (error) {
    const classified = classifyWorkerError(error);
    const attemptNumber = job.attemptsMade + 1; // 1-based
    const isLastAttempt = attemptNumber >= record.maxRetry;

    logger.warn(
      { jobId, attempt: attemptNumber, code: classified.errorCode, internal: classified.internalMessage },
      'Job attempt failed',
    );
    await ttsJobRepository.addEvent({
      jobId,
      eventType: JOB_EVENT_TYPE.MODEL_CALL_FAILED,
      message: classified.internalMessage,
      metadata: { attempt: attemptNumber, code: classified.errorCode },
    });

    if (classified.retryable && !isLastAttempt) {
      await ttsJobRepository.markRetrying(jobId, {
        errorCode: classified.errorCode,
        errorMessage: classified.safeMessage,
        retryCount: attemptNumber,
      });
      await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.RETRYING });
      // Throw so BullMQ retries with backoff.
      throw error;
    }

    // Terminal failure.
    const failInput = {
      errorCode: classified.errorCode,
      errorMessage: classified.safeMessage,
      retryCount: attemptNumber,
    };
    if (classified.errorCode === 'model_timeout') {
      await ttsJobRepository.markTimeout(jobId, failInput);
    } else {
      await ttsJobRepository.markFailed(jobId, failInput);
    }
    await ttsJobRepository.addEvent({ jobId, eventType: JOB_EVENT_TYPE.FAILED });

    // The remaining side effects are independent of one another, so they run
    // concurrently. allSettled: one failing (e.g. email) must not skip the rest.
    const sideEffects: Promise<unknown>[] = [
      notifyFailed(record.userId, jobId, classified.safeMessage),
      checkFailureRate(),
    ];
    if (classified.isDependencyFailure) {
      sideEffects.push(
        incidentAlertService.raiseAlert({
          serviceName: MONITORED_SERVICE.MODEL_SERVER,
          severity: IncidentSeverity.critical,
          message: `Model dependency failure caused job ${jobId} to fail: ${classified.internalMessage}`,
          fingerprint: `model_server:${classified.errorCode}`,
        }),
      );
    }
    await Promise.allSettled(sideEffects);
    // Do NOT rethrow: attempts are exhausted / error is non-retryable, and DB is
    // now the authoritative failed state.
  }
}
