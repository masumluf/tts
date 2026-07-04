import { env } from '../config/env';
import { AppError } from '../common/errors/app-error';
import { logger } from '../common/logger/logger';
import type { AuthUserContext } from '../common/types/context.types';
import { checkUserRateLimit } from '../common/rate-limit/rate-limiter';
import { enqueueTtsJob, getQueueDepth } from '../queue/tts.queue';
import { storageClient } from '../storage/storage.client';
import { incidentAlertService } from '../alerts/incident-alert.service';
import { IncidentSeverity, MONITORED_SERVICE } from '../alerts/incident.constants';
import { ttsJobRepository } from './tts-job.repository';
import { JOB_EVENT_TYPE } from './tts-job.constants';
import type { CreateTtsJobInput, ListJobsQuery } from './tts-job.schemas';
import type { CreateJobResult, JobListResult, JobStatusView } from './tts-job.types';
import type { TtsJob } from '@prisma/client';
import { TtsJobStatus } from '@prisma/client';

const ACCEPTED_MESSAGE =
  'Your audio generation request has been accepted. You will receive an email when it is ready.';

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function toIso(value: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

function toStatusView(job: TtsJob): JobStatusView {
  const view: JobStatusView = {
    jobId: job.id,
    status: job.status,
    createdAt: job.createdAt.toISOString(),
  };
  if (job.audioUrl) view.audioUrl = job.audioUrl;
  if (job.durationMs !== null) view.durationMs = job.durationMs;
  if (job.errorCode !== null) view.errorCode = job.errorCode;
  if (job.errorMessage !== null) view.errorMessage = job.errorMessage;
  const queuedAt = toIso(job.queuedAt);
  const startedAt = toIso(job.startedAt);
  const completedAt = toIso(job.completedAt);
  const failedAt = toIso(job.failedAt);
  if (queuedAt) view.queuedAt = queuedAt;
  if (startedAt) view.startedAt = startedAt;
  if (completedAt) view.completedAt = completedAt;
  if (failedAt) view.failedAt = failedAt;
  return view;
}

/** Loads a job and enforces per-user ownership (404 vs 403 per plan). */
async function loadOwnedJob(user: AuthUserContext, jobId: string): Promise<TtsJob> {
  const job = await ttsJobRepository.findById(jobId);
  if (!job) {
    throw AppError.notFound('Job not found.');
  }
  if (job.userId !== user.userId) {
    throw AppError.forbidden('You do not have access to this job.');
  }
  return job;
}

export const ttsJobService = {
  async createJob(user: AuthUserContext, input: CreateTtsJobInput): Promise<CreateJobResult> {
    // 1. size -> 413
    if (input.text.length > env.MAX_TEXT_LENGTH) {
      throw AppError.payloadTooLarge(`Text exceeds the maximum length of ${env.MAX_TEXT_LENGTH} characters.`);
    }

    // 2. monthly quota -> 429
    // Steps 2 and 4 are independent read-only counts — fetch them in parallel.
    const [usedThisMonth, pending] = await Promise.all([
      ttsJobRepository.countCreatedSince(user.userId, startOfCurrentMonth()),
      ttsJobRepository.countPendingByUser(user.userId),
    ]);

    // Evaluate in precedence order (plan.md Phase 4): quota -> rate limit -> pending.
    if (usedThisMonth >= user.monthlyQuota) {
      throw AppError.tooManyRequests('Monthly quota exceeded.');
    }

    // 3. per-user rate limit -> 429. This has a side effect (increments a Redis
    // counter), so it runs AFTER the quota check — a quota-rejected request must
    // not consume a rate-limit token.
    const rate = await checkUserRateLimit(user.userId, user.rateLimitPerMinute);
    if (!rate.allowed) {
      throw AppError.tooManyRequests('Rate limit exceeded. Please slow down.');
    }

    // 4. per-user pending backpressure -> 429
    if (pending >= env.MAX_PENDING_JOBS_PER_USER) {
      throw AppError.tooManyRequests('Too many pending jobs. Please wait for existing jobs to finish.');
    }

    // 5. global queue backpressure -> 503 (resilient: skip if Redis unreachable)
    try {
      const depth = await getQueueDepth();
      if (depth >= env.GLOBAL_QUEUE_MAX) {
        throw AppError.serviceUnavailable('The service is busy. Please try again shortly.');
      }
    } catch (error) {
      if (AppError.isAppError(error)) {
        throw error;
      }
      logger.warn({ err: error }, 'Queue depth check failed; proceeding (job is durable)');
    }

    // 6. persist (source of truth) + event
    const job = await ttsJobRepository.create({
      userId: user.userId,
      text: input.text,
      maxRetry: env.QUEUE_MAX_ATTEMPTS,
    });
    await ttsJobRepository.addEvent({ jobId: job.id, eventType: JOB_EVENT_TYPE.CREATED });

    // 7. enqueue (best-effort; recovery re-enqueues on failure)
    try {
      await enqueueTtsJob(job.id);
      await ttsJobRepository.addEvent({ jobId: job.id, eventType: JOB_EVENT_TYPE.ENQUEUED });
    } catch (error) {
      logger.error({ err: error, jobId: job.id }, 'Failed to enqueue job; recovery will re-enqueue');
      await incidentAlertService.raiseAlert({
        serviceName: MONITORED_SERVICE.QUEUE,
        severity: IncidentSeverity.warning,
        message: 'Failed to enqueue a job to Redis; relying on recovery.',
      });
    }

    return { jobId: job.id, status: job.status, message: ACCEPTED_MESSAGE };
  },

  async getJob(user: AuthUserContext, jobId: string): Promise<JobStatusView> {
    const job = await loadOwnedJob(user, jobId);
    return toStatusView(job);
  },

  async listJobs(user: AuthUserContext, query: ListJobsQuery): Promise<JobListResult> {
    const result = await ttsJobRepository.listByUser({
      userId: user.userId,
      limit: query.limit,
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
    return {
      items: result.items.map((job) => ({
        jobId: job.id,
        status: job.status,
        createdAt: job.createdAt.toISOString(),
        ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
      })),
      nextCursor: result.nextCursor,
    };
  },

  /**
   * Ownership-checked audio access. Returns a readable stream of the WAV.
   * 404 if the job isn't completed or has no stored audio.
   */
  async getAudioStream(user: AuthUserContext, jobId: string): Promise<NodeJS.ReadableStream> {
    const job = await loadOwnedJob(user, jobId);
    if (job.status !== TtsJobStatus.completed || !job.audioPath) {
      throw AppError.notFound('Audio is not available for this job.');
    }
    const exists = await storageClient.objectExists(job.audioPath);
    if (!exists) {
      throw AppError.notFound('Audio file is missing from storage.');
    }
    return storageClient.getObjectStream(job.audioPath);
  },
};

export type TtsJobService = typeof ttsJobService;
