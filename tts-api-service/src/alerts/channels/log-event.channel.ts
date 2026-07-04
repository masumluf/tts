/** Alert channel: structured log event (stands in for Sentry/Datadog sink). */
import { logger } from '../../common/logger/logger';
import type { AlertPayload, AlertChannel } from '../alert-channel.types';

export const logEventChannel: AlertChannel = {
  name: 'log-event',
  send(alert: AlertPayload): Promise<void> {
    logger.error(
      { incident: { service: alert.serviceName, severity: alert.severity, fingerprint: alert.fingerprint } },
      `INCIDENT [${alert.severity}] ${alert.serviceName}: ${alert.message}`,
    );
    return Promise.resolve();
  },
};
