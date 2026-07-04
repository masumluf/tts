import type { TtsJob } from '@prisma/client';

const PENDING = ['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'];

jest.mock('../../src/jobs/tts-job.repository', () => ({
  ttsJobRepository: {
    findJobsForRecovery: jest.fn(),
    requeue: jest.fn().mockResolvedValue(undefined),
    addEvent: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../src/queue/tts.queue', () => ({
  getJobState: jest.fn(),
  isPendingState: (s: string | null) => s !== null && PENDING.includes(s),
  removeJob: jest.fn().mockResolvedValue(undefined),
  enqueueTtsJob: jest.fn().mockResolvedValue(undefined),
}));

import { recoveryService } from '../../src/recovery/recovery.service';
import { ttsJobRepository } from '../../src/jobs/tts-job.repository';
import { getJobState, enqueueTtsJob, removeJob } from '../../src/queue/tts.queue';

const repo = ttsJobRepository as jest.Mocked<typeof ttsJobRepository>;
const stateMock = getJobState as jest.MockedFunction<typeof getJobState>;
const enqueueMock = enqueueTtsJob as jest.MockedFunction<typeof enqueueTtsJob>;
const removeMock = removeJob as jest.MockedFunction<typeof removeJob>;

function fakeJob(id: string, status: TtsJob['status']): TtsJob {
  return {
    id, userId: 'u', text: 'হ্যালো', status, retryCount: 0, maxRetry: 3,
    errorCode: null, errorMessage: null, audioUrl: null, audioPath: null, durationMs: null,
    createdAt: new Date(), updatedAt: new Date(), queuedAt: new Date(),
    startedAt: null, completedAt: null, failedAt: null,
  };
}

describe('recoveryService.runScan', () => {
  it('re-enqueues a queued job missing from Redis', async () => {
    repo.findJobsForRecovery.mockResolvedValue([fakeJob('job-1', 'queued')]);
    stateMock.mockResolvedValue(null); // not in Redis
    const summary = await recoveryService.runScan();
    expect(enqueueMock).toHaveBeenCalledWith('job-1');
    expect(repo.requeue).toHaveBeenCalledWith('job-1');
    expect(summary.reEnqueued).toBe(1);
  });

  it('skips a job still pending in Redis (no duplicate enqueue)', async () => {
    repo.findJobsForRecovery.mockResolvedValue([fakeJob('job-2', 'retrying')]);
    stateMock.mockResolvedValue('waiting');
    const summary = await recoveryService.runScan();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(summary.skippedPending).toBe(1);
  });

  it('removes a finished Redis artifact before re-enqueuing', async () => {
    repo.findJobsForRecovery.mockResolvedValue([fakeJob('job-3', 'retrying')]);
    stateMock.mockResolvedValue('failed'); // finished artifact, not pending
    await recoveryService.runScan();
    expect(removeMock).toHaveBeenCalledWith('job-3');
    expect(enqueueMock).toHaveBeenCalledWith('job-3');
  });
});
