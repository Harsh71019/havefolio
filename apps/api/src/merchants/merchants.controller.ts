import {
  Body,
  Controller,
  Get,
  Header,
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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import {
  CreateMerchantDto,
  UpdateMerchantDto,
  MerchantsQueryDto,
  MerchantDto,
  MerchantsPageDto,
} from './merchants.dto.js';
import { MerchantsService } from './merchants.service.js';
@ApiTags('merchants')
@ApiCookieAuth('ownerSession')
@ApiUnauthorizedResponse({ description: 'Owner session required.' })
@ApiBadRequestResponse({ description: 'Invalid merchant or cursor.' })
@ApiNotFoundResponse({ description: 'Merchant not found for this owner.' })
@ApiConflictResponse({ description: 'Normalized name is reserved.' })
@ApiServiceUnavailableResponse({ description: 'Merchant storage unavailable; retry later.' })
@Controller({ path: 'merchants', version: '1' })
export class MerchantsController {
  constructor(private readonly service: MerchantsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Search saved merchants by normalized prefix; active by default, bounded keyset pages.',
  })
  @ApiOkResponse({ type: MerchantsPageDto })
  list(
    @CurrentOwner() owner: OwnerContext,
    @Query() input: MerchantsQueryDto,
  ): Promise<MerchantsPageDto> {
    return this.service.list(owner.id, input);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read an owner merchant, including retired historical records.' })
  @ApiOkResponse({ type: MerchantDto })
  read(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MerchantDto> {
    return this.service.read(owner.id, id);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Create or reuse an exactly normalized owner merchant; never merges similar names or overwrites existing details.',
  })
  @ApiCreatedResponse({ type: MerchantDto })
  create(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: CreateMerchantDto,
  ): Promise<MerchantDto> {
    return this.service.create(owner.id, input);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Correct name or website host, retire or restore a merchant. Historical links remain.',
  })
  @ApiOkResponse({ type: MerchantDto })
  update(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateMerchantDto,
  ): Promise<MerchantDto> {
    return this.service.update(owner.id, id, input);
  }
}
