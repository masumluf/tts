/** TTS job routes. All guarded by API-key auth (per-user isolation). */
import { Router } from 'express';
import { authenticate } from '../auth/api-key.middleware';
import { ttsJobsController } from '../controller/tts-jobs.controller';

export const ttsJobsRouter = Router();

ttsJobsRouter.use(authenticate);
ttsJobsRouter.post('/', ttsJobsController.create);
ttsJobsRouter.get('/', ttsJobsController.list);
ttsJobsRouter.get('/:jobId', ttsJobsController.get);
ttsJobsRouter.get('/:jobId/audio', ttsJobsController.downloadAudio);
