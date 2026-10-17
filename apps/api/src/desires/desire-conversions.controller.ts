import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post } from '@nestjs/common';
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
import { DesireErrorDto } from './desires.dto.js';
import {
  ConvertDesireDto,
  DesireConversionDto,
  DesireConversionStateDto,
} from './desire-conversions.dto.js';
import { DesireConversionsService } from './desire-conversions.service.js';

@ApiTags('desires')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: DesireErrorDto,
  description:
    'INVALID_CONVERSION, INVALID_ITEM, INVALID_ITEM_DATE, INVALID_ITEM_TAXONOMY or malformed body.',
})
@ApiUnauthorizedResponse({ type: DesireErrorDto, description: 'AUTH_REQUIRED.' })
@ApiNotFoundResponse({
  type: DesireErrorDto,
  description:
    'DESIRE_NOT_FOUND (also for another owner’s desire), CONVERSION_NOT_FOUND or ITEM_TAXONOMY_NOT_FOUND.',
})
@ApiConflictResponse({
  type: DesireErrorDto,
  description:
    'DESIRE_NOT_BOUGHT, STALE_BOUGHT_OUTCOME, DESIRE_ALREADY_CONVERTED, CONVERSION_COMMAND_REUSED, ITEM_TAXONOMY_RETIRED or PHOTO_QUOTA_EXCEEDED.',
})
@ApiServiceUnavailableResponse({
  type: DesireErrorDto,
  description: 'DESIRES_UNAVAILABLE or MEDIA_STORAGE_UNAVAILABLE.',
})
@Controller({ path: 'desires/:id/conversion', version: '1' })
export class DesireConversionsController {
  constructor(private readonly service: DesireConversionsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read conversion eligibility, copied suggestions and any existing conversion. The likely price is reference only.',
  })
  @ApiOkResponse({ type: DesireConversionStateDto })
  state(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DesireConversionStateDto> {
    return this.service.state(owner.id, id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Optionally create one owned item from the effective bought outcome using confirmed facts. Retry-safe by commandId; replays return the original conversion.',
  })
  @ApiCreatedResponse({ type: DesireConversionDto })
  convert(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ConvertDesireDto,
  ): Promise<DesireConversionDto> {
    return this.service.convert(owner.id, id, input);
  }

  @Post('photo')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Resume an unfinished private photo copy. Idempotent; never duplicates or alters the desire photo.',
  })
  @ApiCreatedResponse({ type: DesireConversionDto })
  resumePhoto(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DesireConversionDto> {
    return this.service.resumePhoto(owner.id, id);
  }
}
