import { goalErrorCodes } from '../goals/goals.dto.js';
import { captureFailure } from '@havefolio/monitoring/server';
import {
  Catch,
  HttpException,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import {
  taxonomyErrorCodes,
  desireErrorCodes,
  notificationErrorCodes,
  allocationErrorCodes,
  settingsErrorCodes,
} from '@havefolio/contracts';
import { financialErrorCodes } from '@havefolio/domain';
import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';

const safeMessages = new Set<string>([
  ...taxonomyErrorCodes,
  ...goalErrorCodes,
  ...allocationErrorCodes,
  // Fixed financial-domain tokens (PER-22); never amounts, notes or dates.
  ...financialErrorCodes,
  // Fixed desire-domain tokens (PER-23).
  ...desireErrorCodes,
  ...notificationErrorCodes,
  ...settingsErrorCodes,
  'PHOTO_UPLOAD_ID_REQUIRED',
  'PHOTO_PROCESSING_BUSY',
  'PHOTO_DELIVERY_BUSY',
  'PHOTO_VARIANT_INVALID',
  'PHOTO_QUOTA_EXCEEDED',
  'PHOTO_UPLOAD_ID_REUSED',
  'PHOTO_UPLOAD_PENDING',
  'PHOTO_UPLOAD_RECOVERED',
  'PHOTO_FILE_REQUIRED',
  'PHOTO_FILE_SIZE',
  'PHOTO_FILE_COUNT',
  'PHOTO_REQUEST_SIZE',
  'PHOTO_REQUEST_ABORTED',
  'PHOTO_REQUEST_TIMEOUT',
  'PHOTO_UNEXPECTED_FIELD',
  'PHOTO_INVALID_MULTIPART',
  'PHOTO_HEIC_UNSUPPORTED',
  'PHOTO_FORMAT_MISMATCH',
  'PHOTO_INVALID',
  'DOCUMENT_FILENAME_INVALID',
  'DOCUMENT_INVALID',
  'DOCUMENT_MULTIPART_REQUIRED',
  'DOCUMENT_KIND_REQUIRED',
  'DOCUMENT_UNEXPECTED_FIELD',
  'DOCUMENT_INVALID_MULTIPART',
  'DOCUMENT_REQUEST_ABORTED',
  'DOCUMENT_REQUEST_TIMEOUT',
  'DOCUMENT_REQUEST_SIZE',
  'DOCUMENT_FILE_SIZE',
  'DOCUMENT_FILE_COUNT',
  'DOCUMENT_UPLOAD_ID_REQUIRED',
  'DOCUMENT_UPLOAD_ID_REUSED',
  'DOCUMENT_UPLOAD_RECOVERED',
  'DOCUMENT_UPLOAD_PENDING',
  'DOCUMENT_QUOTA_EXCEEDED',
  'DOCUMENT_PROCESSING_BUSY',
  'DOCUMENT_UPLOAD_UNAVAILABLE',
  'MEDIA_STORAGE_DISABLED',
  'MEDIA_STORAGE_UNAVAILABLE',
  'MEDIA_NOT_FOUND',

  'INVALID_SPENDING_QUERY',
  'SPENDING_BUCKET_LIMIT',
  'SPENDING_PRECISION_UNREPRESENTABLE',
  'INVALID_ITEM_QUERY',
  'INVALID_ITEM_CURSOR',
  'INVALID_ITEM',
  'INVALID_ITEM_DATE',
  'INVALID_ITEM_TAXONOMY',
  'INVALID_ITEM_ACTION',
  'ITEM_NOT_FOUND',
  'ITEM_TAXONOMY_NOT_FOUND',
  'ITEM_TAXONOMY_RETIRED',
  'STALE_ITEM_REVISION',
  'DEMO_ITEM_READ_ONLY',
  'INVALID_ONBOARDING_TRANSITION',
  'INVALID_ITEM_TRANSITION',
  'ITEM_MEDIA_PENDING',
  'ITEMS_UNAVAILABLE',
  'INVALID_PURCHASE_URL',
  'INVALID_MERCHANT',
  'INVALID_MERCHANT_HOST',
  'INVALID_MERCHANT_CURSOR',
  'MERCHANT_NOT_FOUND',
  'MERCHANT_RETIRED',
  'MERCHANT_NAME_EXISTS',
  'MERCHANTS_UNAVAILABLE',
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
  catch(exception: unknown, host: ArgumentsHost): void {
    const oversized =
      exception instanceof Error && 'type' in exception && exception.type === 'entity.too.large';
    const status =
      exception instanceof HttpException ? exception.getStatus() : oversized ? 413 : 500;
    const message =
      exception instanceof HttpException && safeMessages.has(exception.message)
        ? exception.message
        : (statusMessages[status] ?? 'REQUEST_FAILED');
    const response = host.switchToHttp().getResponse<Response>();
    if (status >= 500) {
      const request = host.switchToHttp().getRequest<Request>();
      const route = (request.route as { path?: unknown } | undefined)?.path;
      response.locals.monitoringEventId = captureFailure(exception, { code: message, route });
    }
    response.locals.logError = exception;
    response.locals.logCategory =
      status >= 500
        ? exception instanceof HttpException
          ? 'operational_failure'
          : 'unexpected_failure'
        : 'controlled_failure';
    response.locals.logCode = message;
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
