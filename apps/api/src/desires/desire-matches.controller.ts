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
import { DesireErrorDto } from './desires.dto.js';
import {
  CreateDesireMatchDto,
  DesireMatchDto,
  DesireMatchesPageDto,
  MatchCandidatesPageDto,
  MatchCandidatesQueryDto,
  MatchesQueryDto,
  PatchDesireMatchDto,
} from './desire-matches.dto.js';
import { DesireMatchesService } from './desire-matches.service.js';

@ApiTags('desires')
@ApiCookieAuth('ownerSession')
@ApiBadRequestResponse({
  type: DesireErrorDto,
  description:
    'INVALID_MATCH_REASON, INVALID_MATCH_RELEVANCE, INVALID_DESIRE_CURSOR or malformed body.',
})
@ApiUnauthorizedResponse({ type: DesireErrorDto, description: 'AUTH_REQUIRED.' })
@ApiNotFoundResponse({
  type: DesireErrorDto,
  description: 'DESIRE_NOT_FOUND, ITEM_NOT_FOUND or MATCH_NOT_FOUND.',
})
@ApiConflictResponse({
  type: DesireErrorDto,
  description: 'MATCH_ALREADY_EXISTS or MATCH_LIMIT_EXCEEDED.',
})
@ApiServiceUnavailableResponse({
  type: DesireErrorDto,
  description: 'DESIRES_UNAVAILABLE or MATCHES_UNAVAILABLE.',
})
@Controller({ path: 'desires/:id/matches', version: '1' })
export class DesireMatchesController {
  constructor(private readonly service: DesireMatchesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'List all possessions deliberately matched to a desire with plain-language explanations, derived hints and usability indicators.',
  })
  @ApiOkResponse({
    type: DesireMatchesPageDto,
    description: 'A page of desire matches with item summaries and total count.',
  })
  list(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MatchesQueryDto,
  ): Promise<DesireMatchesPageDto> {
    return this.service.list(owner.id, id, query);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Deliberately connect an owned item to this desire as a potential alternative, with an explainable reason. Never claims equivalence.',
  })
  @ApiCreatedResponse({
    type: DesireMatchDto,
    description: 'The match was created and attached to the desire.',
  })
  create(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateDesireMatchDto,
  ): Promise<DesireMatchDto> {
    return this.service.create(owner.id, id, input);
  }

  @Get('candidates')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Search and list owned inventory candidate items for matching. By default, sold/disposed/lost items are excluded from usable alternatives.',
  })
  @ApiOkResponse({
    type: MatchCandidatesPageDto,
    description: 'A page of candidate inventory items with match status and suggested reasons.',
  })
  candidates(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MatchCandidatesQueryDto,
  ): Promise<MatchCandidatesPageDto> {
    return this.service.candidates(owner.id, id, query);
  }

  @Patch(':matchId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Update a match explanation or record relevance feedback (e.g. marking the possession irrelevant).',
  })
  @ApiOkResponse({
    type: DesireMatchDto,
    description: 'The updated match record.',
  })
  update(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() input: PatchDesireMatchDto,
  ): Promise<DesireMatchDto> {
    return this.service.update(owner.id, id, matchId, input);
  }

  @Delete(':matchId')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Remove a match connecting an owned possession to this desire.',
  })
  @ApiNoContentResponse({
    description: 'The match was removed successfully.',
  })
  remove(
    @CurrentOwner() owner: OwnerContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('matchId', ParseUUIDPipe) matchId: string,
  ): Promise<void> {
    return this.service.remove(owner.id, id, matchId);
  }
}
