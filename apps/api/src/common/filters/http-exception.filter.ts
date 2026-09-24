import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

/** Normalizes every error into `ApiErrorBody` ({ statusCode, message, errors? }). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload: Record<string, unknown> =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : { statusCode: status, ...body };
      if (Array.isArray(payload.message)) payload.message = payload.message.join(', ');
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
    return res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ statusCode: 500, message: 'Internal server error' });
  }
}
