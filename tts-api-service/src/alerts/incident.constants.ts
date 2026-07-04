/** Incident constants. Severity/status enums re-exported from Prisma (DRY). */
import { IncidentSeverity, IncidentStatus } from '@prisma/client';

export { IncidentSeverity, IncidentStatus };

export const MONITORED_SERVICE = {
  POSTGRES: 'postgres',
  REDIS: 'redis',
  MODEL_SERVER: 'model_server',
  EMAIL: 'email',
  STORAGE: 'storage',
  QUEUE: 'queue',
  WORKER: 'worker',
} as const;

export type MonitoredService = (typeof MONITORED_SERVICE)[keyof typeof MONITORED_SERVICE];
