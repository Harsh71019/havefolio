import { Controller, Get, Header, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { ItemErrorDto } from './items.dto.js';
import { MerchantSpendingReportDto, SpendingQueryDto, SpendingReportDto } from './spending.dto.js';
import { SpendingService } from './spending.service.js';

@ApiTags('spending')
@ApiCookieAuth('ownerSession')
@Controller({ path: 'spending', version: '1' })
export class SpendingController {
  constructor(private readonly spending: SpendingService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Analyze recorded spending in separate original currencies and explicit ownership scope.',
    description:
      'Purchase-date basis, not bank cash flow. Confirmed refunds adjust original purchase periods. Date overlaps and unknown dates remain separate. Monthly grouping rejects applicable year-only dates; use yearly grouping or narrower filters. At most 1000 buckets; narrow filters on overflow.',
  })
  @ApiOkResponse({ type: SpendingReportDto })
  @ApiBadRequestResponse({
    type: ItemErrorDto,
    description:
      'INVALID_REQUEST, INVALID_SPENDING_QUERY (including foreign taxonomy), SPENDING_PRECISION_UNREPRESENTABLE or SPENDING_BUCKET_LIMIT.',
  })
  @ApiInternalServerErrorResponse({
    type: ItemErrorDto,
    description: 'REQUEST_FAILED; internal details are omitted.',
  })
  @ApiUnauthorizedResponse({ type: ItemErrorDto, description: 'AUTH_REQUIRED.' })
  @ApiServiceUnavailableResponse({
    type: ItemErrorDto,
    description: 'ITEMS_UNAVAILABLE or AUTH_UNAVAILABLE.',
  })
  report(
    @CurrentOwner() owner: OwnerContext,
    @Query() query: SpendingQueryDto,
  ): Promise<SpendingReportDto> {
    return this.spending.report(owner.id, query);
  }
  @Get('merchants')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Lifetime recorded spend per merchant, ranked by net spend.',
    description:
      'All recorded history in original currencies, net of confirmed refunds. Unknown prices are counted, not summed. Demo items are excluded.',
  })
  @ApiOkResponse({ type: MerchantSpendingReportDto })
  @ApiBadRequestResponse({ type: ItemErrorDto, description: 'SPENDING_BUCKET_LIMIT.' })
  @ApiInternalServerErrorResponse({
    type: ItemErrorDto,
    description: 'REQUEST_FAILED; internal details are omitted.',
  })
  @ApiUnauthorizedResponse({ type: ItemErrorDto, description: 'AUTH_REQUIRED.' })
  @ApiServiceUnavailableResponse({
    type: ItemErrorDto,
    description: 'ITEMS_UNAVAILABLE or AUTH_UNAVAILABLE.',
  })
  merchants(@CurrentOwner() owner: OwnerContext): Promise<MerchantSpendingReportDto> {
    return this.spending.merchants(owner.id);
  }
}
