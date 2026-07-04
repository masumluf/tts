/**
 * Data access for `tts_jobs` and `job_events` (skills.md: data access only).
 * User-scoped reads always filter by userId (per-user isolation). Worker and
 * recovery updates are id-scoped (the worker is trusted, but reloads from here
 * because Postgres is the source of truth).
 */
import type { JobErrorCode, Prisma, TtsJob } from '@prisma/client';
import { prisma } from '../config/prisma';
import { TtsJobStatus } from '@prisma/client';

const PENDING_STATUSES: TtsJobStatus[] = [
  TtsJobStatus.queued,
  TtsJobStatus.processing,
  TtsJobStatus.retrying,
];

export interface CreateJobInput {
  userId: string;
  text: string;
  maxRetry: number;
}

export interface AddEventInput {
  jobId: string;
  eventType: string;
  message?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface CompleteJobInput {
  audioPath: string;
  audioUrl: string;
  durationMs?: number;
}

export interface FailJobInput {
  errorCode: JobErrorCode;
  errorMessage: string;
  retryCount?: number;
}

export interface ListByUserInput {
  userId: string;
  limit: number;
  cursor?: string;
}

export const ttsJobRepository = {
  create(input: CreateJobInput): Promise<TtsJob> {
    return prisma.ttsJob.create({
      data: {
        userId: input.userId,
        text: input.text,
        status: TtsJobStatus.queued,
        maxRetry: input.maxRetry,
        queuedAt: new Date(),
      },
    });
  },

  async addEvent(input: AddEventInput): Promise<void> {
    await prisma.jobEvent.create({
      data: {
        jobId: input.jobId,
        eventType: input.eventType,
        ...(input.message !== undefined ? { message: input.message } : {}),
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      },
    });
  },

  findById(id: string): Promise<TtsJob | null> {
    return prisma.ttsJob.findUnique({ where: { id } });
  },

  async listByUser(input: ListByUserInput): Promise<{ items: TtsJob[]; nextCursor: string | null }> {
    const rows = await prisma.ttsJob.findMany({
      where: { userId: input.userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor !== undefined ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;
    return { items, nextCursor };
  },

  countPendingByUser(userId: string): Promise<number> {
    return prisma.ttsJob.count({ where: { userId, status: { in: PENDING_STATUSES } } });
  },

  countCreatedSince(userId: string, since: Date): Promise<number> {
    return prisma.ttsJob.count({ where: { userId, createdAt: { gte: since } } });
  },

  async markProcessing(id: string): Promise<void> {
    await prisma.ttsJob.update({
      where: { id },
      data: { status: TtsJobStatus.processing, startedAt: new Date() },
    });
  },

  async markCompleted(id: string, input: CompleteJobInput): Promise<void> {
    await prisma.ttsJob.update({
      where: { id },
      data: {
        status: TtsJobStatus.completed,
        audioPath: input.audioPath,
        audioUrl: input.audioUrl,
        durationMs: input.durationMs ?? null,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
  },

  async markRetrying(id: string, input: FailJobInput): Promise<void> {
    await prisma.ttsJob.update({
      where: { id },
      data: {
        status: TtsJobStatus.retrying,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
      },
    });
  },

  async markFailed(id: string, input: FailJobInput): Promise<void> {
    await prisma.ttsJob.update({
      where: { id },
      data: {
        status: TtsJobStatus.failed,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        failedAt: new Date(),
        ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
      },
    });
  },

  async markTimeout(id: string, input: FailJobInput): Promise<void> {
    await prisma.ttsJob.update({
      where: { id },
      data: {
        status: TtsJobStatus.timeout,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        failedAt: new Date(),
        ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
      },
    });
  },

  /**
   * Recovery scan (plan.md Phase 9). Returns jobs Postgres considers unfinished:
   *  - queued / retrying (should be in Redis)
   *  - processing older than the stale cutoff (worker likely died)
   *  - failed but with retries remaining
   * Completed jobs are never returned.
   */
  findJobsForRecovery(staleBefore: Date): Promise<TtsJob[]> {
    return prisma.ttsJob.findMany({
      where: {
        OR: [
          { status: { in: [TtsJobStatus.queued, TtsJobStatus.retrying] } },
          { status: TtsJobStatus.processing, updatedAt: { lt: staleBefore } },
          {
            status: { in: [TtsJobStatus.failed, TtsJobStatus.timeout] },
            retryCount: { lt: prisma.ttsJob.fields.maxRetry },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  },

  countFailedSince(since: Date): Promise<number> {
    return prisma.ttsJob.count({
      where: {
        status: { in: [TtsJobStatus.failed, TtsJobStatus.timeout] },
        failedAt: { gte: since },
      },
    });
  },

  async requeue(id: string): Promise<void> {
    await prisma.ttsJob.update({
      where: { id },
      data: { status: TtsJobStatus.queued, queuedAt: new Date() },
    });
  },
};

export type TtsJobRepository = typeof ttsJobRepository;
