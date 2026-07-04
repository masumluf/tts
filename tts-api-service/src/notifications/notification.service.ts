/**
 * Notification service (plan.md Phase 11). ONLY this service sends emails.
 * Builds success/failure emails and delegates delivery to the email client.
 * Callers (the worker) wrap these in try/catch so a mail failure never corrupts
 * job status; failures here surface as thrown errors for the caller to record.
 */
import { env } from '../config/env';
import { emailClient } from './email.client';

export interface JobCompletedNotification {
  to: string;
  jobId: string;
}

export interface JobFailedNotification {
  to: string;
  jobId: string;
  /** Customer-safe failure reason (no internal/model detail). */
  reason: string;
}

function downloadUrl(jobId: string): string {
  return `${env.PUBLIC_BASE_URL}/v1/tts/jobs/${jobId}/audio`;
}

export const notificationService = {
  async sendJobCompleted(notification: JobCompletedNotification): Promise<void> {
    const link = downloadUrl(notification.jobId);
    await emailClient.send({
      to: notification.to,
      subject: `Your audio is ready (job ${notification.jobId})`,
      text: [
        `Your text-to-speech job ${notification.jobId} completed successfully.`,
        '',
        `Download your audio: ${link}`,
        '(This endpoint requires your API key.)',
      ].join('\n'),
    });
  },

  async sendJobFailed(notification: JobFailedNotification): Promise<void> {
    await emailClient.send({
      to: notification.to,
      subject: `Your audio request failed (job ${notification.jobId})`,
      text: [
        `Your text-to-speech job ${notification.jobId} could not be completed.`,
        `Reason: ${notification.reason}`,
        '',
        'Please try submitting your request again. If the problem persists, contact support.',
      ].join('\n'),
    });
  },
};

export type NotificationService = typeof notificationService;
