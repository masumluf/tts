import type { Request, Response } from 'express';
import { z } from 'zod';
import { errorHandler } from '../../src/common/errors/error-handler';
import { AppError } from '../../src/common/errors/app-error';

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const req = { correlationId: 'test-corr' } as unknown as Request;
const next = jest.fn();

describe('errorHandler', () => {
  it('maps AppError to its status + code (safe message only)', () => {
    const res = mockRes();
    errorHandler(AppError.forbidden('You do not have access to this job.'), req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: { code: 'forbidden', message: 'You do not have access to this job.' } });
  });

  it('maps a ZodError to 400 with details', () => {
    const res = mockRes();
    const parsed = z.object({ text: z.string() }).safeParse({});
    if (parsed.success) throw new Error('expected failure');
    errorHandler(parsed.error, req, res, next);
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('maps an unknown error to 500 without leaking detail', () => {
    const res = mockRes();
    errorHandler(new Error('secret internal detail'), req, res, next);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });
});
