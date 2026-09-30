import {
  Catch,
  HttpException,
  Injectable,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { taxonomyErrorCodes } from '@havefolio/contracts';
import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';

const safeMessages = new Set([
  ...taxonomyErrorCodes,
  'AUTH_REQUIRED',
  'INVALID_CREDENTIALS',
  'REGISTRATION_UNAVAILABLE',
  'REQUEST_ORIGIN_REJECTED',
  'AUTH_RATE_LIMITED',
  'AUTH_UNAVAILABLE',
]);
const statusMessages: Record<number, string> = {
  400: 'INVALID_REQUEST',
  401: 'AUTH_REQUIRED',
  403: 'REQUEST_REJECTED',
  404: 'NOT_FOUND',
  413: 'REQUEST_TOO_LARGE',
  429: 'AUTH_RATE_LIMITED',
  503: 'AUTH_UNAVAILABLE',
};

// Includes parser failures: SyntaxError messages can contain fragments of credential bodies.
@Catch()
@Injectable()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const oversized =
      exception instanceof Error && 'type' in exception && exception.type === 'entity.too.large';
    const status =
      exception instanceof HttpException ? exception.getStatus() : oversized ? 413 : 500;
    const message =
      exception instanceof HttpException && safeMessages.has(exception.message)
        ? exception.message
        : (statusMessages[status] ?? 'REQUEST_FAILED');
    if (status >= 500) this.logger.error(JSON.stringify({ event: 'api_request_failed', status }));
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .setHeader('Cache-Control', 'no-store');
    host
      .switchToHttp()
      .getResponse<Response>()
      .json({ statusCode: status, message, error: STATUS_CODES[status] ?? 'Error' });
  }
}
