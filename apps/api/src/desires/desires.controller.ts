import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { readPhotos } from '../media/photo-multipart.js';
import {
  CreateDesireDto,
  DesireDto,
  DesireErrorDto,
  DesirePhotoDto,
  DesiresPageDto,
  DesiresQueryDto,
  PatchDesireDto,
  RevisionDto,
} from './desires.dto.js';
import {
  CreateReviewDto,
  ReviewsQueryDto,
  ReviewEventDto,
  ReviewHistoryPageDto,
} from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';
import { DesiresService } from './desires.service.js';

@ApiTags('desires')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: DesireErrorDto,
  description:
    'INVALID_REVIEW, INVALID_REVIEW_DATE, INVALID_REVIEW_ITEM, INVALID_DESIRE, INVALID_DESIRE_PRICE, INVALID_DESIRE_URL, INVALID_DESIRE_WAIT, INVALID_DESIRE_CURSOR, PHOTO_UPLOAD_ID_REQUIRED, PHOTO_VARIANT_INVALID or malformed body.',
})
@ApiUnauthorizedResponse({ type: DesireErrorDto, description: 'AUTH_REQUIRED.' })
@ApiNotFoundResponse({
  type: DesireErrorDto,
  description: 'DESIRE_NOT_FOUND, DESIRE_PHOTO_NOT_FOUND or REVIEW_ITEM_UNAVAILABLE.',
})
@ApiConflictResponse({
  type: DesireErrorDto,
  description:
    'REVIEW_COMMAND_REUSED, REVIEW_CORRECTION_REQUIRED, REVIEW_EVENT_REQUIRED, STALE_DESIRE_REVISION, DESIRE_MEDIA_PENDING, PHOTO_QUOTA_EXCEEDED, PHOTO_UPLOAD_ID_REUSED, PHOTO_UPLOAD_PENDING, PHOTO_UPLOAD_RECOVERED.',
})
@ApiServiceUnavailableResponse({
  type: DesireErrorDto,
  description:
    'DESIRES_UNAVAILABLE, MEDIA_STORAGE_DISABLED, MEDIA_STORAGE_UNAVAILABLE, PHOTO_PROCESSING_BUSY or PHOTO_DELIVERY_BUSY.',
})
@Controller({ path: 'desires', version: '1' })
export class DesiresController {
  private activeUploads = 0;
  private deliveringPhotos = 0;

  constructor(
    private readonly service: DesiresService,
    private readonly reviews: ReviewsService,
  ) {}

  @Get(':id/reviews')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read owner-private decision history, newest first. Never sum historical estimate snapshots.',
  })
  @ApiOkResponse({ type: ReviewHistoryPageDto })
  history(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ReviewsQueryDto,
  ): Promise<ReviewHistoryPageDto> {
    return this.reviews.list(owner.id, id, query);
  }

  @Post(':id/reviews')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Append a retry-safe outcome or explicit correction. Does not create inventory or savings.',
  })
  @ApiCreatedResponse({ type: ReviewEventDto })
  review(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateReviewDto,
  ): Promise<ReviewEventDto> {
    return this.reviews.create(owner.id, id, input);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Record a product or service the owner is considering without judgment. Requires only a name.',
  })
  @ApiCreatedResponse({
    type: DesireDto,
    description: 'The desire record was created successfully in considering or waiting state.',
  })
  create(@CurrentOwner() owner: OwnerContext, @Body() input: CreateDesireDto): Promise<DesireDto> {
    return this.service.create(owner.id, input);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List the owner’s desires with bounded keyset pagination and optional state/classification filters.',
  })
  @ApiOkResponse({
    type: DesiresPageDto,
    description: 'A page of desires matching the query.',
  })
  list(
    @CurrentOwner() owner: OwnerContext,
    @Query() query: DesiresQueryDto,
  ): Promise<DesiresPageDto> {
    return this.service.list(owner.id, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read a single desire by ID. Foreign and non-existent IDs return identical 404 responses.',
  })
  @ApiOkResponse({
    type: DesireDto,
    description: 'Desire details and current primary photo metadata.',
  })
  get(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DesireDto> {
    return this.service.get(owner.id, id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Update a desire record. Requires the last-seen revision for optimistic concurrency. Supports starting, revising or cancelling waiting period.',
  })
  @ApiOkResponse({
    type: DesireDto,
    description: 'The updated desire with an incremented revision.',
  })
  update(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: PatchDesireDto,
  ): Promise<DesireDto> {
    return this.service.update(owner.id, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete a desire and clean up any attached private photo safely. Requires last-seen revision.',
  })
  @ApiNoContentResponse({
    description: 'The desire was deleted successfully.',
  })
  delete(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevisionDto,
  ): Promise<void> {
    return this.service.delete(owner.id, id, input.revision);
  }

  @Post(':id/photo')
  @Header('Cache-Control', 'no-store')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Upload or replace the single private photo for a desire. Idempotent retries using the same Upload-Id recover ready metadata.',
  })
  @ApiHeader({ name: 'Upload-Id', required: true, schema: { type: 'string', format: 'uuid' } })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['photo'],
      properties: {
        photo: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiPayloadTooLargeResponse({
    type: DesireErrorDto,
    description: '10 MiB per file, 21 MiB request including multipart overhead.',
  })
  @ApiCreatedResponse({
    type: DesirePhotoDto,
    description: 'The photo was processed, stored and attached to the desire.',
  })
  async uploadPhoto(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('upload-id') uploadId: string,
    @Req() req: Request,
  ): Promise<DesirePhotoDto> {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(uploadId ?? '')
    ) {
      throw new BadRequestException('PHOTO_UPLOAD_ID_REQUIRED');
    }
    await this.service.authorizePhoto(owner.id, id);
    if (this.activeUploads >= 1) {
      throw new ServiceUnavailableException('PHOTO_PROCESSING_BUSY');
    }
    this.activeUploads++;
    try {
      const files = await readPhotos(req);
      try {
        const file = files[0];
        if (!file) throw new BadRequestException('PHOTO_FILE_REQUIRED');
        return await this.service.uploadPhoto(owner.id, id, uploadId, file);
      } finally {
        files.forEach((f) => f.bytes.fill(0));
      }
    } finally {
      this.activeUploads--;
    }
  }

  @Get(':id/photo')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read metadata of the current private photo attached to this desire.',
  })
  @ApiOkResponse({
    type: DesirePhotoDto,
    description: 'Photo metadata without provider credentials or URLs.',
  })
  getPhoto(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DesirePhotoDto> {
    return this.service.getPhoto(owner.id, id);
  }

  @Delete(':id/photo')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Delete the private photo attached to this desire. Increments desire revision.',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        revision: { type: 'number', example: 2 },
      },
      required: ['revision'],
    },
    description: 'The photo was deleted and the desire revision incremented.',
  })
  deletePhoto(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevisionDto,
  ): Promise<{ revision: number }> {
    return this.service.deletePhoto(owner.id, id, input.revision);
  }

  @Get(':id/photo/content/:variant')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cross-Origin-Resource-Policy', 'same-origin')
  @Header('Content-Security-Policy', "default-src 'none'; sandbox")
  @ApiOperation({
    summary:
      'Authenticated same-origin image bytes for a ready variant (display or thumbnail). Provider URLs never reach the browser.',
  })
  @ApiProduces('image/webp')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async photoContent(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('variant') variant: string,
  ): Promise<StreamableFile> {
    if (!['display', 'thumbnail'].includes(variant)) {
      throw new BadRequestException('PHOTO_VARIANT_INVALID');
    }
    if (this.deliveringPhotos >= 8) {
      throw new ServiceUnavailableException('PHOTO_DELIVERY_BUSY');
    }
    this.deliveringPhotos++;
    try {
      const bytes = await this.service.getPhotoContent(owner.id, id, variant);
      return new StreamableFile(bytes, {
        type: 'image/webp',
        disposition: 'inline',
        length: bytes.length,
      });
    } finally {
      this.deliveringPhotos--;
    }
  }
}
