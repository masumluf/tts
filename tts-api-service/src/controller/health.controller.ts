import type { NextFunction, Request, Response } from 'express';
import { HTTP_STATUS } from '../common/constants/http-status.constants';
import { healthService } from '../health/health.service';

export const healthController = {
  /**
   * Simple liveness check – no dependencies, no DB, no Redis, no model.
   */
  liveness(_req: Request, res: Response): void {
    res.status(HTTP_STATUS.OK).json(healthService.liveness());
  },

  /**
   * Full health check including DB, Redis, model server, email, storage.
   */
  async dependencies(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const report = await healthService.dependencies();
      const status = report.status === 'healthy' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;
      res.status(status).json(report);
    } catch (error) {
      next(error);
    }
  },
};
