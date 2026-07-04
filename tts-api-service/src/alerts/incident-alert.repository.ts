/** Data access for `incident_alerts` (skills.md: data access only). */
import type { IncidentAlert, IncidentSeverity, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateIncidentInput {
  serviceName: string;
  severity: IncidentSeverity;
  message: string;
  fingerprint: string;
  metadata?: Prisma.InputJsonValue;
}

export const incidentAlertRepository = {
  /** Most recent open alert matching a fingerprint (for de-duplication). */
  findOpenByFingerprint(fingerprint: string): Promise<IncidentAlert | null> {
    return prisma.incidentAlert.findFirst({
      where: { fingerprint, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });
  },

  create(input: CreateIncidentInput): Promise<IncidentAlert> {
    return prisma.incidentAlert.create({
      data: {
        serviceName: input.serviceName,
        severity: input.severity,
        message: input.message,
        fingerprint: input.fingerprint,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  },

  touch(id: string): Promise<IncidentAlert> {
    return prisma.incidentAlert.update({ where: { id }, data: { updatedAt: new Date() } });
  },
};
