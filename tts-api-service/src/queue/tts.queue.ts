/**
 * BullMQ producer for the TTS generation queue (plan.md Phase 6).
 * Config: attempts, backoff, removeOnComplete/Fail=false (kept for inspection).
 * The per-job timeout is enforced inside the worker (BullMQ v5 dropped the
 * per-job `timeout` option).
 *
 * Recovery interaction: the BullMQ jobId equals our DB id so active duplicates
 * are de-duped. Because finished jobs are retained (removeOnFail/Complete=false),
 * recovery inspects job STATE and removes finished artifacts before re-adding.
 */
import { Queue, type JobState } from 'bullmq';
import { env } from '../config/env';
import { bullConnectionOptions } from '../config/redis';
import { TtsJobPayload } from './queue.constants';

export const ttsQueue = new Queue<TtsJobPayload>(env.TTS_QUEUE_NAME, {
  connection: bullConnectionOptions,
  defaultJobOptions: {
    attempts: env.QUEUE_MAX_ATTEMPTS,
    backoff: { type: env.QUEUE_BACKOFF_TYPE, delay: env.QUEUE_BACKOFF_DELAY_MS },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

/** States in which a job is genuinely pending execution (do not re-enqueue). */
const PENDING_BULL_STATES: ReadonlySet<string> = new Set([
  'waiting',
  'waiting-children',
  'active',
  'delayed',
  'prioritized',
]);

export async function enqueueTtsJob(jobId: string): Promise<void> {
  await ttsQueue.add('generate', { jobId }, { jobId });
}

export async function getQueueDepth(): Promise<number> {
  const counts = await ttsQueue.getJobCounts('waiting', 'active', 'delayed', 'prioritized');
  return Object.values(counts).reduce((total, value) => total + (value ?? 0), 0);
}

/** Current BullMQ state for a DB job id, or null if it isn't in Redis. */
export async function getJobState(jobId: string): Promise<JobState | 'unknown' | null> {
  const job = await ttsQueue.getJob(jobId);
  if (!job) {
    return null;
  }
  return job.getState();
}

export function isPendingState(state: JobState | 'unknown' | null): boolean {
  return state !== null && PENDING_BULL_STATES.has(state);
}

/** Remove a finished/leftover job artifact so its id can be re-enqueued. */
export async function removeJob(jobId: string): Promise<void> {
  const job = await ttsQueue.getJob(jobId);
  if (job) {
    await job.remove();
  }
}

export async function closeQueue(): Promise<void> {
  await ttsQueue.close();
}
