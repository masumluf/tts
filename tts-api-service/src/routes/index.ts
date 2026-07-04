/** Router aggregation. */
import { Router } from 'express';
import { healthRouter } from './health.routes';
import { ttsJobsRouter } from './tts-jobs.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/v1/tts/jobs', ttsJobsRouter);
