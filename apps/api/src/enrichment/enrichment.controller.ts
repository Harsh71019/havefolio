import type { EnrichmentWork, EnrichmentPage, EnrichmentReviewEvent } from '@havefolio/contracts';
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { EnrichmentService } from './enrichment.service.js';
import {
  EnrichmentPageQueryDto,
  EnrichmentRequestDto,
  EnrichmentReviewDto,
} from './enrichment.dto.js';
import {
  enrichmentPageSchema,
  enrichmentWorkSchema,
  enrichmentHistorySchema,
  enrichmentReviewSchema,
} from './enrichment.openapi.js';
@ApiTags('enrichment')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  description:
    'Invalid input, unsupported field or attachment (ENRICHMENT_ATTACHMENT_UNSUPPORTED for PDFs). Money/date fields are reviewable only from receipt work.',
})
@ApiUnauthorizedResponse({
  description: 'Authentication required; existing origin/CSRF policy applies.',
})
@ApiNotFoundResponse({ description: 'Item, work or attachment absent for this owner.' })
@ApiConflictResponse({
  description:
    'STALE_ITEM_REVISION, STALE_ENRICHMENT_REVISION, ENRICHMENT_COMMAND_CONFLICT, DEMO_ITEM_READ_ONLY or ENRICHMENT_NOT_REVIEWABLE. Reload before a new command.',
})
@ApiTooManyRequestsResponse({ description: 'At most 3 active and 100 lifetime requests per item.' })
@ApiServiceUnavailableResponse({
  description: 'Private database unavailable; retry same command ID.',
})
@Controller({ path: 'items/:id/enrichment', version: '1' })
export class EnrichmentController {
  constructor(private readonly service: EnrichmentService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Request private asynchronous enrichment after manual capture. Public URLs use bounded static extraction; food barcodes use Open Food Facts only after explicit request.',
  })
  @ApiCreatedResponse({ schema: enrichmentWorkSchema })
  request(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnrichmentRequestDto,
  ): Promise<EnrichmentWork> {
    return this.service.request(owner.id, id, dto);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List bounded private candidate sets, confidence and provenance; unconfigured availability is explicit.',
  })
  @ApiOkResponse({ schema: enrichmentPageSchema })
  list(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: EnrichmentPageQueryDto,
  ): Promise<EnrichmentPage> {
    return this.service.list(owner.id, id, q);
  }
  @Get('reviews')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read append-only field decisions and correction history with bounded pagination.',
  })
  @ApiOkResponse({ schema: enrichmentHistorySchema })
  history(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: EnrichmentPageQueryDto,
  ): Promise<{ items: EnrichmentReviewEvent[]; nextBefore: string | null }> {
    return this.service.history(owner.id, id, q);
  }
  @Post(':workId/reviews')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Explicitly accept, reject or correct one candidate field at the current item revision. Retry identical command IDs safely; all decisions advance revision.',
  })
  @ApiCreatedResponse({ schema: enrichmentReviewSchema })
  decide(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body() dto: EnrichmentReviewDto,
  ): Promise<EnrichmentReviewEvent> {
    return this.service.decide(owner.id, id, workId, dto);
  }
}
