import type { TtsJob } from '@prisma/client';
import type { AuthUserContext } from '../../src/common/types/context.types';

jest.mock('../../src/jobs/tts-job.repository', () => ({
  ttsJobRepository: {
    create: jest.fn(),
    addEvent: jest.fn().mockResolvedValue(undefined),
    findById: jest.fn(),
    listByUser: jest.fn(),
    countPendingByUser: jest.fn().mockResolvedValue(0),
    countCreatedSince: jest.fn().mockResolvedValue(0),
  },
}));
jest.mock('../../src/common/rate-limit/rate-limiter', () => ({
  checkUserRateLimit: jest.fn().mockResolvedValue({ allowed: true, remaining: 10 }),
}));
jest.mock('../../src/queue/tts.queue', () => ({
  enqueueTtsJob: jest.fn().mockResolvedValue(undefined),
  getQueueDepth: jest.fn().mockResolvedValue(0),
}));
jest.mock('../../src/storage/storage.client', () => ({ storageClient: {} }));
jest.mock('../../src/alerts/incident-alert.service', () => ({
  incidentAlertService: { raiseAlert: jest.fn().mockResolvedValue(undefined) },
}));

import { ttsJobService } from '../../src/jobs/tts-job.service';
import { ttsJobRepository } from '../../src/jobs/tts-job.repository';
import { checkUserRateLimit } from '../../src/common/rate-limit/rate-limiter';
import { AppError } from '../../src/common/errors/app-error';

const repo = ttsJobRepository as jest.Mocked<typeof ttsJobRepository>;
const rateLimit = checkUserRateLimit as jest.MockedFunction<typeof checkUserRateLimit>;

const user: AuthUserContext = {
  userId: 'user-1',
  email: 'u1@example.com',
  rateLimitPerMinute: 60,
  monthlyQuota: 3,
};

function fakeJob(overrides: Partial<TtsJob> = {}): TtsJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    text: 'হ্যালো',
    status: 'queued',
    retryCount: 0,
    maxRetry: 3,
    errorCode: null,
    errorMessage: null,
    audioUrl: null,
    audioPath: null,
    durationMs: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    queuedAt: new Date(),
    startedAt: null,
    completedAt: null,
    failedAt: null,
    ...overrides,
  };
}

describe('ttsJobService.createJob', () => {
  it('creates a queued job and enqueues it', async () => {
    repo.create.mockResolvedValue(fakeJob());
    const result = await ttsJobService.createJob(user, { text: 'হ্যালো' });
    expect(result.jobId).toBe('job-1');
    expect(result.status).toBe('queued');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('rejects oversized text with 413', async () => {
    const longText = 'হ্যালো'.repeat(50); // exceeds MAX_TEXT_LENGTH=20
    await expect(ttsJobService.createJob(user, { text: longText })).rejects.toMatchObject({
      code: 'payload_too_large',
    });
  });

  it('rejects when monthly quota is exceeded with 429', async () => {
    repo.countCreatedSince.mockResolvedValueOnce(3);
    await expect(ttsJobService.createJob(user, { text: 'হ্যালো' })).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('rejects when rate-limited with 429', async () => {
    rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0 });
    await expect(ttsJobService.createJob(user, { text: 'হ্যালো' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('ttsJobService.getJob (per-user isolation)', () => {
  it('returns 404 when the job does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(ttsJobService.getJob(user, 'missing')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('returns 403 when the job belongs to another user', async () => {
    repo.findById.mockResolvedValue(fakeJob({ userId: 'someone-else' }));
    await expect(ttsJobService.getJob(user, 'job-1')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('returns the job for its owner', async () => {
    repo.findById.mockResolvedValue(fakeJob());
    const view = await ttsJobService.getJob(user, 'job-1');
    expect(view.jobId).toBe('job-1');
  });
});
