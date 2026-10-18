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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { ContributionsPageDto, ContributionsQueryDto, GoalErrorDto } from './goals.dto.js';
import { AllocationStateDto, ConfirmAllocationDto } from './allocations.dto.js';
import { AllocationsService } from './allocations.service.js';
@ApiTags('goals')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: GoalErrorDto,
  description: 'INVALID_REQUEST; confirmed must be true.',
})
@ApiUnauthorizedResponse({ type: GoalErrorDto, description: 'AUTH_REQUIRED.' })
@ApiNotFoundResponse({
  type: GoalErrorDto,
  description: 'DESIRE_NOT_FOUND or GOAL_NOT_FOUND, including foreign identifiers.',
})
@ApiConflictResponse({
  type: GoalErrorDto,
  description:
    'ALLOCATION_ALREADY_EXISTS, ALLOCATION_COMMAND_REUSED, STALE_DECLINED_OUTCOME, ALLOCATION_ESTIMATE_REQUIRED, STALE_GOAL_REVISION, GOAL_ARCHIVED or GOAL_CURRENCY_MISMATCH.',
})
@ApiServiceUnavailableResponse({ type: GoalErrorDto, description: 'GOALS_UNAVAILABLE.' })
@Controller({ path: 'desires/:id/allocation', version: '1' })
export class AllocationsController {
  constructor(private readonly service: AllocationsService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read the current estimate separately from the confirmed allocation and its effective ledger leaf.',
  })
  @ApiOkResponse({ type: AllocationStateDto })
  state(
    @CurrentOwner() o: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AllocationStateDto> {
    return this.service.state(o.id, id);
  }
  @Get('history')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read this allocation chain, newest first, with bounded sequence pagination. Source and goal deletion retain no private snapshots.',
  })
  @ApiOkResponse({ type: ContributionsPageDto })
  history(
    @CurrentOwner() o: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ContributionsQueryDto,
  ): Promise<ContributionsPageDto> {
    return this.service.history(o.id, id, q);
  }
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Explicitly confirm the full positive current estimate to one goal. Retry-safe; no transfer, deposit or investment is performed.',
  })
  @ApiCreatedResponse({ type: AllocationStateDto })
  confirm(
    @CurrentOwner() o: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: ConfirmAllocationDto,
  ): Promise<AllocationStateDto> {
    return this.service.confirm(o.id, id, b);
  }
}
