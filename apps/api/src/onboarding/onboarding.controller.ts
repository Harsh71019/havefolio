import { Body, Controller, Delete, Get, Header, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { ItemErrorDto } from '../items/items.dto.js';
import { OnboardingActionDto, OnboardingStatusDto } from './onboarding.dto.js';
import { OnboardingService } from './onboarding.service.js';
@ApiTags('onboarding')
@ApiCookieAuth('ownerSession')
@ApiUnauthorizedResponse({
  type: ItemErrorDto,
  description: 'AUTH_REQUIRED: valid owner session required.',
})
@ApiBadRequestResponse({
  type: ItemErrorDto,
  description: 'INVALID_REQUEST: unsupported action or fields.',
})
@ApiConflictResponse({
  type: ItemErrorDto,
  description:
    'INVALID_ONBOARDING_TRANSITION: use revisit to reopen skipped/completed help. ITEM_MEDIA_PENDING: retry removal after reconciliation.',
})
@ApiServiceUnavailableResponse({
  type: ItemErrorDto,
  description: 'ITEMS_UNAVAILABLE or private asset cleanup unavailable; removal remains retryable.',
})
@Controller({ path: 'onboarding', version: '1' })
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Read private onboarding state and genuine/demo counts. No automatic sample creation.',
  })
  @ApiOkResponse({ type: OnboardingStatusDto })
  read(@CurrentOwner() owner: OwnerContext): Promise<OnboardingStatusDto> {
    return this.service.read(owner.id);
  }
  @Post('actions')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Start, skip, complete, intentionally revisit help, or record a visited surface. Never mutates inventory.',
  })
  @ApiOkResponse({ type: OnboardingStatusDto })
  act(
    @CurrentOwner() owner: OwnerContext,
    @Body() input: OnboardingActionDto,
  ): Promise<OnboardingStatusDto> {
    return this.service.act(owner.id, input.action);
  }
  @Post('demo')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Explicitly opt into six read-only fictional samples. Concurrent/repeated calls reuse one owner dataset. Can be explicitly added again after removal.',
  })
  @ApiOkResponse({ type: OnboardingStatusDto })
  seed(@CurrentOwner() owner: OwnerContext): Promise<OnboardingStatusDto> {
    return this.service.seed(owner.id);
  }
  @Delete('demo')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Idempotently remove only this owner’s marked samples. Genuine items and taxonomy survive; returns counts only.',
  })
  @ApiOkResponse({ type: OnboardingStatusDto })
  remove(@CurrentOwner() owner: OwnerContext): Promise<OnboardingStatusDto> {
    return this.service.remove(owner.id);
  }
}
