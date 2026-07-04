import { Worker } from 'bullmq';
import { env } from './config/env';
import { logger } from './common/logger/logger';
import { bullConnectionOptions, redis } from './config/redis';
import { disconnectPrisma } from './config/prisma';
import { closeQueue } from './queue/tts.queue';
import { TtsJobPayload } from './queue/queue.constants';
import { processTtsJob } from './workers/tts-job.processor';
import { recoveryService } from './recovery/recovery.service';

async function main(): Promise<void> {
  // BullMQ creates and owns the worker's connection from these options; it is
  // closed by worker.close() during shutdown.
  const worker = new Worker<TtsJobPayload>(env.TTS_QUEUE_NAME, processTtsJob, {
    connection: bullConnectionOptions,
    concurrency: env.WORKER_CONCURRENCY,
  });

  worker.on('completed', (job) => logger.info({ jobId: job.data.jobId }, 'BullMQ job completed'));
  worker.on('failed', (job, err) =>
    logger.warn({ jobId: job?.data.jobId, err }, 'BullMQ job failed (attempt)'),
  );
  worker.on('error', (err) => logger.error({ err }, 'Worker error'));

  logger.info({ concurrency: env.WORKER_CONCURRENCY, queue: env.TTS_QUEUE_NAME }, 'Worker started');

  // Recovery on startup + periodically.
  await recoveryService.runScan().catch((error) => logger.error({ err: error }, 'Startup recovery failed'));
  const recoveryTimer = setInterval(() => {
    recoveryService.runScan().catch((error) => logger.error({ err: error }, 'Periodic recovery failed'));
  }, env.RECOVERY_INTERVAL_MS);
  recoveryTimer.unref();

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down worker');
    void (async () => {
      try {
        clearInterval(recoveryTimer);
        // Stop consuming first (this also closes the worker's own connection),
        // then close independent resources in parallel.
        await worker.close();
        await Promise.allSettled([closeQueue(), disconnectPrisma()]);
        redis.disconnect();
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error({ err: error }, 'Fatal worker startup error');
  process.exit(1);
});
