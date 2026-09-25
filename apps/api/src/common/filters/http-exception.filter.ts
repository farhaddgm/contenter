import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ErrorTrackerService } from '../../modules/smart/smart-core.services';
import type { AuthUser } from '../auth.decorators';

/**
 * Normalizes every error into `ApiErrorBody` ({ statusCode, message, errors?, errorId? }).
 * Server errors (5xx) are recorded by the Smart error tracker and the response carries
 * `errorId` so the UI can link its toast to the full error.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly errors: ErrorTrackerService) {}

  async catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { user?: AuthUser }>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload: Record<string, unknown> =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : { statusCode: status, ...body };
      if (Array.isArray(payload.message)) payload.message = payload.message.join(', ');
      if (status >= 500) payload.errorId = await this.track(exception, status, req);
      return res.status(status).json(payload);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2025') {
        return res.status(404).json({ statusCode: 404, message: 'Resource not found' });
      }
      if (exception.code === 'P2002') {
        return res.status(409).json({ statusCode: 409, message: 'Resource already exists' });
      }
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    const errorId = await this.track(exception, HttpStatus.INTERNAL_SERVER_ERROR, req);
    return res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ statusCode: 500, message: 'Internal server error', errorId });
  }

  private track(exception: unknown, status: number, req: Request & { user?: AuthUser }) {
    const err = exception instanceof Error ? exception : null;
    return this.errors.record({
      source: 'SERVER',
      message: err?.message ?? String(exception),
      detail: err?.stack ?? null,
      errorName: err?.constructor?.name ?? null,
      statusCode: status,
      method: req.method,
      path: req.originalUrl?.split('?')[0],
      route: (req.headers['x-client-route'] as string | undefined) ?? null,
      userId: req.user?.id ?? null,
      context: {
        ...(err instanceof Prisma.PrismaClientKnownRequestError
          ? { prismaCode: err.code, meta: err.meta }
          : {}),
        ...(req.method !== 'GET' && req.body ? { body: req.body } : {}),
      },
    });
  }
}
