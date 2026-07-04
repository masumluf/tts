/**
 * Redis disaster-recovery service (plan.md Phase 9).
 * Postgres is the source of truth. This scans for jobs Postgres considers
 * unfinished and re-enqueues those missing from Redis. It is idempotent:
 *   - queued / retrying / stale-processing / failed-with-retries -> re-enqueue
 *   - job already pending in Redis                               -> leave alone
 *   - completed                                                  -> never touched
 *   - failed with no retries left                                -> never touched
 */
import type { TtsJob } from '@prisma/client';
import { env } from '../config/env';
import { logger } from '../common/logger/logger';
import { ttsJobRepository } from '../jobs/tts-job.repository';
import { JOB_EVENT_TYPE } from '../jobs/tts-job.constants';
import { enqueueTtsJob, getJobState, isPendingState, removeJob } from '../queue/tts.queue';

/** Max jobs recovered in parallel per batch (bounds DB/Redis pool pressure). */
const RECOVERY_CONCURRENCY = 10;

export interface RecoverySummary {
  scanned: number;
  reEnqueued: number;
  skippedPending: number;
}

export const recoveryService = {
  async runScan(): Promise<RecoverySummary> {
    if (!env.RECOVERY_ENABLED) {
      return { scanned: 0, reEnqueued: 0, skippedPending: 0 };
    }

    const staleBefore = new Date(Date.now() - env.STALE_PROCESSING_TIMEOUT_MS);
    const candidates = await ttsJobRepository.findJobsForRecovery(staleBefore);
    let reEnqueued = 0;
    let skippedPending = 0;

    // Jobs are independent of each other, so we recover them in parallel — but
    // in bounded batches so a large backlog doesn't exhaust the DB/Redis pools.
    // The steps WITHIN a single job stay sequential (requeue must precede
    // enqueue). Each job self-contains its errors, so one failure can't abort
    // the batch.
    const recoverOne = async (job: TtsJob): Promise<'reEnqueued' | 'skippedPending' | 'error'> => {
      try {
        const state = await getJobState(job.id);
        if (isPendingState(state)) {
          // Genuinely still queued/active in Redis — do not duplicate.
          return 'skippedPending';
        }
        // Remove any finished/leftover Redis artifact so the id can be re-added
        // (jobs are retained with removeOnComplete/Fail=false).
        if (state !== null) {
          await removeJob(job.id);
        }
        await ttsJobRepository.requeue(job.id);
        await enqueueTtsJob(job.id);
        await ttsJobRepository.addEvent({
          jobId: job.id,
          eventType: JOB_EVENT_TYPE.RECOVERED,
          message: `re-enqueued by recovery (was ${job.status})`,
        });
        return 'reEnqueued';
      } catch (error) {
        logger.error({ err: error, jobId: job.id }, 'Recovery failed for job');
        return 'error';
      }
    };

    for (let offset = 0; offset < candidates.length; offset += RECOVERY_CONCURRENCY) {
      const batch = candidates.slice(offset, offset + RECOVERY_CONCURRENCY);
      const outcomes = await Promise.all(batch.map(recoverOne));
      for (const outcome of outcomes) {
        if (outcome === 'reEnqueued') {
          reEnqueued += 1;
        } else if (outcome === 'skippedPending') {
          skippedPending += 1;
        }
      }
    }

    const summary: RecoverySummary = { scanned: candidates.length, reEnqueued, skippedPending };
    logger.info(summary, 'Recovery scan complete');
    return summary;
  },
};

export type RecoveryService = typeof recoveryService;
