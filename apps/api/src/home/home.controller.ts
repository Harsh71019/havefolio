import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { ItemErrorDto } from '../items/items.dto.js';
import { HomeSummaryDto } from './home.dto.js';
import { HomeService } from './home.service.js';

@ApiTags('home')
@ApiCookieAuth('ownerSession')
@Controller({ path: 'home', version: '1' })
export class HomeController {
  constructor(private readonly home: HomeService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Private Home summary in one bounded request.',
    description:
      'Owned count, authoritative current-owned spending (separate currencies and date relations), newest owned items, active desires, active goals with confirmed progress only, and one rediscovery suggestion from owner-declared use frequency.',
  })
  @ApiOkResponse({ type: HomeSummaryDto })
  @ApiUnauthorizedResponse({ type: ItemErrorDto, description: 'AUTH_REQUIRED.' })
  @ApiInternalServerErrorResponse({
    type: ItemErrorDto,
    description: 'REQUEST_FAILED; internal details are omitted.',
  })
  @ApiServiceUnavailableResponse({
    type: ItemErrorDto,
    description: 'ITEMS_UNAVAILABLE, DESIRES_UNAVAILABLE, GOALS_UNAVAILABLE or AUTH_UNAVAILABLE.',
  })
  summary(@CurrentOwner() owner: OwnerContext): Promise<HomeSummaryDto> {
    return this.home.summary(owner.id);
  }
}
