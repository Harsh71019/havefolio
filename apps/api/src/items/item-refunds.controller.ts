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
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { CorrectRefundDto, ItemRefundsDto, RecordRefundDto } from './item-refunds.dto.js';
import { ItemRefundsService } from './item-refunds.service.js';
import { ItemErrorDto, RevisionDto } from './items.dto.js';

@ApiTags('items')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: ItemErrorDto,
  description:
    'INVALID_MONEY_AMOUNT, UNSAFE_MONEY_VALUE, INVALID_CURRENCY, INVALID_DATE_PRECISION, INVALID_CALENDAR_DATE, INVALID_REFUND or INVALID_REQUEST (body shape).',
})
@ApiPayloadTooLargeResponse({ type: ItemErrorDto, description: 'JSON body exceeds 16 KiB.' })
@ApiUnauthorizedResponse({
  type: ItemErrorDto,
  description: 'Missing, expired or revoked session.',
})
@ApiNotFoundResponse({
  type: ItemErrorDto,
  description:
    'ITEM_NOT_FOUND or REFUND_NOT_FOUND. Another owner’s item or refund returns the same response.',
})
@ApiConflictResponse({
  type: ItemErrorDto,
  description:
    'STALE_ITEM_REVISION (reload first), CURRENCY_MISMATCH, REFUND_EXCEEDS_AMOUNT_PAID, REFUND_REQUIRES_AMOUNT_PAID, INVALID_ACQUISITION_COMBINATION (gift with nothing paid recorded) or REFUND_LIMIT_EXCEEDED.',
})
@ApiServiceUnavailableResponse({ type: ItemErrorDto, description: 'Storage unavailable.' })
@Controller({ path: 'items/:id/refunds', version: '1' })
export class ItemRefundsController {
  constructor(private readonly refunds: ItemRefundsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List confirmed refunds with the unchanged amount paid, refunded total and net recorded spend in the purchase currency.',
  })
  @ApiOkResponse({ type: ItemRefundsDto })
  list(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemRefundsDto> {
    return this.refunds.list(owner.id, id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Record a confirmed full or partial refund with the last-seen item revision. Purchase amount and ownership are unchanged; appends refund history.',
  })
  @ApiCreatedResponse({ type: ItemRefundsDto })
  record(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RecordRefundDto,
  ): Promise<ItemRefundsDto> {
    return this.refunds.record(owner.id, id, input);
  }

  @Patch(':refundId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Correct a refund’s amount, date or note with the last-seen item revision; totals are revalidated and history is appended.',
  })
  @ApiOkResponse({ type: ItemRefundsDto })
  correct(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('refundId') refundId: string,
    @Body() input: CorrectRefundDto,
  ): Promise<ItemRefundsDto> {
    return this.refunds.correct(owner.id, id, refundId, input);
  }

  @Delete(':refundId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete a refund record (and its note) with the last-seen item revision; a history entry without the note is kept.',
  })
  @ApiOkResponse({ type: ItemRefundsDto })
  delete(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('refundId') refundId: string,
    @Body() input: RevisionDto,
  ): Promise<ItemRefundsDto> {
    return this.refunds.delete(owner.id, id, refundId, input.revision);
  }
}
