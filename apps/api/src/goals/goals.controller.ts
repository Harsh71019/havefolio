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
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentOwner, type OwnerContext } from '../auth/auth.context.js';
import { GoalsService } from './goals.service.js';
import {
  ContributionDto,
  ContributionsPageDto,
  ContributionsQueryDto,
  CreateContributionDto,
  CreateGoalDto,
  GoalDto,
  GoalErrorDto,
  GoalRevisionDto,
  GoalsPageDto,
  GoalsQueryDto,
  PatchGoalDto,
} from './goals.dto.js';
@ApiTags('goals')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: GoalErrorDto,
  description: 'INVALID_REQUEST, INVALID_GOAL or INVALID_CONTRIBUTION.',
})
@ApiUnauthorizedResponse({ type: GoalErrorDto, description: 'AUTH_REQUIRED.' })
@ApiNotFoundResponse({
  type: GoalErrorDto,
  description:
    'GOAL_NOT_FOUND or CONTRIBUTION_NOT_FOUND. Foreign and missing identifiers are indistinguishable.',
})
@ApiConflictResponse({
  type: GoalErrorDto,
  description:
    'STALE_GOAL_REVISION, GOAL_CURRENCY_LOCKED, GOAL_CURRENCY_MISMATCH, GOAL_ARCHIVED, CONTRIBUTION_COMMAND_REUSED or CONTRIBUTION_ALREADY_CORRECTED.',
})
@ApiServiceUnavailableResponse({ type: GoalErrorDto, description: 'GOALS_UNAVAILABLE.' })
@Controller({ path: 'goals', version: '1' })
export class GoalsController {
  constructor(private readonly service: GoalsService) {}
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create a private active goal. Progress begins at zero.' })
  @ApiCreatedResponse({ type: GoalDto })
  create(@CurrentOwner() o: OwnerContext, @Body() b: CreateGoalDto): Promise<GoalDto> {
    return this.service.create(o.id, b);
  }
  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'List private goals, including archived goals, with bounded ID keyset pagination.',
  })
  @ApiOkResponse({ type: GoalsPageDto })
  list(@CurrentOwner() o: OwnerContext, @Query() q: GoalsQueryDto): Promise<GoalsPageDto> {
    return this.service.list(o.id, q);
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Read a private goal and exact confirmed contribution progress.' })
  @ApiOkResponse({ type: GoalDto })
  get(@CurrentOwner() o: OwnerContext, @Param('id', ParseUUIDPipe) id: string): Promise<GoalDto> {
    return this.service.get(o.id, id);
  }
  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Edit target or explicit status with revision protection. Archive retains all history; active restores it.',
  })
  @ApiOkResponse({ type: GoalDto })
  update(
    @CurrentOwner() o: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: PatchGoalDto,
  ): Promise<GoalDto> {
    return this.service.update(o.id, id, b);
  }
  @Delete(':id')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Explicitly delete private goal and ledger with revision protection.' })
  @ApiNoContentResponse({ description: 'Goal and its private contribution history deleted.' })
  delete(
    @CurrentOwner() o: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: GoalRevisionDto,
  ): Promise<void> {
    return this.service.delete(o.id, id, b.revision);
  }
  @Get(':id/contributions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Read durable contribution history, newest sequence first. Superseded entries remain visible.',
  })
  @ApiOkResponse({ type: ContributionsPageDto })
  contributions(
    @CurrentOwner() o: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ContributionsQueryDto,
  ): Promise<ContributionsPageDto> {
    return this.service.contributions(o.id, id, q);
  }
  @Post(':id/contributions')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Confirm a contribution or append explicit correction/reversal. Identical command retries are idempotent; no money transfer occurs.',
  })
  @ApiCreatedResponse({ type: ContributionDto })
  contribute(
    @CurrentOwner() o: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: CreateContributionDto,
  ): Promise<ContributionDto> {
    return this.service.contribute(o.id, id, b);
  }
}
