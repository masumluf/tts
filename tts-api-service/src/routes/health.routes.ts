/** Health routes (no auth): GET /health, GET /health/dependencies. */
import { Router } from 'express';
import { healthController } from '../controller/health.controller';

export const healthRouter = Router();

healthRouter.get('/', healthController.liveness);
healthRouter.get('/dependencies', healthController.dependencies);
