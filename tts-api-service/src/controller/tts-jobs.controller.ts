import type { NextFunction, Request, Response } from 'express';
import { HTTP_STATUS } from '../common/constants/http-status.constants';
import { getAuthUserContext } from '../auth/api-key.middleware';
import {
  createTtsJobSchema,
  jobIdParamSchema,
  listJobsQuerySchema,
} from '../jobs/tts-job.schemas';
import { ttsJobService } from '../jobs/tts-job.service';
import type { JobStatusView } from '../jobs/tts-job.types';

function toWireStatus(view: JobStatusView): Record<string, unknown> {
  return {
    job_id: view.jobId,
    status: view.status,
    ...(view.audioUrl !== undefined ? { audio_url: view.audioUrl } : {}),
    ...(view.durationMs !== undefined ? { duration_ms: view.durationMs } : {}),
    ...(view.errorCode !== undefined ? { error_code: view.errorCode } : {}),
    ...(view.errorMessage !== undefined ? { error_message: view.errorMessage } : {}),
    created_at: view.createdAt,
    ...(view.queuedAt !== undefined ? { queued_at: view.queuedAt } : {}),
    ...(view.startedAt !== undefined ? { started_at: view.startedAt } : {}),
    ...(view.completedAt !== undefined ? { completed_at: view.completedAt } : {}),
    ...(view.failedAt !== undefined ? { failed_at: view.failedAt } : {}),
  };
}

export const ttsJobsController = {
  /**
   * Create a TTS job.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = getAuthUserContext(req);
      const input = createTtsJobSchema.parse(req.body);
      const result = await ttsJobService.createJob(user, input);
      res.status(HTTP_STATUS.ACCEPTED).json({
        job_id: result.jobId,
        status: result.status,
        message: result.message,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * List user’s TTS jobs.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = getAuthUserContext(req);
      const query = listJobsQuerySchema.parse(req.query);
      const result = await ttsJobService.listJobs(user, query);
      res.status(HTTP_STATUS.OK).json({
        items: result.items.map((item) => ({
          job_id: item.jobId,
          status: item.status,
          created_at: item.createdAt,
          ...(item.completedAt !== undefined ? { completed_at: item.completedAt } : {}),
        })),
        next_cursor: result.nextCursor,
      });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get a single TTS job.
   */
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = getAuthUserContext(req);
      const { jobId } = jobIdParamSchema.parse(req.params);
      const view = await ttsJobService.getJob(user, jobId);
      res.status(HTTP_STATUS.OK).json(toWireStatus(view));
    } catch (error) {
      next(error);
    }
  },

  /**
   * Download audio for a completed job.
   */
  async downloadAudio(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = getAuthUserContext(req);
      const { jobId } = jobIdParamSchema.parse(req.params);
      const stream = await ttsJobService.getAudioStream(user, jobId);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `attachment; filename="${jobId}.wav"`);
      stream.on('error', next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
};
