import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, type Observable, switchMap } from 'rxjs';
import type { AuthUser } from '../../common/auth.decorators';
import { InteractionService } from './smart-core.services';

/** High-frequency polling endpoints that would flood the log without adding insight. */
const SKIP = [
  /^\/api\/health/,
  /^\/api\/jobs\/[^/]+$/,
  /^\/api\/smart\//,
  /^\/api\/admin\/jobs\/queue/,
  /^\/api\/auth\/refresh/,
];

/**
 * Records every API call (method, path, status, duration, sanitized body) when the
 * admin has enabled detailed logging. Off by default; the audit log still records
 * all mutations either way.
 */
@Injectable()
export class InteractionInterceptor implements NestInterceptor {
  constructor(private readonly interactions: InteractionService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const url = req.originalUrl.split('?')[0];
    if (SKIP.some((re) => re.test(url))) return next.handle();

    return from(this.interactions.isEnabled()).pipe(
      switchMap((enabled) => {
        if (enabled) {
          const started = Date.now();
          res.once('finish', () =>
            this.interactions.logServer({
              userId: req.user?.id,
              method: req.method,
              path: url,
              route: (req.headers['x-client-route'] as string | undefined) ?? null,
              statusCode: res.statusCode,
              durationMs: Date.now() - started,
              meta: {
                ...(Object.keys(req.query ?? {}).length ? { query: req.query } : {}),
                ...(req.method !== 'GET' && req.body && Object.keys(req.body).length
                  ? { body: req.body }
                  : {}),
              },
            }),
          );
        }
        return next.handle();
      }),
    );
  }
}
