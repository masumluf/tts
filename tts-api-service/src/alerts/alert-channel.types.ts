/** Shared alert channel contract. */
import type { IncidentSeverity } from '@prisma/client';

export interface AlertPayload {
  serviceName: string;
  severity: IncidentSeverity;
  message: string;
  fingerprint: string;
}

export interface AlertChannel {
  name: string;
  send(alert: AlertPayload): Promise<void>;
}
