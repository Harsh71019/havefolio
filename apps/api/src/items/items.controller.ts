import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { ItemsQueryDto } from './inventory-query.dto.js';
import { ItemsService } from './items.service.js';
import {
  CreateItemDto,
  UpdateItemDto,
  RevisionDto,
  ItemActionDto,
  PaginationQueryDto,
  ItemDto,
  ItemsPageDto,
  EventsPageDto,
  ItemErrorDto,
} from './items.dto.js';
@ApiTags('items')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: ItemErrorDto,
  description: 'Invalid/immutable fields, money, date components, taxonomy relationship or action.',
})
@ApiPayloadTooLargeResponse({
  type: ItemErrorDto,
  description: 'JSON body exceeds the existing 16 KiB server request limit.',
})
@ApiUnauthorizedResponse({
  type: ItemErrorDto,
  description: 'Missing, expired or revoked session.',
})
@ApiNotFoundResponse({
  type: ItemErrorDto,
  description:
    'Item or taxonomy is absent for this owner; foreign resources return the same response.',
})
@ApiConflictResponse({
  type: ItemErrorDto,
  description:
    'STALE_ITEM_REVISION, INVALID_ITEM_TRANSITION, ITEM_TAXONOMY_RETIRED or ITEM_MEDIA_PENDING. Reload before stale-write retry.',
})
@ApiServiceUnavailableResponse({
  type: ItemErrorDto,
  description:
    'Storage or provider unavailable. Partial media cleanup remains retryable; item is retained.',
})
@Controller({ path: 'items', version: '1' })
export class ItemsController {
  constructor(private readonly items: ItemsService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Create a manual item and its initial history; unknown price/date are explicit in responses.',
  })
  @ApiCreatedResponse({ type: ItemDto })
  create(@CurrentOwner() owner: OwnerContext, @Body() input: CreateItemDto): Promise<ItemDto> {
    return this.items.create(owner.id, input);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Search and filter the complete private inventory; stable bounded cursor pagination (1–100, default 25). Price comparisons require currency. Invalid ranges/cursors/combinations return 400.',
  })
  @ApiBadRequestResponse({
    type: ItemErrorDto,
    description:
      'INVALID_ITEM_QUERY: contradictory ranges, unsupported sort/currency or foreign/mismatched taxonomy. INVALID_ITEM_CURSOR: malformed, expired, tampered, wrong-owner or mismatched query. INVALID_REQUEST: query DTO format/bounds. Retain controls and restart pagination on cursor errors.',
  })
  @ApiOkResponse({ type: ItemsPageDto })
  list(@CurrentOwner() owner: OwnerContext, @Query() input: ItemsQueryDto): Promise<ItemsPageDto> {
    return this.items.list(owner.id, input);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read a private item including original user provenance; provider identifiers and URLs are excluded.',
  })
  @ApiOkResponse({ type: ItemDto })
  read(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemDto> {
    return this.items.read(owner.id, id);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Correct mutable fields with required last-seen revision; ownership uses actions. Appends user correction provenance.',
  })
  @ApiOkResponse({ type: ItemDto })
  update(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateItemDto,
  ): Promise<ItemDto> {
    return this.items.update(owner.id, id, input);
  }
  @Post(':id/actions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Record ownership change, used again or repair with required revision. Owned may transition to any inactive state; inactive may return to owned. Use/repair require owned and leave condition/use frequency unchanged. A retried revision returns 409 without another event.',
  })
  @ApiOkResponse({ type: ItemDto })
  action(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ItemActionDto,
  ): Promise<ItemDto> {
    return this.items.action(owner.id, id, input);
  }
  @Get(':id/history')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read append-only lifecycle history chronologically by occurrence time (ties by event ID) with bounded keyset pagination. `after` is the last event UUID of the previous page; an unknown event returns 400 INVALID_ITEM_CURSOR.',
  })
  @ApiOkResponse({ type: EventsPageDto })
  history(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() input: PaginationQueryDto,
  ): Promise<EventsPageDto> {
    return this.items.history(owner.id, id, input);
  }
  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Erase item, tags, warranties, suggestions and history with required revision. Pending media blocks deletion; variants are cleaned before originals. Provider failures retain retryable metadata; confirmed-deleted exact-key tombstones survive detached for reconciliation.',
  })
  @ApiNoContentResponse()
  delete(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevisionDto,
  ): Promise<void> {
    return this.items.delete(owner.id, id, input.revision);
  }
}
