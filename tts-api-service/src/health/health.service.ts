/**
 * Health checks (plan.md Phase 12). Probes each dependency independently and
 * reports healthy | degraded with a per-dependency breakdown. Never throws —
 * a failing probe becomes a "down" entry.
 */
import { pingPostgres } from '../config/prisma';
import { pingRedis } from '../config/redis';
import { modelServerClient } from '../model-server/model-server.client';
import { emailClient } from '../notifications/email.client';
import { storageClient } from '../storage/storage.client';

export type DependencyStatus = 'ok' | 'down';

export interface DependencyReport {
  postgres: DependencyStatus;
  redis: DependencyStatus;
  model_server: DependencyStatus;
  email: DependencyStatus;
  storage: DependencyStatus;
}

export interface HealthReport {
  status: 'healthy' | 'degraded';
  dependencies: DependencyReport;
}

/** Critical dependencies whose failure means the service should refuse jobs. */
export const CRITICAL_DEPENDENCIES: (keyof DependencyReport)[] = ['postgres', 'redis'];

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  try {
    await check();
    return 'ok';
  } catch {
    return 'down';
  }
}

export const healthService = {
  liveness(): { status: 'healthy' } {
    return { status: 'healthy' };
  },

  async dependencies(): Promise<HealthReport> {
    const [postgres, redis, modelServer, email, storage] = await Promise.all([
      probe(() => pingPostgres()),
      probe(() => pingRedis()),
      probe(async () => {
        const healthy = await modelServerClient.isHealthy();
        if (!healthy) throw new Error('model server not ready');
      }),
      probe(() => emailClient.verify()),
      probe(() => storageClient.healthCheck()),
    ]);

    const dependencies: DependencyReport = {
      postgres,
      redis,
      model_server: modelServer,
      email,
      storage,
    };

    const allOk = Object.values(dependencies).every((value) => value === 'ok');
    return { status: allOk ? 'healthy' : 'degraded', dependencies };
  },

  /** True when a critical dependency is down (used to refuse new jobs). */
  async criticalDependencyDown(): Promise<boolean> {
    const report = await this.dependencies();
    return CRITICAL_DEPENDENCIES.some((key) => report.dependencies[key] === 'down');
  },
};

export type HealthService = typeof healthService;
