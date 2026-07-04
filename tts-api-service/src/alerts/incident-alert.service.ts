/**
 * Incident alerting (plan.md Phase 10).
 * Persists to `incident_alerts`, de-dupes by fingerprint (so repeated failures
 * of the same kind don't spam channels), and fans out to channels. A channel
 * failure is logged but never propagates — alerting must not crash callers.
 */
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { logger } from '../common/logger/logger';
import { incidentAlertRepository } from './incident-alert.repository';
import { logEventChannel } from './channels/log-event.channel';
import { slackWebhookChannel } from './channels/slack-webhook.channel';
import type { AlertChannel } from './alert-channel.types';
import { IncidentSeverity } from './incident.constants';

const channels: AlertChannel[] = [logEventChannel, slackWebhookChannel];

export interface RaiseAlertInput {
  serviceName: string;
  severity: IncidentSeverity;
  message: string;
  /** Optional explicit dedupe key; defaults to serviceName + hashed message. */
  fingerprint?: string;
  metadata?: Prisma.InputJsonValue;
}

function buildFingerprint(input: RaiseAlertInput): string {
  if (input.fingerprint) {
    return input.fingerprint;
  }
  const digest = createHash('sha256').update(input.message).digest('hex').slice(0, 16);
  return `${input.serviceName}:${input.severity}:${digest}`;
}

export const incidentAlertService = {
  async raiseAlert(input: RaiseAlertInput): Promise<void> {
    const fingerprint = buildFingerprint(input);
    try {
      const existing = await incidentAlertRepository.findOpenByFingerprint(fingerprint);
      if (existing) {
        // Already alerting on this; refresh timestamp, don't re-notify.
        await incidentAlertRepository.touch(existing.id);
        return;
      }

      await incidentAlertRepository.create({
        serviceName: input.serviceName,
        severity: input.severity,
        message: input.message,
        fingerprint,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      });

      await Promise.allSettled(
        channels.map((channel) =>
          channel.send({ serviceName: input.serviceName, severity: input.severity, message: input.message, fingerprint }),
        ),
      ).then((results) => {
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.warn(
              { channel: channels[index]?.name, reason: String(result.reason) },
              'Alert channel delivery failed',
            );
          }
        });
      });
    } catch (error) {
      // Never let alerting throw into business flows.
      logger.error({ err: error }, 'Failed to raise incident alert');
    }
  },
};

export type IncidentAlertService = typeof incidentAlertService;
