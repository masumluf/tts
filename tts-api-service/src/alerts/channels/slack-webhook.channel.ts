/** Alert channel: Slack incoming webhook. No-op when the webhook is unset. */
import axios from 'axios';
import { env } from '../../config/env';
import type { AlertPayload, AlertChannel } from '../alert-channel.types';

export const slackWebhookChannel: AlertChannel = {
  name: 'slack-webhook',
  async send(alert: AlertPayload): Promise<void> {
    const webhookUrl = env.ALERT_SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      return;
    }
    const emoji = alert.severity === 'critical' ? ':rotating_light:' : ':warning:';
    await axios.post(
      webhookUrl,
      { text: `${emoji} *[${alert.severity}] ${alert.serviceName}*\n${alert.message}` },
      { timeout: 5000 },
    );
  },
};
