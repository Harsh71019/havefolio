import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
  BadRequestException,
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
  ApiProperty,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { RevisionDto, ItemErrorDto } from '../items/items.dto.js';
import { ItemPhotosService } from './item-photos.service.js';
import { PhotoOrderDto, PhotoSnapshotDto, PhotoUploadDto } from './item-photos.dto.js';
import { readPhotos } from './photo-multipart.js';
class PhotoAccessDto {
  @ApiProperty() url!: string;
  @ApiProperty({ enum: [60] }) expiresIn!: number;
}
@ApiTags('item-photos')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: ItemErrorDto,
  description:
    'PHOTO_HEIC_UNSUPPORTED, PHOTO_FORMAT_MISMATCH, PHOTO_INVALID, unexpected multipart field or invalid UUID.',
})
@ApiUnauthorizedResponse({ type: ItemErrorDto })
@ApiNotFoundResponse({ type: ItemErrorDto })
@ApiPayloadTooLargeResponse({
  type: ItemErrorDto,
  description: '10 MiB per file, 21 MiB request including multipart overhead, at most 4 files.',
})
@ApiConflictResponse({
  type: ItemErrorDto,
  description:
    'Stale revision, pending/reused Upload-Id, changed order or quota (8 photos/item, 2 GiB/owner, 4 GiB/app).',
})
@ApiServiceUnavailableResponse({
  type: ItemErrorDto,
  description: 'Disabled storage, processing busy or provider/database unavailable.',
})
@Controller({ path: 'items/:itemId/photos', version: '1' })
export class ItemPhotosController {
  private active = 0;
  constructor(private readonly photos: ItemPhotosService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: PhotoSnapshotDto })
  snapshot(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
  ): Promise<PhotoSnapshotDto> {
    return this.photos.snapshot(owner.id, item);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload sanitized private photos. Each result is independent; index follows multipart order. Repeat the same Upload-Id and bytes to recover a ready response. Pending retries wait for reconciliation.',
  })
  @ApiHeader({ name: 'Upload-Id', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['photos'],
      properties: {
        photos: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @ApiCreatedResponse({ type: PhotoUploadDto })
  async upload(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
    @Headers('upload-id') uploadId: string,
    @Req() req: Request,
  ): Promise<PhotoUploadDto> {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(uploadId ?? '')
    )
      throw new BadRequestException('PHOTO_UPLOAD_ID_REQUIRED');
    await this.photos.authorize(owner.id, item);
    if (this.active >= 1) throw new ServiceUnavailableException('PHOTO_PROCESSING_BUSY');
    this.active++;
    try {
      const files = await readPhotos(req);
      try {
        return await this.photos.upload(owner.id, item, uploadId, files);
      } finally {
        files.forEach((f) => f.bytes.fill(0));
      }
    } finally {
      this.active--;
    }
  }
  @Patch('order')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Set complete ready-photo order. First entry is the cover; required item revision serializes order and cover changes.',
  })
  @ApiOkResponse({ type: PhotoSnapshotDto })
  order(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
    @Body() input: PhotoOrderDto,
  ): Promise<PhotoSnapshotDto> {
    return this.photos.reorder(owner.id, item, input.revision, input.photoIds);
  }
  @Delete(':photoId')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: PhotoSnapshotDto })
  delete(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
    @Param('photoId', ParseUUIDPipe) photo: string,
    @Body() input: RevisionDto,
  ): Promise<PhotoSnapshotDto> {
    return this.photos.delete(owner.id, item, photo, input.revision);
  }
  @Get(':photoId/access/:variant')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @ApiOkResponse({ type: PhotoAccessDto })
  access(
    @CurrentOwner() owner: OwnerContext,
    @Param('itemId', ParseUUIDPipe) item: string,
    @Param('photoId', ParseUUIDPipe) photo: string,
    @Param('variant') variant: string,
  ): Promise<PhotoAccessDto> {
    if (!['original', 'display', 'thumbnail'].includes(variant))
      throw new BadRequestException('PHOTO_VARIANT_INVALID');
    return this.photos.access(owner.id, item, photo, variant);
  }
}
