import { errorPayload } from '@rivalrush/shared';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import { ZodError, type ZodType } from 'zod';
import { bearerToken, verifySession } from '../auth/jwt.js';
import { AppError } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(jwtSecret: string): RequestHandler {
  return (req, _res, next) => {
    const claims = verifySession(bearerToken(req.headers.authorization), jwtSecret);
    req.userId = claims.sub;
    next();
  };
}

/** The authenticated user id. Never read a user id from the request body or query. */
export function userIdOf(req: Request): string {
  if (!req.userId) throw new AppError('UNAUTHORIZED');
  return req.userId;
}

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('VALIDATION_ERROR', undefined, {
      fields: r.error.issues.map((i) => i.path.join('.') || '(root)'),
    });
  }
  return r.data;
}

/** Wraps an async handler so rejections reach the error middleware. */
export function route(
  fn: (req: Request, res: Response) => Promise<unknown> | unknown,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res))
      .then((body) => {
        if (!res.headersSent && body !== undefined) res.json(body);
      })
      .catch(next);
  };
}

/** Logs method, route *pattern* (never raw paths, which can carry invite tokens) and timing. */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const routePath = (req.route as { path?: string } | undefined)?.path;
      logger.info(
        {
          event: 'http',
          method: req.method,
          route: `${req.baseUrl}${routePath ?? ''}` || 'unmatched',
          status: res.statusCode,
          ms: Math.round(ms),
        },
        'request',
      );
    });
    next();
  };
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.toPayload() });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({ error: errorPayload('VALIDATION_ERROR') });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: errorPayload('VALIDATION_ERROR', 'Request too large.') });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: errorPayload('VALIDATION_ERROR', 'Malformed JSON.') });
      return;
    }
    logger.error({ err }, 'unhandled request error');
    res.status(500).json({ error: errorPayload('INTERNAL_ERROR') });
  };
}

export function notFound(): RequestHandler {
  return (_req, res) => {
    res.status(404).json({ error: errorPayload('NOT_FOUND') });
  };
}
