import { env } from './config/env';
import { logger } from './common/logger/logger';
import { createApp } from './app';
import { disconnectPrisma } from './config/prisma';
import { redis } from './config/redis';
import { closeQueue } from './queue/tts.queue';
import { recoveryService } from './recovery/recovery.service';

async function main(): Promise<void> {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');
  });

  // Best-effort recovery on startup (never blocks serving traffic).
  recoveryService.runScan().catch((error) => {
    logger.error({ err: error }, 'Startup recovery scan failed');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down API');
    server.close(() => {
      void (async () => {
        try {
          // Independent cleanups run in parallel; allSettled so one failure
          // doesn't skip the others.
          await Promise.allSettled([closeQueue(), disconnectPrisma()]);
          redis.disconnect();
        } finally {
          process.exit(0);
        }
      })();
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal API startup error');
  process.exit(1);
});
