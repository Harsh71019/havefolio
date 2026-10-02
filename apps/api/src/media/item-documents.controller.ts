import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  StreamableFile,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiProduces,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { RevisionDto, ItemErrorDto } from '../items/items.dto.js';
import { ItemDocumentsService } from './item-documents.service.js';
import { DocumentDto, DocumentSnapshotDto } from './item-documents.dto.js';
import { readDocument } from './document-multipart.js';
@ApiTags('item-documents')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: ItemErrorDto,
  description:
    'Invalid kind, multipart, filename, decoded image or strict PDF; PDF safety/resource bounds exceeded.',
})
@ApiUnauthorizedResponse({ type: ItemErrorDto })
@ApiNotFoundResponse({
  type: ItemErrorDto,
  description: 'Item or document not found for this owner.',
})
@ApiPayloadTooLargeResponse({
  type: ItemErrorDto,
  description: '10 MiB/image, 20 MiB/PDF, 21 MiB/request, exactly one file.',
})
@ApiConflictResponse({
  type: ItemErrorDto,
  description:
    'Stale revision, pending/reused/recovered Upload-Id or quota (16 documents/item, shared 2 GiB/owner and 4 GiB/app).',
})
@ApiServiceUnavailableResponse({
  type: ItemErrorDto,
  description: 'Storage disabled, processing busy, database or provider unavailable.',
})
@Controller({ path: 'items/:itemId/documents', version: '1' })
export class ItemDocumentsController {
  private active = 0;
  constructor(private readonly documents: ItemDocumentsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List safe ready receipt/warranty metadata; excludes photos and storage identifiers.',
  })
  @ApiOkResponse({ type: DocumentSnapshotDto })
  snapshot(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
  ): Promise<DocumentSnapshotDto> {
    return this.documents.snapshot(owner.id, item);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Upload a private receipt or warranty. Repeat Upload-Id, kind and content to recover a ready response; failed intents reconcile by exact key.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Upload-Id', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'document'],
      properties: {
        kind: { type: 'string', enum: ['receipt', 'warranty'] },
        document: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiCreatedResponse({ type: DocumentDto })
  async upload(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
    @Headers('upload-id') id: string,
    @Req() req: Request,
  ): Promise<DocumentDto> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id ?? ''))
      throw new BadRequestException('DOCUMENT_UPLOAD_ID_REQUIRED');
    await this.documents.authorize(owner.id, item);
    if (this.active >= 1) throw new ServiceUnavailableException('DOCUMENT_PROCESSING_BUSY');
    this.active++;
    try {
      const { kind, file } = await readDocument(req);
      try {
        return await this.documents.upload(owner.id, item, id, kind, file);
      } finally {
        file.bytes.fill(0);
      }
    } finally {
      this.active--;
    }
  }
  @Delete(':documentId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete the exact document with item revision; provider failure hides access and remains retryable.',
  })
  @ApiOkResponse({ type: DocumentSnapshotDto })
  delete(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
    @Param('documentId', ParseUUIDPipe) id: string,
    @Body() input: RevisionDto,
  ): Promise<DocumentSnapshotDto> {
    return this.documents.delete(owner.id, item, id, input.revision);
  }
  @Get(':documentId/download')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "sandbox; default-src 'none'")
  @ApiOperation({
    summary:
      'Download after owner/item/document authorization. Uses server-only 60-second provider access; all documents download as attachments with generated safe filenames.',
  })
  @ApiProduces('application/pdf', 'image/webp')
  @ApiOkResponse({
    schema: { type: 'string', format: 'binary' },
    headers: {
      'Content-Disposition': {
        schema: { type: 'string' },
        description: 'attachment; generated ASCII filename and RFC 5987 filename*.',
      },
      'X-Content-Type-Options': { schema: { type: 'string', enum: ['nosniff'] } },
    },
  })
  async download(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
    @Param('documentId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.documents.download(owner.id, item, id);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', result.disposition);
    const file = new StreamableFile(result.bytes, {
      type: result.contentType,
      disposition: result.disposition,
      length: result.bytes.length,
    });
    res.once('close', result.release);
    res.setTimeout(30_000, () => res.destroy());
    if (res.destroyed) result.release();
    return file;
  }
}
