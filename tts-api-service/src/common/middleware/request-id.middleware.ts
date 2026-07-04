/** Attaches a correlation id to each request for structured logging (skills.md). */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  req.correlationId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
