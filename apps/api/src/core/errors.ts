import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have access to this') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (msg: string) => new AppError(409, 'CONFLICT', msg);
export const tooManyRequests = (msg: string, details?: unknown) =>
  new AppError(429, 'QUOTA_EXCEEDED', msg, details);

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function handler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  // An id that is not an id — `/contacts/not-a-real-id`. Nothing can be stored under it,
  // so it is simply not found, rather than a 500 that looks like the server broke.
  if ((err as { name?: string }).name === 'CastError') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    return;
  }

  // Duplicate key — surface the field rather than a raw driver message.
  const mongoErr = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (mongoErr.code === 11000) {
    const field = Object.keys(mongoErr.keyPattern ?? {})[0] ?? 'value';
    res.status(409).json({
      error: { code: 'DUPLICATE', message: `That ${field} is already in use` },
    });
    return;
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong',
      // Never leak stack traces or driver internals to a client in production.
      ...(env.isProd ? {} : { details: err instanceof Error ? err.message : String(err) }),
    },
  });
}
