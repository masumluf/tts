import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './common/logger/logger';
import { requestId } from './common/middleware/request-id.middleware';
import { errorHandler, notFoundHandler } from './common/errors/error-handler';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(requestId);
  app.use(pinoHttp({ logger, customProps: (req) => ({ correlationId: req.correlationId }) }));
  app.use(express.json({ limit: '1mb' }));

  app.use(apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
